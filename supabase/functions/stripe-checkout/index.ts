// stripe-checkout Edge Function — Casabe Konnect
// v8: success/cancel redirect base points to the production custom domain
//     casabekonnect.app (was the netlify URL). Everything else unchanged from v7.
//
// SECURITY (unchanged):
//   - Server-side role enforcement via get_checkout_authorized_member() RPC
//   - Amount ALWAYS server-derived from the order record
//   - Currency hardcoded 'usd' server-side
//   - payment_intent_data.metadata carries order_id + tenant_id for the webhook
//   - STRIPE_SECRET_KEY from Deno.env only

import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'unauthorized', message: 'Missing or invalid Authorization header.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
    );
  }

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeSecretKey) {
    return new Response(
      JSON.stringify({ error: 'stripe_not_configured', message: 'Stripe is not configured for this account.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 503 }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) {
    return new Response(
      JSON.stringify({ error: 'unauthorized', message: 'Invalid or expired token.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
    );
  }
  const userId = user.id;

  const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  const { data: authMemberRows, error: authMemberErr } = await supabaseAdmin
    .rpc('get_checkout_authorized_member', { p_user_id: userId });

  if (authMemberErr) {
    console.error(`[stripe-checkout] get_checkout_authorized_member RPC error for user=${userId}:`, authMemberErr.message);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: 'Role authorization check failed.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }

  if (!authMemberRows || authMemberRows.length === 0) {
    console.warn(`[stripe-checkout] user=${userId} has no checkout-authorized role — 403`);
    return new Response(
      JSON.stringify({ error: 'forbidden', message: 'Only HQ, admin, owner, or office members may initiate payment.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
    );
  }

  const jwtTenantId: string = authMemberRows[0].tenant_id;
  const memberRole: string = authMemberRows[0].member_role;
  console.log(`[stripe-checkout] authorized: user=${userId} role=${memberRole} tenant=${jwtTenantId}`);

  let body: { order_id?: string; invoice_id?: string; amount_cents?: number; description?: string; };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_request', message: 'Request body must be valid JSON.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  const currency = 'usd';
  const { order_id, invoice_id, description } = body;

  if (body.amount_cents !== undefined) {
    console.warn(`[stripe-checkout] client-supplied amount_cents=${body.amount_cents} ignored for order_id=${order_id}`);
  }
  if ((body as Record<string, unknown>).currency !== undefined) {
    console.warn(`[stripe-checkout] client-supplied currency ignored — fixed to '${currency}'`);
  }

  if (!order_id) {
    return new Response(
      JSON.stringify({ error: 'invalid_request', message: 'order_id is required.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  const { data: orderRow, error: orderErr } = await supabaseAdmin
    .from('orders').select('id, tenant_id, data')
    .eq('id', order_id).eq('tenant_id', jwtTenantId).maybeSingle();

  if (orderErr || !orderRow) {
    console.error(`[stripe-checkout] order not found or tenant mismatch order_id=${order_id} tenant=${jwtTenantId}`);
    return new Response(
      JSON.stringify({ error: 'forbidden', message: 'Order not found or access denied.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
    );
  }

  const orderData = orderRow.data as Record<string, unknown>;
  let derivedAmountCents: number | null = null;

  const paymentBlock = orderData?.payment as Record<string, unknown> | undefined;
  if (paymentBlock?.amount !== undefined && paymentBlock.amount !== null) {
    const dollars = parseFloat(String(paymentBlock.amount));
    if (!isNaN(dollars) && dollars > 0) derivedAmountCents = Math.round(dollars * 100);
  }
  if (derivedAmountCents === null) {
    const invoiceTotal = parseFloat(String(orderData?.invoiceTotal ?? orderData?.totalAmount ?? ''));
    if (!isNaN(invoiceTotal) && invoiceTotal > 0) derivedAmountCents = Math.round(invoiceTotal * 100);
  }
  if (!derivedAmountCents || derivedAmountCents <= 0) {
    console.error(`[stripe-checkout] could not derive amount for order_id=${order_id}`, JSON.stringify(orderData));
    return new Response(
      JSON.stringify({ error: 'invalid_order', message: 'Order does not have a valid payable amount.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 422 }
    );
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });

  // v8: production custom domain. Customers land on the public tracking page for
  // their order (no login, shows status). Never the function URL.
  const appBase = 'https://casabekonnect.app/';
  const successUrl = appBase + '?number=' + encodeURIComponent(order_id) + '&payment=success';
  const cancelUrl  = appBase + '?number=' + encodeURIComponent(order_id) + '&payment=cancelled';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: currency.toLowerCase(),
          product_data: { name: description || `Invoice ${invoice_id || order_id || 'Payment'}` },
          unit_amount: derivedAmountCents,
        },
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { order_id: order_id, tenant_id: jwtTenantId, invoice_id: invoice_id || '' },
      payment_intent_data: { metadata: { order_id: order_id, tenant_id: jwtTenantId, invoice_id: invoice_id || '' } },
    });

    return new Response(
      JSON.stringify({ checkout_url: session.url, session_id: session.id }),
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
