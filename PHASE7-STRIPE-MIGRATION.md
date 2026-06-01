# Phase 7 — Stripe Migration Draft
**Status: DELTA REVIEW REQUIRED — do not apply until Delta approves + Jefe says go**
**Written: 2026-06-01**

---

## Migration File (draft)
`phase7-slice72-stripe-schema.sql`

```sql
-- ============================================================
-- Phase 7 Slice 7.2 — Stripe Schema
-- STATUS: DRAFT — pending Delta audit + Jefe approval
-- DO NOT APPLY until:
--   1. Delta reviews and approves
--   2. STRIPE_SECRET_KEY is in Supabase secrets
--   3. STRIPE_WEBHOOK_SECRET is in Supabase secrets
--   4. Jefe explicit go-ahead
-- ============================================================

-- ── 1. stripe_configs ────────────────────────────────────────
-- One row per tenant. Stores publishable key (safe to read in UI).
-- Secret key lives in Supabase Edge Function secrets ONLY — never here.

CREATE TABLE IF NOT EXISTS stripe_configs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT        NOT NULL UNIQUE,
  publishable_key   TEXT        NOT NULL,        -- safe to return to UI
  is_live           BOOLEAN     NOT NULL DEFAULT false,  -- false = test mode
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE stripe_configs ENABLE ROW LEVEL SECURITY;

-- HQ: full access to own tenant row
CREATE POLICY "stripe_configs_hq_all"
  ON stripe_configs
  FOR ALL
  TO authenticated
  USING (
    tenant_id = get_user_role() -- HQ check via existing helper
    -- NOTE for Delta: replace with correct tenant+role check pattern
    -- matching existing tables (e.g. invoices, payments policies)
  );

-- anon: blocked (no policy = denied)
-- Office/Driver: no access to Stripe config

-- ── 2. New columns on invoices ───────────────────────────────
-- Add Stripe tracking fields to existing invoices table.
-- Existing RLS policies on invoices already scope by tenant_id.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS stripe_session_id         TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id  TEXT,
  ADD COLUMN IF NOT EXISTS paid_at                   TIMESTAMPTZ;

-- Index for idempotency lookup
CREATE UNIQUE INDEX IF NOT EXISTS invoices_stripe_session_id_idx
  ON invoices (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

-- ── 3. New columns on payments ───────────────────────────────
-- Add Stripe tracking fields to existing payments table.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS stripe_session_id         TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id  TEXT;

-- Unique index for idempotency — prevents double-processing same session
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_session_id_idx
  ON payments (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

-- ── 4. stripe_webhook_log ────────────────────────────────────
-- Audit trail for every received Stripe webhook event.
-- Written by service_role (webhook Edge Function). Read by HQ only.

CREATE TABLE IF NOT EXISTS stripe_webhook_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT        NOT NULL,
  stripe_event_id  TEXT        NOT NULL UNIQUE,  -- Stripe event.id — idempotency at DB level
  event_type       TEXT        NOT NULL,
  session_id       TEXT,
  order_id         TEXT,
  invoice_id       TEXT,
  processed        BOOLEAN     NOT NULL DEFAULT false,
  error            TEXT,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE stripe_webhook_log ENABLE ROW LEVEL SECURITY;

-- HQ: read own tenant rows
CREATE POLICY "stripe_webhook_log_hq_select"
  ON stripe_webhook_log
  FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT t.tenant_id FROM members t WHERE t.user_id = auth.uid() LIMIT 1));
  -- NOTE for Delta: align with existing tenant resolution pattern

-- service_role inserts via webhook Edge Function (bypasses RLS — correct behavior)
-- anon: blocked
-- Office/Driver: no access

-- ── 5. Verify ────────────────────────────────────────────────
-- After applying, confirm:
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename IN ('stripe_configs', 'stripe_webhook_log');
-- Both must show rowsecurity = true

SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE tablename IN ('stripe_configs', 'stripe_webhook_log');
-- Confirm policies present, no USING (true) anywhere
```

---

## Delta Review Checklist

Before approving, Delta must confirm:

- [ ] `stripe_configs` — RLS enabled, HQ-only policy uses correct tenant+role pattern (match existing tables)
- [ ] `stripe_configs` — no `USING (true)` in any policy
- [ ] `stripe_configs` — anon blocked (no open policy)
- [ ] `invoices` new columns — existing RLS policies cover UPDATE on these new columns (no new policies needed)
- [ ] `payments` new columns — existing RLS policies cover UPDATE on these new columns
- [ ] `payments_stripe_session_id_idx` UNIQUE index — prevents idempotency bugs at DB level
- [ ] `stripe_webhook_log` — RLS enabled, HQ select only, service_role insert is correct pattern
- [ ] `stripe_webhook_log` — `stripe_event_id` UNIQUE enforces no duplicate event processing
- [ ] All tenant_id columns are TEXT (matching existing schema — orders.id is TEXT not UUID)
- [ ] No hard deletes — webhook log is append-only (no DELETE policy)
- [ ] Verify `get_user_role()` and `get_user_office_ids()` usage matches existing hardened pattern (SET search_path = '')

---

## Notes for Delta

1. The `stripe_configs` HQ policy placeholder needs to match the exact pattern used in `tape_direct_records` and `box_sale_records` policies — check those as the reference implementation.
2. `payments` table composite FK is `(order_id, tenant_id) → orders(id, tenant_id)` — orders.id is TEXT. No change needed, just confirming new columns don't break this.
3. `stripe_webhook_log` has no `order_id` FK intentionally — webhook fires before we can guarantee order exists in all failure scenarios.

---

*This file is for Delta review only. No SQL has been applied. Apply only after Delta approval + Jefe explicit go.*
