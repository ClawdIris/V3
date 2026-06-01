# Phase 7 — Slice 7.2 Implementation Plan
**Status: PLAN ONLY — no code until gate conditions met**
**Written: 2026-06-01 | Author: Iris / Forge prep**

---

## Gate Conditions (ALL required before a single line of 7.2 is written)

- [ ] `STRIPE_SECRET_KEY` added to Supabase Edge Function secrets
- [ ] `STRIPE_WEBHOOK_SECRET` added to Supabase Edge Function secrets
- [ ] Delta approves `stripe_configs` migration (see PHASE7-STRIPE-MIGRATION.md)
- [ ] Live Stripe test checkout session can be created end-to-end (7.1 smoke with real key)
- [ ] Jefe explicit go-ahead on 7.2

---

## 1. Webhook Event Types to Handle

| Event | Trigger | Action |
|---|---|---|
| `checkout.session.completed` | Customer paid successfully | Mark invoice paid, mark order payment status, create payment record |
| `payment_intent.payment_failed` | Card declined / payment failed | Mark invoice/order as `payment_failed`, log error message |
| `charge.refunded` | Full or partial refund issued | Mark invoice `refunded` or `partially_refunded`, log refund amount |
| `checkout.session.expired` | Session timed out (30 min default) | Mark invoice `payment_expired`, allow new link generation |

All other event types → return HTTP 200 `{ received: true }` and ignore. Never return 4xx for unknown events (Stripe retries on non-2xx).

---

## 2. Invoice / Order / Payment Fields to Update

### `invoices` table
| Field | Value set |
|---|---|
| `payment_status` | `'paid'` / `'payment_failed'` / `'refunded'` / `'payment_expired'` |
| `stripe_session_id` | From `checkout.session.id` |
| `stripe_payment_intent_id` | From `checkout.session.payment_intent` |
| `paid_at` | `now()` on `checkout.session.completed` |
| `updated_at` | `now()` on every update |

### `orders` table
| Field | Value set |
|---|---|
| `payment_status` | Mirror from invoice — `'paid'` / `'payment_failed'` |
| `updated_at` | `now()` |

### `payments` table (existing)
Insert new row on `checkout.session.completed`:
| Field | Value |
|---|---|
| `order_id` | From session metadata |
| `tenant_id` | From session metadata |
| `invoice_id` | From session metadata |
| `amount` | `session.amount_total / 100` (cents → dollars) |
| `currency` | `session.currency` |
| `payment_method` | `'stripe'` |
| `stripe_session_id` | `session.id` |
| `stripe_payment_intent_id` | `session.payment_intent` |
| `status` | `'paid'` |
| `paid_at` | `now()` |
| `tenant_id` | From metadata |

---

## 3. Idempotency Strategy

**Problem:** Stripe retries webhook delivery up to 3 days on non-2xx responses. Must never double-process.

**Solution: stripe_session_id uniqueness check**

Before processing `checkout.session.completed`:
```sql
SELECT id FROM payments
WHERE stripe_session_id = $1 AND tenant_id = $2
LIMIT 1;
```
- If row exists → return HTTP 200 `{ received: true, duplicate: true }` immediately, no writes
- If not exists → process and insert

For `charge.refunded` — check `stripe_payment_intent_id` + `status = 'refunded'` before updating.

**Additional guard:** `stripe_session_id` column on `payments` gets a UNIQUE constraint (part of Delta migration review).

---

## 4. Failure Logging

### What gets logged on every webhook
```
[stripe-webhook] event=checkout.session.completed session=cs_xxx order=TEST-001 tenant=test-tenant status=processing
[stripe-webhook] event=checkout.session.completed session=cs_xxx status=success writes=3
```

### On DB write failure
```
[stripe-webhook] ERROR event=checkout.session.completed session=cs_xxx error="<pg error>" — writes rolled back
```
- Return HTTP 500 so Stripe retries
- Do NOT return 200 on partial write — idempotency guard handles safe retry

### On signature verification failure
```
[stripe-webhook] INVALID_SIGNATURE — rejected
```
- Return HTTP 400 — Stripe does NOT retry 4xx

### `stripe_webhook_log` table (for Delta review — not applied yet)
Logs every received event for audit trail:
| Field | Type |
|---|---|
| `id` | UUID PK |
| `tenant_id` | TEXT |
| `stripe_event_id` | TEXT UNIQUE (idempotency at DB level) |
| `event_type` | TEXT |
| `session_id` | TEXT |
| `processed` | BOOLEAN DEFAULT false |
| `error` | TEXT |
| `received_at` | TIMESTAMPTZ DEFAULT now() |

---

## 5. RLS Impact

### Tables touched by webhook (server-side Supabase client, service_role key)
The webhook Edge Function must use the **service_role key** (not anon key) to bypass RLS for writes. This is correct — the webhook is authenticated by Stripe signature, not user session.

```ts
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // bypasses RLS intentionally
  { auth: { persistSession: false } }
);
```

### RLS on new columns (`stripe_session_id`, `stripe_payment_intent_id`, `paid_at`)
- These are new columns on existing `invoices` and `payments` tables
- Existing RLS policies on those tables already enforce tenant_id scoping
- New columns inherit existing policies — no new policies needed for columns
- Delta audit must verify: existing policies cover UPDATE on invoices + payments for these columns

### `stripe_webhook_log` table (new)
Needs full RLS:
- HQ: SELECT own tenant rows
- service_role: INSERT (webhook writes)
- anon: blocked
- No Office/Driver access

---

## Implementation Sequence (when gates open)

1. Delta approves migration → apply `stripe_configs` + new columns on `invoices`/`payments` + `stripe_webhook_log`
2. Update `stripe-webhook/index.ts` — replace TODO comments with real DB writes
3. Update `stripe-checkout/index.ts` — pull `publishable_key` from `stripe_configs` table
4. UI: show invoice `payment_status` badge (Paid/Failed/Expired/Refunded)
5. Auto-trigger receipt generation on paid status
6. Tests: webhook idempotency, signature rejection, paid status propagation
7. Browser smoke: end-to-end with Stripe test card

---

*Do not implement until all gate conditions above are met and Jefe gives explicit go.*
