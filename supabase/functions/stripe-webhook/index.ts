// stripe-webhook Edge Function — Casabe Konnect Phase 7 Slice 7.1
// Scaffold: handles Stripe webhook events with signature verification.
// STRIPE_WEBHOOK_SECRET is read from Deno.env only — never client-side.
//
// TODO: DB writes pending Delta SQL audit approval.
//       All payment state changes are logged below; no DB mutations yet.

import Stripe from 'https://esm.sh/stripe@14?target=deno';

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

  // Handle events
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const session_id = session.id;
      const order_id = session.metadata?.order_id || '';
      const invoice_id = session.metadata?.invoice_id || '';
      console.log(`[stripe-webhook] payment completed: ${session_id}, order_id: ${order_id}, invoice_id: ${invoice_id}`);
      // TODO: DB writes pending Delta SQL audit approval
      // e.g. UPDATE orders SET payment_status = 'paid', stripe_session_id = session_id WHERE id = order_id
      break;
    }

    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent;
      console.log(`[stripe-webhook] payment failed: ${intent.id}`);
      // TODO: DB writes pending Delta SQL audit approval
      // e.g. UPDATE orders SET payment_status = 'failed' WHERE stripe_payment_intent_id = intent.id
      break;
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      console.log(`[stripe-webhook] charge refunded: ${charge.id}`);
      // TODO: DB writes pending Delta SQL audit approval
      // e.g. UPDATE orders SET payment_status = 'refunded' WHERE stripe_charge_id = charge.id
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
