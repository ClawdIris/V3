// stripe-webhook Edge Function — Casabe Konnect R6
// Security: signature verification, idempotency (stripe_events table),
// tenant/order cross-check, and payment_status lifecycle tracking.
// STRIPE_WEBHOOK_SECRET is read from Deno.env only — never client-side.

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

  // Supabase service-role client — required for stripe_events and order writes
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // ── Item 1a: Idempotency check ──────────────────────────────────────────
  // Check if this event has already been processed
  const { data: existingEvent } = await supabase
    .from('stripe_events')
    .select('id')
    .eq('id', event.id)
    .single();

  if (existingEvent) {
    // Already processed — return 200 safely
    console.log(`[stripe-webhook] duplicate event ignored: ${event.id}`);
    return new Response(
      JSON.stringify({ received: true, duplicate: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }

  // Handle events
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;

      // ── Item 2: Tenant/Order Verification ──────────────────────────────
      const orderId = session.metadata?.order_id;
      const metaTenantId = session.metadata?.tenant_id;

      if (!orderId || !metaTenantId) {
        console.error('[stripe-webhook] missing order_id or tenant_id in metadata');
        return new Response(
          JSON.stringify({ error: 'Missing metadata' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      // Verify order exists and belongs to expected tenant
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('id, tenant_id')
        .eq('id', orderId)
        .eq('tenant_id', metaTenantId)
        .single();

      if (orderErr || !order) {
        console.error('[stripe-webhook] order not found or tenant mismatch', { orderId, metaTenantId });
        // Insert rejected event record before returning
        await supabase.from('stripe_events').insert({
          id: event.id,
          event_type: event.type,
          order_id: orderId,
          tenant_id: metaTenantId,
          payment_status: 'rejected',
          raw_error: 'order not found or tenant mismatch'
        });
        return new Response(
          JSON.stringify({ error: 'Order/tenant mismatch' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      // ── Item 1b: Reserve event BEFORE processing ────────────────────────
      await supabase.from('stripe_events').insert({
        id: event.id,
        event_type: event.type,
        order_id: orderId,
        tenant_id: metaTenantId,
        payment_status: 'processing'
      });

      try {
        const session_id = session.id;
        const invoice_id = session.metadata?.invoice_id || '';
        console.log(`[stripe-webhook] payment completed: ${session_id}, order_id: ${orderId}, invoice_id: ${invoice_id}`);

        // Update order payment status to paid
        await supabase
          .from('orders')
          .update({
            stripe_session_id: session_id,
            payment: { status: 'paid', method: 'stripe', stripe_session_id: session_id }
          })
          .eq('id', orderId)
          .eq('tenant_id', metaTenantId);

        // ── Item 1c: Mark event as processed ────────────────────────────
        await supabase.from('stripe_events').update({
          payment_status: 'processed',
          processed_at: new Date().toISOString()
        }).eq('id', event.id);

      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[stripe-webhook] processing error:', errMsg);
        // ── Item 1d: Mark event as failed with error ─────────────────────
        await supabase.from('stripe_events').update({
          payment_status: 'failed',
          raw_error: errMsg
        }).eq('id', event.id);
        return new Response(
          JSON.stringify({ error: 'Processing failed', detail: errMsg }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }

      break;
    }

    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent;
      console.log(`[stripe-webhook] payment failed: ${intent.id}`);

      // Reserve event
      await supabase.from('stripe_events').insert({
        id: event.id,
        event_type: event.type,
        order_id: null,
        tenant_id: null,
        payment_status: 'processing'
      });

      try {
        // Log failure — update orders where stripe_payment_intent_id matches if available
        console.log(`[stripe-webhook] payment_intent.payment_failed logged: ${intent.id}`);

        await supabase.from('stripe_events').update({
          payment_status: 'processed',
          processed_at: new Date().toISOString()
        }).eq('id', event.id);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await supabase.from('stripe_events').update({
          payment_status: 'failed',
          raw_error: errMsg
        }).eq('id', event.id);
      }
      break;
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      console.log(`[stripe-webhook] charge refunded: ${charge.id}`);

      // Reserve event
      await supabase.from('stripe_events').insert({
        id: event.id,
        event_type: event.type,
        order_id: null,
        tenant_id: null,
        payment_status: 'processing'
      });

      try {
        console.log(`[stripe-webhook] charge.refunded logged: ${charge.id}`);

        await supabase.from('stripe_events').update({
          payment_status: 'processed',
          processed_at: new Date().toISOString()
        }).eq('id', event.id);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await supabase.from('stripe_events').update({
          payment_status: 'failed',
          raw_error: errMsg
        }).eq('id', event.id);
      }
      break;
    }

    default:
      // All other events acknowledged but not processed
      console.log(`[stripe-webhook] unhandled event type: ${event.type}`);
      return new Response(
        JSON.stringify({ received: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
  }

  return new Response(
    JSON.stringify({ received: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
});
