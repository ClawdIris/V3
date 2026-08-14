# Stripe Setup Checklist — Jefe / Owner
**For: Casabe Konnect Beta — Phase 7 Payments**
**Complete before Slice 7.2 build can start**

---

## Step 1 — Create Stripe Account (if not done)

1. Go to https://dashboard.stripe.com/register
2. Create account with business email
3. Business type: **Company** (not individual)
4. Business name: **Casabe Konnect** (or the legal entity name)
5. Do NOT activate live mode yet — stay in **test mode** for beta

---

## Step 2 — Get Your Test Secret Key

1. In Stripe dashboard → top-left dropdown → make sure you're in **Test mode** (toggle visible at top)
2. Go to: **Developers → API keys**
3. Copy **Secret key** — starts with `sk_test_...`
4. ⚠️ Never share this key in chat, email, or text. Treat like a password.

---

## Step 3 — Add Secret Key to Supabase

1. Go to: https://supabase.com/dashboard/project/exayifxbqduhsxmmsnxr/functions
2. Click **Edge Functions** in the left sidebar
3. Click **Manage secrets** (or "Environment variables")
4. Add:
   - Name: `STRIPE_SECRET_KEY`
   - Value: `sk_test_...` (your test secret key from Step 2)
5. Save

---

## Step 4 — Register the Webhook Endpoint in Stripe

1. In Stripe dashboard → **Developers → Webhooks**
2. Click **+ Add endpoint**
3. Endpoint URL:
   ```
   https://exayifxbqduhsxmmsnxr.supabase.co/functions/v1/stripe-webhook
   ```
4. Select events to listen for:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `payment_intent.payment_failed`
   - `charge.refunded`
5. Click **Add endpoint**

---

## Step 5 — Get Your Webhook Signing Secret

1. After creating the webhook endpoint, click on it
2. Under **Signing secret** → click **Reveal**
3. Copy the value — starts with `whsec_...`

---

## Step 6 — Add Webhook Secret to Supabase

1. Back to: https://supabase.com/dashboard/project/exayifxbqduhsxmmsnxr/functions
2. **Manage secrets** again
3. Add:
   - Name: `STRIPE_WEBHOOK_SECRET`
   - Value: `whsec_...` (your webhook signing secret from Step 5)
4. Save

---

## Step 7 — Send Iris the Confirmation

Once both secrets are added to Supabase, tell Iris:
> "Stripe secrets are in Supabase — STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET both added."

Do NOT send the actual key values. Iris just needs to know they're set.

---

## Summary — What Iris needs confirmed before 7.2 build starts

| Item | Status |
|---|---|
| Stripe account created | ⬜ Pending |
| `STRIPE_SECRET_KEY` added to Supabase secrets | ⬜ Pending |
| `STRIPE_WEBHOOK_SECRET` added to Supabase secrets | ⬜ Pending |
| Webhook endpoint registered in Stripe dashboard | ⬜ Pending |
| Delta SQL migration approved | ⬜ Pending (Iris handles) |

---

## Test Mode vs Live Mode

**Beta runs in TEST MODE only.**
- Test card: `4242 4242 4242 4242` — any future expiry, any CVV
- No real money moves in test mode
- Live mode requires explicit approval from Jefe after beta validation

---

## After Beta — Live Mode Switch

When ready to go live:
1. Stripe dashboard → complete business verification
2. Get live secret key (`sk_live_...`)
3. Register a NEW webhook endpoint for live mode
4. Update both Supabase secrets with live values
5. Set `is_live = true` in `stripe_configs` table
6. Explicit Jefe approval required before this step

---

*Questions? Ask Iris. Do not share key values in chat.*
