# Phase 7 — Payments + Accounting Roadmap
**Added: 2026-06-01 14:57 EDT — Jefe directive**
**Status: 🟡 READY TO BUILD — Phase 6 closed 2026-06-01 16:39 EDT. Awaiting Jefe answers to open questions before Slice 7.1 starts.**

---

## Why This Is a Beta Blocker

The beta promise is **industry automation** — not just order tracking.
Payments and accounting must be connected before beta ships.
Stripe + QuickBooks are not post-beta anymore. They ARE Phase 7 beta blockers.

---

## Slice Sequence

| Slice | Scope | Trigger |
|---|---|---|
| **7.1** | Stripe config + Checkout Session Edge Function | ✅ COMPLETE — commits b447c7f, 588d5b8, e57de82 |
| **7.2** | Stripe webhook + payment status update | After 7.1 smoke passes |
| **7.3** | QuickBooks OAuth connect/disconnect | After 7.2 smoke passes |
| **7.4** | QuickBooks invoice/payment sync | After 7.3 smoke passes |
| **7.5** | End-to-end browser smoke (one real company) | After 7.4 smoke passes |

---

## Phase 7A — Stripe Beta Integration

### Goal
Casabe generates a real Stripe Checkout payment from an invoice/order total and updates payment status automatically.

### Requirements

1. **Company-level Stripe config** — HQ-only setup page, server-side secrets only
   - `STRIPE_SECRET_KEY` stored in Supabase Edge Function secrets (per tenant)
   - Publishable key stored in `stripe_configs` table (safe to expose)
   - Never in app JS bundle, never in localStorage

2. **Edge Function: `stripe-checkout`**
   - Input: `{ order_id, tenant_id, invoice_id, amount, currency }`
   - Creates Stripe Checkout Session (server-side, secret key)
   - Returns `{ checkout_url, session_id }` to UI
   - Success/cancel redirect URLs point back to app

3. **UI: Payment Link flow**
   - "Generate Payment Link" button on invoice/order detail
   - Shows checkout_url — copy button + "Send via WhatsApp" shortcut
   - Labeled "Stripe Checkout" (not "manual payment link")

4. **Manual Payment Link fallback** (already exists)
   - Stays available, labeled clearly as "Manual Payment Link"
   - Used until API is live per slice

5. **Edge Function: `stripe-webhook`**
   - Verifies Stripe signature (webhook secret)
   - Handles: `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`
   - On success → updates: `payments`, `invoices`, `orders` tables
   - On failure/cancel → updates status, shows friendly UI state

6. **No card data stored in Casabe** — ever. Stripe handles all PCI scope.

7. **Receipt auto-generated** on successful payment webhook

8. **Failed/cancelled/refunded** payments show friendly status — no silent failure

### New Supabase tables (Delta approval required before apply)

```sql
-- stripe_configs: one row per tenant
CREATE TABLE stripe_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL UNIQUE,
  publishable_key TEXT NOT NULL,          -- safe to show in UI
  -- secret_key: stored in Supabase Edge Function secrets, NOT this table
  webhook_secret TEXT,                    -- encrypted or Edge Function secret
  is_live BOOLEAN DEFAULT false,          -- false = test mode
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE stripe_configs ENABLE ROW LEVEL SECURITY;
-- HQ only, tenant-scoped
```

---

## Phase 7B — QuickBooks Beta Integration

### Goal
Paid Casabe invoices/payments sync into the company's QuickBooks account automatically.

### Requirements

1. **QuickBooks OAuth page** (HQ-only)
   - Connect / disconnect QuickBooks account
   - Shows: connected company name, realm_id, token status
   - Per-company — `tenant_id` scoped, not global

2. **Sync: Customer**
   - Create/update QB Customer record from Casabe order.name + phone
   - Store `qb_customer_id` on Casabe customer/order record

3. **Sync: Invoice**
   - Create QB Invoice from Casabe invoice record
   - Store `qb_invoice_id` to prevent re-creation
   - Line items: box type, quantity, price

4. **Sync: Payment**
   - Create QB Payment linked to QB Invoice
   - Store `qb_payment_id`

5. **Duplicate prevention**
   - Check `qb_invoice_id` before creating — if exists, update not create
   - Same for customer and payment

6. **Sync status per record**
   - `not_connected` | `pending` | `synced` | `failed`
   - Shown on invoice list + invoice detail
   - Failed records show error message + Retry button

7. **QuickBooks down = operations unaffected**
   - Sync runs async, never blocks order save/invoice generate
   - Failed sync queues for retry, doesn't error the UI

### New Supabase tables (Delta approval required before apply)

```sql
-- qb_configs: one row per tenant
CREATE TABLE qb_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL UNIQUE,
  realm_id TEXT NOT NULL,                 -- QuickBooks company ID
  access_token TEXT NOT NULL,             -- encrypted
  refresh_token TEXT NOT NULL,            -- encrypted
  expires_at TIMESTAMPTZ NOT NULL,
  company_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE qb_configs ENABLE ROW LEVEL SECURITY;

-- qb_sync_log: per-record sync history
CREATE TABLE qb_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,              -- 'customer' | 'invoice' | 'payment'
  casabe_id TEXT NOT NULL,               -- Casabe record ID
  qb_id TEXT,                            -- QuickBooks external ID (null until synced)
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'synced' | 'failed'
  error TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE qb_sync_log ENABLE ROW LEVEL SECURITY;
-- HQ only, tenant-scoped policies on both tables
```

---

## End-to-End Acceptance Test

Before Phase 7 is closed, this full flow must pass in a real browser:

1. ✅ Create order
2. ✅ Generate invoice in Casabe
3. ✅ Click "Generate Payment Link" → Stripe Checkout Session created → URL returned
4. ✅ Pay test invoice in Stripe test mode
5. ✅ Stripe webhook fires → Casabe marks invoice/order paid automatically
6. ✅ Payment receipt generated and viewable
7. ✅ QuickBooks sync triggered → customer/invoice/payment appear in QB sandbox
8. ✅ Run sync again → no duplicates created in QuickBooks

---

## Implementation Rules

- No placeholder/stub implementations count as done
- Browser smoke required after each slice
- **Delta SQL approval required** before any Supabase table is created
- Stripe test mode first — live mode requires explicit Jefe approval
- QuickBooks sandbox first — production credentials require explicit Jefe approval
- Server-side only for all payment keys — never in JS bundle or localStorage
- Failed QuickBooks sync must NEVER block order operations

---

## Open Questions (resolve before Slice 7.1 starts — BLOCKING)

1. **Stripe account**: Does Jefe have a Stripe account, or does cousin handle this too?
2. **Stripe test key**: Need `STRIPE_SECRET_KEY` (test) to start Slice 7.1
3. **QuickBooks sandbox**: Need QuickBooks developer account + sandbox credentials for Slice 7.3
4. **Webhook endpoint**: Supabase Edge Function URL will be the Stripe webhook endpoint — confirm domain before configuring in Stripe dashboard
5. **Multi-tenant Stripe**: One Stripe account for Casabe Konnect platform, or each shipping company has their own? (Architecture decision affects Slice 7.1 design)

---

*This document is the single source of truth for Phase 7 scope. Update after each slice.*
