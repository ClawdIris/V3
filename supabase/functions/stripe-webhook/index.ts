// stripe-webhook Edge Function — Casabe Konnect R5/R6 (Delta R4+R5 blockers fixed)
//
// SECURITY:
//   - Stripe signature verification (STRIPE_WEBHOOK_SECRET from Deno.env only)
//   - Atomic idempotency via claim_stripe_event() RPC — RETURNING-based ownership
//     (P0-M1/P0-M3: no more SELECT+INSERT TOCTOU race; claimed=false exits immediately)
//   - payment_status === 'paid' gate before marking order paid (P1-M4)
//   - Non-2xx on failed order updates (Stripe retries)
//   - Non-2xx on failed event finalization (P0-R4-1: no silent failure)
//   - P0-R5-1: claimed=false now splits on action:
//       action='in_progress' → HTTP 409 (retryable; owning request still active)
//       action='duplicate'   → HTTP 200 (event confirmed processed; safe ack)
//     Prevents Stripe from silently dropping events when the owning request later fails.
//   - P0-R6-1: claim_stripe_event() now re-reads row state after a reclaim-race loss
//       instead of returning hardcoded 'duplicate'. New action='unknown' means NULL or
//       unexpected payment_status — webhook returns 500 (fail closed, Stripe retries).
//       Webhook branch updated: explicit handling for 'duplicate', 'in_progress', and
//       'unknown'; any other unexpected action also returns 500.
//   - Refunds/failures resolved via Checkout Session lookup (NOT charge.metadata)
//   - async_payment_succeeded and async_payment_failed fully implemented
//   - payment_intent_data.metadata populated at checkout creation time (see stripe-checkout)
//   - All failure branches use canonical 'failed' status (P1-R4-4)
//   - merge_stripe_payment_completed receives session.amount_total (P1-R4-5)
//
// DO NOT DEPLOY without Delta review and Jefe sign-off.

import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Check STRIPE_WEBHOOK_SECRET — graceful unconfigured state
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret) {
    return new Response(
      JSON.stringify({ error: 'webhook_not_configured' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 503 }
    );
  }

  // Read raw body for signature verification
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return new Response(
      JSON.stringify({ error: 'missing_signature' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Verify Stripe webhook signature
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Signature verification failed';
    console.error('[stripe-webhook] invalid signature:', message);
    return new Response(
      JSON.stringify({ error: 'invalid_signature' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Supabase service-role client — required for claim_stripe_event and order writes
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // ── Atomic idempotency claim via RPC (P0-M1/P0-M3 fix) ─────────────────
  // claim_stripe_event() uses INSERT ... RETURNING to capture ownership.
  // Only the caller whose INSERT created the row gets claimed=true.
  // All other concurrent callers get claimed=false immediately and must
  // return 200 (duplicate) without any order processing.
  //
  // NOTE: We call claim_stripe_event() here with NULL order_id/tenant_id
  // because we haven't parsed the event yet. The claim reserves the event_id slot.
  // On reclaim (stale retry), order_id/tenant_id are re-populated during processing.
  const { data: initialClaim, error: claimErr } = await supabase.rpc('claim_stripe_event', {
    p_event_id:   event.id,
    p_event_type: event.type,
    p_order_id:   null,
    p_tenant_id:  null,
  });

  if (claimErr) {
    // Database error calling the claim RPC — return 500 so Stripe retries.
    console.error('[stripe-webhook] claim_stripe_event RPC error:', claimErr.message);
    return new Response(
      JSON.stringify({ error: 'claim_rpc_failed', detail: claimErr.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }

  // claimed=false → check action to classify outcome accurately.
  // P0-R5-1 / P0-R6-1: claim_stripe_event() now re-reads row state after a reclaim-race
  // loss (Step 5) and returns one of three actions:
  //   'in_progress' → reclaim winner is actively processing — return 409 (Stripe retries)
  //   'duplicate'   → reclaim winner finished; row is 'processed' — safe 200 ack
  //   'unknown'     → NULL or unexpected state after race loss — fail closed, return 500
  // An unexpected action value is also treated as fail-closed (500).
  if (!initialClaim?.claimed) {
    const claimAction = initialClaim?.action;
    if (claimAction === 'in_progress') {
      // Another request owns this event — return 409 so Stripe retries if that owner fails.
      console.log(`[stripe-webhook] event in_progress by another request: ${event.id}`);
      return new Response(
        JSON.stringify({ error: 'in_progress', detail: 'event is being processed by another request' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
      );
    }
    if (claimAction === 'duplicate') {
      // Confirmed processed duplicate — safe to ack.
      console.log(`[stripe-webhook] event duplicate (processed): ${event.id}`);
      return new Response(
        JSON.stringify({ received: true, duplicate: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }
    // 'unknown' or any other unexpected action — fail closed. Do not return 200.
    // P0-R6-1: 'unknown' means the row had NULL or unexpected payment_status after
    // reclaim-race loss. After P1-R6-2 schema reconciliation this should not occur
    // at runtime, but we fail closed defensively regardless.
    console.error(`[stripe-webhook] claim returned unexpected action='${claimAction}' for event ${event.id} — returning 500`);
    return new Response(
      JSON.stringify({ error: 'claim_unexpected', detail: `unexpected claim action: ${claimAction}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }

  // claimed=true (action: 'claimed' or 'reclaimed') → we own this event; proceed.
  console.log(`[stripe-webhook] claimed event (${initialClaim.action}): ${event.id}`);

  // ── P0-R4-1: Transition-validated event finalization ─────────────────────
  //
  // failEvent() and succeedEvent() now call finalize_stripe_event() RPC instead
  // of a bare .update(). The RPC:
  //   - Only transitions from 'processing' (p_allowed_from)
  //   - Returns rows_updated (0 or 1)
  //   - 0 rows → finalization did not land → return 500 (Stripe retries)
  //   - We NEVER return 200 without confirmed DB finalization
  //
  // This closes the silent-failure loop:
  //   OLD: failEvent fails silently → row stays 'processing' → Stripe retries →
  //        claim sees recent 'processing' → claimed=false → 200 duplicate → lost update
  //   NEW: finalize_stripe_event fails → 500 returned → Stripe retries → stale reclaim
  //        after 5 min → claim succeeds → event reprocessed

  async function failEvent(errMsg: string): Promise<Response> {
    console.error('[stripe-webhook] processing failed:', errMsg);
    const { data: rowsUpdated, error: finalizeErr } = await supabase.rpc('finalize_stripe_event', {
      p_event_id:     event.id,
      p_new_status:   'failed',
      p_allowed_from: ['processing'],
      p_processed_at: null,
      p_raw_error:    errMsg,
    });
    if (finalizeErr || rowsUpdated === 0) {
      // Finalization itself failed — log but still return 500 so Stripe retries.
      // The row will go stale and be reclaimed.
      console.error(
        '[stripe-webhook] failEvent: finalize_stripe_event did not land:',
        finalizeErr?.message ?? `rows_updated=${rowsUpdated}`
      );
    }
    return new Response(
      JSON.stringify({ error: 'processing_failed', detail: errMsg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }

  async function succeedEvent(): Promise<Response> {
    const { data: rowsUpdated, error: finalizeErr } = await supabase.rpc('finalize_stripe_event', {
      p_event_id:     event.id,
      p_new_status:   'processed',
      p_allowed_from: ['processing'],
      p_processed_at: new Date().toISOString(),
      p_raw_error:    null,
    });
    if (finalizeErr) {
      // RPC call itself errored — cannot confirm finalization → 500
      console.error('[stripe-webhook] succeedEvent: finalize_stripe_event RPC error:', finalizeErr.message);
      return new Response(
        JSON.stringify({ error: 'finalization_failed', detail: finalizeErr.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }
    if (rowsUpdated === 0) {
      // 0 rows updated — row was not in 'processing' state (concurrent race or stale reclaim lost)
      // Return 500 so Stripe retries. Do not claim success.
      console.error(
        `[stripe-webhook] succeedEvent: finalize_stripe_event returned 0 rows for event ${event.id} — state transition did not land`
      );
      return new Response(
        JSON.stringify({ error: 'finalization_no_rows', detail: 'event state not updated to processed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }
    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }

  // ── skipEvent: for "not a Casabe event" or "async will handle it" paths ──
  // These mark the event as 'processed' (not an error, just not applicable).
  // Also uses finalize_stripe_event to ensure the state write is confirmed.
  async function skipEvent(reason: string): Promise<Response> {
    const { data: rowsUpdated, error: finalizeErr } = await supabase.rpc('finalize_stripe_event', {
      p_event_id:     event.id,
      p_new_status:   'processed',
      p_allowed_from: ['processing'],
      p_processed_at: new Date().toISOString(),
      p_raw_error:    null,
    });
    if (finalizeErr || rowsUpdated === 0) {
      // Skip finalization failed — return 500 so Stripe retries rather than
      // leaving the row in 'processing' permanently.
      console.error(
        '[stripe-webhook] skipEvent: finalize_stripe_event did not land:',
        finalizeErr?.message ?? `rows_updated=${rowsUpdated}`
      );
      return new Response(
        JSON.stringify({ error: 'finalization_failed', detail: `skip finalization failed: ${reason}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }
    return new Response(
      JSON.stringify({ received: true, skipped: reason }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }

  // Handle events
  switch (event.type) {

    // ── checkout.session.completed ──────────────────────────────────────
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;

      // ── P1-M4: payment_status gate ──────────────────────────────────
      // Only process synchronous payments where payment_status = 'paid'.
      // Async payment methods (ACH, etc.) will emit async_payment_succeeded
      // separately — handled below. Do NOT mark an order paid if it hasn't
      // actually been paid yet.
      if (session.payment_status !== 'paid') {
        console.log(
          `[stripe-webhook] checkout.session.completed: payment_status=${session.payment_status} — not 'paid', skipping order update`
        );
        // Mark this event as processed (it was valid, just not a sync payment).
        // The async_payment_succeeded event will handle the actual paid state.
        // P0-R4-1: use skipEvent() — confirmed DB write or 500 on failure.
        return await skipEvent('not_paid');
      }

      // ── Tenant/Order Verification ───────────────────────────────────
      const orderId = session.metadata?.order_id;
      const metaTenantId = session.metadata?.tenant_id;

      if (!orderId || !metaTenantId) {
        // Missing metadata is a misconfiguration — mark failed, return 500 for retry.
        return await failEvent('missing order_id or tenant_id in session metadata');
      }

      // Verify order exists and belongs to expected tenant
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('id, tenant_id')
        .eq('id', orderId)
        .eq('tenant_id', metaTenantId)
        .single();

      if (orderErr || !order) {
        // Order not found or tenant mismatch → processing error → 500 (Stripe retries)
        return await failEvent(`order not found or tenant mismatch: order=${orderId} tenant=${metaTenantId}`);
      }

      // P1-R4-5: Validate amount_total before calling merge RPC.
      // session.amount_total is the Stripe-verified amount in cents.
      const amountTotal = session.amount_total;
      if (!amountTotal || amountTotal <= 0) {
        return await failEvent(
          `checkout.session.completed: invalid amount_total=${amountTotal} for order=${orderId}`
        );
      }

      try {
        console.log(
          `[stripe-webhook] checkout.session.completed: payment_status=paid, session=${session.id}, order=${orderId}, amount=${amountTotal}`
        );

        // Write payment state into order data JSONB via RPC.
        // P1-R4-5: Pass session.amount_total (cents) as p_amount_paid.
        const { error: updateErr } = await supabase.rpc('merge_stripe_payment_completed', {
          p_order_id:       orderId,
          p_tenant_id:      metaTenantId,
          p_session_id:     session.id,
          p_payment_status: 'paid',
          p_payment_method: 'stripe',
          p_amount_paid:    amountTotal,
        });

        if (updateErr) throw updateErr;

        return await succeedEvent();
      } catch (err: unknown) {
        return await failEvent(err instanceof Error ? err.message : String(err));
      }
    }

    // ── checkout.session.async_payment_succeeded ────────────────────────
    // Fired when an async payment method (e.g. ACH, bank redirect) completes.
    // checkout.session.completed for async methods has payment_status='unpaid'
    // at session completion time — this event is the actual paid confirmation.
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.order_id;
      const metaTenantId = session.metadata?.tenant_id;

      console.log(
        `[stripe-webhook] checkout.session.async_payment_succeeded: session=${session.id}, order=${orderId}`
      );

      if (!orderId || !metaTenantId) {
        return await failEvent('async_payment_succeeded: missing order_id or tenant_id in session metadata');
      }

      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('id, tenant_id')
        .eq('id', orderId)
        .eq('tenant_id', metaTenantId)
        .single();

      if (orderErr || !order) {
        return await failEvent(
          `async_payment_succeeded: order not found or tenant mismatch: order=${orderId} tenant=${metaTenantId}`
        );
      }

      // P1-R4-5: Validate amount_total.
      const asyncAmountTotal = session.amount_total;
      if (!asyncAmountTotal || asyncAmountTotal <= 0) {
        return await failEvent(
          `async_payment_succeeded: invalid amount_total=${asyncAmountTotal} for order=${orderId}`
        );
      }

      try {
        // P1-R4-5: Pass session.amount_total as p_amount_paid.
        const { error: updateErr } = await supabase.rpc('merge_stripe_payment_completed', {
          p_order_id:       orderId,
          p_tenant_id:      metaTenantId,
          p_session_id:     session.id,
          p_payment_status: 'paid',
          p_payment_method: 'stripe',
          p_amount_paid:    asyncAmountTotal,
        });

        if (updateErr) throw updateErr;

        return await succeedEvent();
      } catch (err: unknown) {
        return await failEvent(err instanceof Error ? err.message : String(err));
      }
    }

    // ── checkout.session.async_payment_failed ───────────────────────────
    // Fired when an async payment method fails (e.g. insufficient funds on ACH).
    // The checkout session remains open for the customer to retry payment.
    // P1-R4-4: Use canonical 'failed' status (not 'payment_failed').
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.order_id;
      const metaTenantId = session.metadata?.tenant_id;

      console.log(
        `[stripe-webhook] checkout.session.async_payment_failed: session=${session.id}, order=${orderId}`
      );

      if (!orderId || !metaTenantId) {
        // No metadata → not a Casabe order event → skip gracefully.
        // P0-R4-1: use skipEvent() — confirmed DB write or 500.
        console.log('[stripe-webhook] async_payment_failed: no metadata, skipping');
        return await skipEvent('no_metadata');
      }

      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('id, tenant_id')
        .eq('id', orderId)
        .eq('tenant_id', metaTenantId)
        .single();

      if (orderErr || !order) {
        return await failEvent(
          `async_payment_failed: order not found or tenant mismatch: order=${orderId} tenant=${metaTenantId}`
        );
      }

      try {
        // P1-R4-4: canonical 'failed' (was incorrectly 'payment_failed' in R4).
        const { error: updateErr } = await supabase.rpc('merge_stripe_payment_status', {
          p_order_id:       orderId,
          p_tenant_id:      metaTenantId,
          p_payment_status: 'failed',
        });

        if (updateErr) throw updateErr;

        return await succeedEvent();
      } catch (err: unknown) {
        return await failEvent(err instanceof Error ? err.message : String(err));
      }
    }

    // ── payment_intent.payment_failed ───────────────────────────────────
    // H3: Wire payment failure to order update.
    // IMPORTANT: charge.metadata and payment_intent.metadata are NOT
    // automatically populated from Checkout Session metadata. We must resolve
    // the Checkout Session from the PaymentIntent ID to get order_id/tenant_id.
    // stripe-checkout now sets payment_intent_data.metadata at creation time
    // (P0-M3 companion fix) so intent.metadata WILL have order_id/tenant_id
    // for sessions created after that deployment. We try intent.metadata first,
    // then fall back to Checkout Session lookup for older sessions.
    // P1-R4-4: Uses canonical 'failed' status (consistent with all failure branches).
    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent;
      console.log(`[stripe-webhook] payment_intent.payment_failed: ${intent.id}`);

      // Try payment_intent_data.metadata first (populated by updated stripe-checkout)
      let failOrderId: string | undefined = intent.metadata?.order_id;
      let failTenantId: string | undefined = intent.metadata?.tenant_id;

      // Fallback: look up Checkout Session by PaymentIntent ID
      if (!failOrderId || !failTenantId) {
        try {
          const failSessions = await stripe.checkout.sessions.list({
            payment_intent: intent.id,
            limit: 1,
          });
          const failSession = failSessions.data[0];
          if (!failSession) {
            // No Checkout Session for this PaymentIntent — not a Casabe event.
            console.log(
              `[stripe-webhook] payment_intent.payment_failed: no Casabe session for intent ${intent.id} — skipping`
            );
            // P0-R4-1: use skipEvent() — confirmed DB write or 500.
            return await skipEvent('no_casabe_session');
          }
          failOrderId = failSession.metadata?.order_id;
          failTenantId = failSession.metadata?.tenant_id;
        } catch (lookupErr: unknown) {
          return await failEvent(
            'payment_failed: session lookup failed: ' +
            (lookupErr instanceof Error ? lookupErr.message : String(lookupErr))
          );
        }
      }

      if (!failOrderId || !failTenantId) {
        // Session found but no metadata → not a Casabe order → skip.
        // P0-R4-1: use skipEvent() — confirmed DB write or 500.
        console.log(
          `[stripe-webhook] payment_intent.payment_failed: no metadata for intent ${intent.id} — skipping`
        );
        return await skipEvent('no_metadata');
      }

      // Verify order belongs to expected tenant
      const { data: failOrder, error: failOrderErr } = await supabase
        .from('orders')
        .select('id, tenant_id')
        .eq('id', failOrderId)
        .eq('tenant_id', failTenantId)
        .maybeSingle();

      if (failOrderErr || !failOrder) {
        return await failEvent(
          `payment_failed: order not found or tenant mismatch: order=${failOrderId} tenant=${failTenantId}`
        );
      }

      try {
        // P1-R4-4: canonical 'failed' (already correct in R4 for this branch; preserved).
        const { error: failUpdateErr } = await supabase.rpc('merge_stripe_payment_status', {
          p_order_id:       failOrderId,
          p_tenant_id:      failTenantId,
          p_payment_status: 'failed',
        });
        if (failUpdateErr) throw failUpdateErr;
        console.log(`[stripe-webhook] payment_intent.payment_failed written to order: ${failOrderId}`);
        return await succeedEvent();
      } catch (err: unknown) {
        return await failEvent(err instanceof Error ? err.message : String(err));
      }
    }

    // ── charge.refunded ─────────────────────────────────────────────────
    // H3: Wire refund to order update.
    // IMPORTANT: charge.metadata is NOT automatically populated from Checkout
    // Session metadata. We must look up the Checkout Session via the charge's
    // PaymentIntent ID. We try payment_intent metadata first (populated by
    // updated stripe-checkout), then fall back to Session lookup.
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      console.log(`[stripe-webhook] charge.refunded: ${charge.id}`);

      const refundPaymentIntentId = charge.payment_intent as string | undefined;

      if (!refundPaymentIntentId) {
        // No PaymentIntent → cannot be a Casabe Checkout charge → skip.
        // P0-R4-1: use skipEvent() — confirmed DB write or 500.
        console.log(`[stripe-webhook] charge.refunded: no payment_intent on charge ${charge.id} — skipping`);
        return await skipEvent('no_payment_intent');
      }

      // Try to resolve via PaymentIntent metadata first (populated by updated stripe-checkout)
      let refundOrderId: string | undefined;
      let refundTenantId: string | undefined;

      try {
        const pi = await stripe.paymentIntents.retrieve(refundPaymentIntentId);
        refundOrderId = pi.metadata?.order_id;
        refundTenantId = pi.metadata?.tenant_id;
      } catch {
        // Ignore retrieval errors — fall through to Session lookup below
      }

      // Fallback: look up Checkout Session by PaymentIntent ID
      if (!refundOrderId || !refundTenantId) {
        try {
          const refundSessions = await stripe.checkout.sessions.list({
            payment_intent: refundPaymentIntentId,
            limit: 1,
          });
          const refundSession = refundSessions.data[0];
          if (!refundSession) {
            // No Checkout Session → not a Casabe charge → skip.
            // P0-R4-1: use skipEvent() — confirmed DB write or 500.
            console.log(
              `[stripe-webhook] charge.refunded: no Casabe session for intent ${refundPaymentIntentId} — skipping`
            );
            return await skipEvent('no_casabe_session');
          }
          refundOrderId = refundSession.metadata?.order_id;
          refundTenantId = refundSession.metadata?.tenant_id;
        } catch (lookupErr: unknown) {
          return await failEvent(
            'charge.refunded: session lookup failed: ' +
            (lookupErr instanceof Error ? lookupErr.message : String(lookupErr))
          );
        }
      }

      if (!refundOrderId || !refundTenantId) {
        // No metadata found after all lookups → not a Casabe order → skip.
        // P0-R4-1: use skipEvent() — confirmed DB write or 500.
        console.log(
          `[stripe-webhook] charge.refunded: no metadata for charge ${charge.id} — skipping`
        );
        return await skipEvent('no_metadata');
      }

      // Verify order belongs to expected tenant
      const { data: refundOrder, error: refundOrderErr } = await supabase
        .from('orders')
        .select('id, tenant_id')
        .eq('id', refundOrderId)
        .eq('tenant_id', refundTenantId)
        .maybeSingle();

      if (refundOrderErr || !refundOrder) {
        return await failEvent(
          `charge.refunded: order not found or tenant mismatch: order=${refundOrderId} tenant=${refundTenantId}`
        );
      }

      try {
        const { error: refundUpdateErr } = await supabase.rpc('merge_stripe_payment_status', {
          p_order_id:       refundOrderId,
          p_tenant_id:      refundTenantId,
          p_payment_status: 'refunded',
        });
        if (refundUpdateErr) throw refundUpdateErr;
        console.log(`[stripe-webhook] charge.refunded written to order: ${refundOrderId}`);
        return await succeedEvent();
      } catch (err: unknown) {
        return await failEvent(err instanceof Error ? err.message : String(err));
      }
    }

    // ── All other events ─────────────────────────────────────────────────
    default:
      console.log(`[stripe-webhook] unhandled event type: ${event.type}`);
      // P0-R4-1: Use skipEvent() — confirmed DB write or 500 on failure.
      // Previously: bare .update() with no error/rowsAffected check,
      // leaving the row in 'processing' permanently on failure.
      return await skipEvent('unhandled_event_type');
  }
});

// ── ACCEPTANCE TESTS ──────────────────────────────────────────────────────
//
// TEST 1 (P0-M1/P0-M3 — atomic claim):
//   Simulate two concurrent Stripe deliveries of the same event.
//   Expected: only ONE caller receives claimed=true and processes the order.
//   The second caller receives claimed=false and returns 200 immediately.
//   SQL verify: stripe_events row has payment_status='processed', processed_at IS NOT NULL.
//
// TEST 2 (P1-M4 — payment_status gate):
//   Trigger checkout.session.completed with payment_status='unpaid' (async payment).
//   Expected: 200 returned with skipped='not_paid'. Order NOT updated to 'paid'.
//   SQL verify: order.data.payment.status unchanged from pre-test state.
//   Then trigger checkout.session.async_payment_succeeded.
//   Expected: order.data.payment.status = 'paid', order.data.payment.paid > 0.
//
// TEST 3 (non-2xx on order update failure):
//   Trigger checkout.session.completed for a non-existent order_id.
//   Expected: 500 returned. stripe_events.payment_status = 'failed'.
//   Stripe retries. On retry, claim_stripe_event() 'reclaims' the failed row.
//   SQL verify: stripe_events shows payment_status='failed', raw_error populated.
//
// TEST 4 (refund correlation via Checkout Session):
//   Trigger charge.refunded in Stripe dashboard for SMOKE-001.
//   Expected: order.data.payment.status = 'refunded'.
//   charge.metadata will NOT have order_id — resolved via Session/PI lookup.
//
// TEST 5 (payment failure correlation):
//   Use Stripe test card 4000000000000002.
//   Expected: order.data.payment.status = 'failed'.
//   (P1-R4-4: NOT 'payment_failed' — must be canonical 'failed')
//
// TEST 6 (P0-R4-1 — finalize_stripe_event rowsUpdated check):
//   Simulate finalize_stripe_event returning 0 rows (e.g. simulate by putting
//   row in 'processed' state before succeedEvent fires).
//   Expected: webhook returns 500 (not 200). Stripe retries.
//   SQL verify: stripe_events row NOT double-transitioned.
//
// TEST 7 (P1-R4-5 — amount_paid written):
//   Complete a payment for an order. session.amount_total = 5000 (= $50.00).
//   Expected: order.data.payment.paid = 50.00.
//   SQL verify:
//     SELECT data->'payment'->>'paid' AS paid_amount FROM orders WHERE id = 'SMOKE-001';
//     -- Expected: '50' (numeric, not 0)
//
// TEST 8 (P1-R4-5 — zero amount rejected):
//   Attempt checkout.session.completed with amount_total = 0 (edge case).
//   Expected: failEvent called, stripe_events.payment_status = 'failed'.
//
// SQL verify for all tests:
//   SELECT id,
//     data->'payment'->>'status'   AS payment_status,
//     data->'payment'->>'paid'     AS paid_amount,
//     data->>'stripe_session_id'   AS stripe_session_id_in_data
//   FROM orders WHERE id = 'SMOKE-001';
