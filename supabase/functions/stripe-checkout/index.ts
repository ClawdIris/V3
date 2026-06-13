// stripe-checkout Edge Function — Casabe Konnect R4 (Delta P0/P1 blockers fixed)
//
// SECURITY:
//   - Server-side role enforcement: only hq/admin/owner/office may create sessions.
//     Drivers and other roles get 403. Enforced via get_checkout_authorized_member()
//     RPC (service_role only) — NOT from client claims. (P0-M3)
//   - Amount is ALWAYS server-derived from order record (C1 — carried from R3)
//   - Currency is hardcoded 'usd' server-side — NEVER accepted from client (P1-1)
//   - payment_intent_data.metadata populated with order_id + tenant_id at session
//     creation time so webhook can resolve order on refund/failure without a
//     Session lookup (P0-M3 companion fix for stripe-webhook refund/failure path)
//   - STRIPE_SECRET_KEY from Deno.env only
//
// DO NOT DEPLOY without Delta review and Jefe sign-off.

import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Handle success/cancel redirects from Stripe
  const url = new URL(req.url);
  if (url.searchParams.get('success') === 'true') {
    return new Response(
      JSON.stringify({ status: 'success', message: 'Payment completed.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
  if (url.searchParams.get('cancelled') === 'true') {
    return new Response(
      JSON.stringify({ status: 'cancelled', message: 'Payment cancelled.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }

  // ── C1: Validate caller JWT via Supabase Auth ──────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'unauthorized', message: 'Missing or invalid Authorization header.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
    );
  }

  // Check STRIPE_SECRET_KEY — graceful unconfigured state
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeSecretKey) {
    return new Response(
      JSON.stringify({
        error: 'stripe_not_configured',
        message: 'Stripe is not configured for this account.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 503 }
    );
  }

  // Build caller-scoped Supabase client using the user's JWT.
  // This ensures the order lookup runs under that user's RLS context.
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  // Resolve user_id from the JWT via Supabase Auth.
  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) {
    return new Response(
      JSON.stringify({ error: 'unauthorized', message: 'Invalid or expired token.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
    );
  }
  const userId = user.id;

  // ── P0-M3: Server-side role enforcement via get_checkout_authorized_member() ──
  //
  // SECURITY: This RPC is SECURITY DEFINER and restricted to service_role only.
  // It returns (tenant_id, member_role) ONLY if the caller has an authorized
  // role: hq, admin, owner, or office.
  //
  // Drivers and all other roles get 0 rows back → 403 Forbidden.
  //
  // This is NOT based on anything the client supplies — it derives the role
  // purely from the server-side members table lookup using the JWT user_id.
  //
  // Why not use the old memberRow.role approach?
  //   - The old code only checked active=true, not the role.
  //   - Any active member (including drivers) could initiate Checkout Sessions.
  //   - The UI blocked drivers but there was no server-side enforcement.
  //   - This RPC adds the role check server-side, exactly as Delta required.
  const supabaseAdmin = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: authMemberRows, error: authMemberErr } = await supabaseAdmin
    .rpc('get_checkout_authorized_member', { p_user_id: userId });

  if (authMemberErr) {
    console.error(
      `[stripe-checkout] get_checkout_authorized_member RPC error for user=${userId}:`,
      authMemberErr.message
    );
    return new Response(
      JSON.stringify({ error: 'internal_error', message: 'Role authorization check failed.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }

  // 0 rows → user has no authorized membership (driver, no member row, or wrong role)
  if (!authMemberRows || authMemberRows.length === 0) {
    console.warn(
      `[stripe-checkout] P0-M3: user=${userId} has no checkout-authorized role — 403`
    );
    return new Response(
      JSON.stringify({
        error: 'forbidden',
        message: 'Only HQ, admin, owner, or office members may initiate payment.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
    );
  }

  // Use server-derived tenant_id from the authorized membership row.
  // NEVER trust tenant_id from the client request body.
  const jwtTenantId: string = authMemberRows[0].tenant_id;
  const memberRole: string = authMemberRows[0].member_role;

  console.log(
    `[stripe-checkout] authorized: user=${userId} role=${memberRole} tenant=${jwtTenantId}`
  );

  // Parse request body
  let body: {
    order_id?: string;
    invoice_id?: string;
    amount_cents?: number;  // IGNORED — kept only for logging/rejection
    description?: string;
    // NOTE: currency is intentionally NOT accepted from the client (P1-1 fix).
    // It is fixed to 'usd' server-side below. Any currency field in the
    // request body is silently ignored and logged.
  };

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_request', message: 'Request body must be valid JSON.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // ── C1 + P1-1: Currency is hardcoded server-side; amount from order only ──
  // NEVER accept currency or amount from the client. Both are determined
  // server-side to prevent payment amount manipulation.
  const currency = 'usd'; // Hardcoded — never from client
  const { order_id, invoice_id, description } = body;

  if (body.amount_cents !== undefined) {
    console.warn(
      `[stripe-checkout] C1: client-supplied amount_cents=${body.amount_cents} ignored for order_id=${order_id} user=${userId}`
    );
  }
  if ((body as Record<string, unknown>).currency !== undefined) {
    console.warn(
      `[stripe-checkout] P1-1: client-supplied currency=${
        (body as Record<string, unknown>).currency
      } ignored for order_id=${order_id} user=${userId} — currency is fixed to '${currency}'`
    );
  }

  if (!order_id) {
    return new Response(
      JSON.stringify({ error: 'invalid_request', message: 'order_id is required.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // ── C1: Server-side order lookup with tenant isolation ───────────────────
  // Fetch the order using service-role so we can read the data JSONB.
  // Cross-check: order must belong to the JWT-derived tenant_id.
  const { data: orderRow, error: orderErr } = await supabaseAdmin
    .from('orders')
    .select('id, tenant_id, data')
    .eq('id', order_id)
    .eq('tenant_id', jwtTenantId)
    .maybeSingle();

  if (orderErr || !orderRow) {
    console.error(
      `[stripe-checkout] C1: order not found or tenant mismatch order_id=${order_id} tenant=${jwtTenantId}`
    );
    return new Response(
      JSON.stringify({ error: 'forbidden', message: 'Order not found or access denied.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
    );
  }

  // ── C1: Derive amount server-side from order data ────────────────────────
  // Primary: order.data.payment.amount (stored in dollars → convert to cents)
  // Fallback: order.data.invoiceTotal (also dollars)
  // Both are set server-side when the order is created; neither is client-mutable.
  const orderData = orderRow.data as Record<string, unknown>;
  let derivedAmountCents: number | null = null;

  const paymentBlock = orderData?.payment as Record<string, unknown> | undefined;
  if (paymentBlock?.amount !== undefined && paymentBlock.amount !== null) {
    const dollars = parseFloat(String(paymentBlock.amount));
    if (!isNaN(dollars) && dollars > 0) {
      derivedAmountCents = Math.round(dollars * 100);
    }
  }

  if (derivedAmountCents === null) {
    const invoiceTotal = parseFloat(String(orderData?.invoiceTotal ?? orderData?.totalAmount ?? ''));
    if (!isNaN(invoiceTotal) && invoiceTotal > 0) {
      derivedAmountCents = Math.round(invoiceTotal * 100);
    }
  }

  if (!derivedAmountCents || derivedAmountCents <= 0) {
    console.error(
      `[stripe-checkout] C1: could not derive amount from order data for order_id=${order_id}`,
      JSON.stringify(orderData)
    );
    return new Response(
      JSON.stringify({ error: 'invalid_order', message: 'Order does not have a valid payable amount.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 422 }
    );
  }

  // Create Stripe Checkout Session using the server-derived amount
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const baseUrl = 'https://exayifxbqduhsxmmsnxr.supabase.co/functions/v1/stripe-checkout';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(), // always 'usd'
            product_data: {
              name: description || `Invoice ${invoice_id || order_id || 'Payment'}`,
            },
            // ── C1: server-derived amount ONLY — never client-supplied ──
            unit_amount: derivedAmountCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}?success=true`,
      cancel_url: `${baseUrl}?cancelled=true`,

      // ── Session-level metadata (for checkout.session.completed) ───────
      metadata: {
        order_id:   order_id,
        tenant_id:  jwtTenantId,   // Always JWT-derived, never client-supplied
        invoice_id: invoice_id || '',
      },

      // ── P0-M3: payment_intent_data.metadata (for refund/failure webhook) ──
      //
      // Stripe does NOT automatically copy Checkout Session metadata to the
      // PaymentIntent or Charge. This means charge.metadata and
      // payment_intent.metadata are empty by default — the webhook cannot
      // resolve order_id/tenant_id from them on refund or failure.
      //
      // FIX: Set payment_intent_data.metadata explicitly at session creation
      // time. The webhook (stripe-webhook/index.ts) will read
      // intent.metadata.order_id and intent.metadata.tenant_id for refund
      // and failure events, eliminating the need for a Checkout Session
      // lookup on every refund/failure (and working even if sessions are
      // expired or deleted).
      //
      // Note: payment_intent_data can only be set when mode = 'payment'.
      payment_intent_data: {
        metadata: {
          order_id:   order_id,
          tenant_id:  jwtTenantId,
          invoice_id: invoice_id || '',
        },
      },
    });

    return new Response(
      JSON.stringify({
        checkout_url: session.url,
        session_id:   session.id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Stripe error';
    console.error('[stripe-checkout] Stripe session creation error:', message);
    return new Response(
      JSON.stringify({ error: 'stripe_error', message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// ── ACCEPTANCE TESTS ──────────────────────────────────────────────────────
//
// TEST 1 (P0-M3 — role enforcement):
//   POST as a driver user (valid JWT, active membership, role='driver').
//   Expected: 403 Forbidden — "Only HQ, admin, owner, or office members may initiate payment."
//
// TEST 2 (P0-M3 — authorized role):
//   POST as an hq/admin/owner/office user.
//   Expected: 200 with checkout_url and session_id.
//
// TEST 3 (P1-1 — currency hardcoded):
//   POST with { order_id: "SMOKE-001", currency: "eur" }.
//   Expected: Stripe session created with currency='usd' (not eur).
//   Verify session.currency === 'usd' in Stripe Dashboard.
//
// TEST 4 (C1 — amount server-derived):
//   POST with { order_id: "SMOKE-001", amount_cents: 1 }.
//   Expected: Stripe session created for the real order amount, not $0.01.
//
// TEST 5 (P0-M3 — payment_intent_data.metadata):
//   After creating a session, inspect the PaymentIntent in Stripe Dashboard.
//   Expected: PaymentIntent.metadata has order_id and tenant_id set.
//   This enables the webhook to resolve the order on refund/failure without
//   a Checkout Session lookup.
