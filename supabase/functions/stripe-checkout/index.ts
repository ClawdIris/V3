// stripe-checkout Edge Function — Casabe Konnect Phase 7 Slice 7.1
// Scaffold: creates a Stripe Checkout Session for invoice payments.
// STRIPE_SECRET_KEY is read from Deno.env only — never exposed to client.

import Stripe from 'https://esm.sh/stripe@14?target=deno';

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

  // Verify Supabase auth header before calling Stripe
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

  // Parse request body
  let body: {
    order_id?: string;
    tenant_id?: string;
    invoice_id?: string;
    amount_cents?: number;
    currency?: string;
    description?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_request', message: 'Request body must be valid JSON.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  const { order_id, tenant_id, invoice_id, amount_cents, currency = 'usd', description } = body;

  if (!amount_cents || amount_cents <= 0) {
    return new Response(
      JSON.stringify({ error: 'invalid_amount', message: 'amount_cents must be a positive integer.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Create Stripe Checkout Session
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
            currency: currency.toLowerCase(),
            product_data: {
              name: description || `Invoice ${invoice_id || order_id || 'Payment'}`,
            },
            unit_amount: amount_cents,
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}?success=true`,
      cancel_url: `${baseUrl}?cancelled=true`,
      metadata: {
        order_id: order_id || '',
        tenant_id: tenant_id || '',
        invoice_id: invoice_id || '',
      },
    });

    return new Response(
      JSON.stringify({
        checkout_url: session.url,
        session_id: session.id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Stripe error';
    return new Response(
      JSON.stringify({ error: 'stripe_error', message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
