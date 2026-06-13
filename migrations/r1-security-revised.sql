-- ============================================================
-- r1-security-revised.sql
-- Casabe Konnect — R1 Security Migration (REVISED R5)
-- Author: Forge (Dev Lead)
-- Revision Date: 2026-06-11 (R5 — Delta R4 blockers addressed)
-- Status: DRAFT — Pending Delta review + Jefe go-ahead
-- DO NOT APPLY to Supabase without explicit Jefe sign-off
-- ============================================================
--
-- WHAT CHANGED FROM R4 → R5 (Delta R4 blockers addressed):
--
-- P0-R4-1: Webhook event-state writes — finalize_stripe_event() RPC
--   failEvent() and succeedEvent() previously did fire-and-forget UPDATE calls
--   to stripe_events with no error or rowsAffected check. A failed UPDATE left
--   the row in 'processing' permanently → Stripe retried → claim_stripe_event()
--   saw recent 'processing' → returned claimed=false → duplicate 200 → lost update.
--   Fixed: Added finalize_stripe_event(p_event_id, p_new_status, p_allowed_from)
--   RPC that validates allowed_from transition, returns rows_updated (0 or 1),
--   and is service-role only. webhook now calls this RPC instead of raw UPDATE;
--   0 rows_updated → 500 (Stripe retries). No 200 without confirmed DB finalization.
--
-- P1-R4-2: claimed_at DEFAULT + NOT NULL constraint after backfill
--   Migration did ADD COLUMN IF NOT EXISTS + backfill but never added DEFAULT now()
--   or NOT NULL constraint. Old webhook code could INSERT a row with NULL claimed_at
--   (neither active nor stale under claim predicates → silent loss, unclaimable).
--   Fixed: After ADD COLUMN + backfill, ALTER COLUMN SET DEFAULT now() and SET NOT NULL.
--
-- P1-R4-3: ACL assertion incomplete — now covers all 6 restricted functions
--   aclexplode block only checked 3 functions. Missing: get_checkout_authorized_member,
--   get_user_tenant_id (conditional, when exists), finalize_stripe_event.
--   Fixed: Loop now covers all 6 functions with service-role restrictions.
--   get_user_tenant_id handled via conditional OID lookup (may not exist).
--
-- P1-R4-4: async_payment_failed wrote 'payment_failed' — now canonical 'failed'
--   checkout.session.async_payment_failed wrote status 'payment_failed' while
--   payment_intent.payment_failed wrote 'failed'. No defined 'payment_failed'
--   status in schema/UI. Inconsistent reporting, broken status displays.
--   Fixed: All failure branches use canonical 'failed'. 'payment_failed' removed.
--   (SQL impact: merge_stripe_payment_status callers in webhook — no schema change needed)
--
-- P1-R4-5: merge_stripe_payment_completed now accepts p_amount_paid NUMERIC
--   Previously set payment.status='paid' but preserved existing payment.paid value.
--   A newly paid order could be stored as status=paid, paid=0 — broken balances.
--   Fixed: Function now requires p_amount_paid NUMERIC (cents from Stripe). Converts
--   to dollars (/ 100.0), sets payment.paid atomically alongside payment.status.
--   Rejects p_amount_paid <= 0 (do not mark paid with zero amount).
--   Signature change: added p_amount_paid NUMERIC as 6th parameter.
--
-- ============================================================
--
-- WHAT CHANGED FROM THE ORIGINAL MIGRATION (stripe-security-migration.sql)
-- AND WHY EACH REVOKE WAS DROPPED:
--
-- ❌ DROPPED: REVOKE EXECUTE ON FUNCTION public.is_hq() FROM PUBLIC / anon / authenticated
--   REASON: Delta's live dependency audit (DELTA-STOPSHIP-PREFLIGHT.md, Query 1)
--   confirmed 18 live RLS policies across 8 tables call is_hq() directly in their
--   USING/WITH CHECK clauses. PostgreSQL evaluates RLS policies in the calling
--   user's execution context — NOT as function owner — so authenticated users MUST
--   retain EXECUTE on any helper function embedded in a USING clause. Revoking
--   would silently cause every row access on those 8 tables (including activity_log,
--   box_orders, box_sale_records, campaigns, offices, partners, etc.) to fail with
--   a permission error, breaking tenant isolation for all HQ users. Hard stop.
--
-- ❌ DROPPED: REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC / anon / authenticated
--   REASON: Delta's live dependency audit confirmed 2 live RLS policies on the
--   members table (members_admin_read, members_admin_write) call is_admin() in
--   their USING/WITH CHECK clauses. Same RLS execution context rule applies.
--   Revoking would break admin reads and writes on the members table. Hard stop.
--
-- ❌ DROPPED: REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM PUBLIC / anon / authenticated
--   REASON: Delta's live dependency audit confirmed 40 live RLS policies across
--   13 tables call current_tenant_id() in their USING/WITH CHECK clauses.
--   This is the most widely-used function in the system — it is the foundational
--   tenant isolation primitive. Revoking it would break ALL tenant-scoped RLS
--   across every table in the platform. Catastrophic data exposure risk. Hard stop.
--
-- ❌ DROPPED: REVOKE EXECUTE ON FUNCTION public.get_user_office_ids() FROM PUBLIC / anon / authenticated
--   REASON: Per Jefe's final requirements, all revokes for this set of functions
--   are dropped. Additionally, get_user_office_ids() itself calls current_tenant_id()
--   internally. It is also referenced in SECURITY-FIX-PATCH.sql as a hardened
--   SECURITY DEFINER helper. While Delta's audit showed 0 direct RLS policy
--   references, indirect call chains through other SECURITY DEFINER helpers and
--   legitimate direct application calls make this unsafe to revoke without a
--   comprehensive call-site audit. Dropped per Jefe's explicit instruction.
--
-- ✅ KEPT: REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM PUBLIC / anon / authenticated
--   REASON: Delta's live dependency audit confirmed 0 live RLS policies reference
--   get_user_tenant_id(). Delta verdict: ✅ SAFE to revoke.
--   PREREQUISITE: Before applying, run the direct-client-call audit below (Audit A)
--   to confirm no frontend/Edge Function code calls this function directly.
--   If any direct calls are found, remove this revoke and document the callers
--   as open questions for Delta.
--
-- ✅ KEPT: All other changes from the original migration:
--   - N2: Drop orders_driver_update policy + restrict_driver_order_update trigger
--         (drivers use update_driver_status RPC exclusively — belt-and-suspenders cleanup)
--   - N1: Backfill assignedDriverUserId from members.display_name
--   - M2: Pin SET search_path = '' on four financial functions
--   - H3 (partial): Add merge_stripe_payment_completed + merge_stripe_payment_status RPCs,
--                   restricted to service_role only (REVOKE FROM PUBLIC first, then named roles)
--   - NEW: stripe_events table for webhook idempotency (from r6-stripe-idempotency.sql pattern)
--           with RETURNING-based atomic idempotency fix (addresses Codex P0-R2/P0-R3, Delta P0-M1)
--   - NEW: stripe-checkout role guard via get_checkout_authorized_member() RPC
--           (addresses Codex P1-R5)
--   - NEW R5: finalize_stripe_event() RPC — transition-validated event finalization
--
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- Audit A — PREREQUISITE CHECK (run before applying)
-- Confirm get_user_tenant_id() has zero direct client callers.
-- If this returns ANY results, remove the revoke at the bottom
-- of this file and document the callers as open questions.
-- ────────────────────────────────────────────────────────────
-- Run manually in SQL Editor before applying:
--
-- SELECT proname, prosrc
-- FROM pg_proc
-- WHERE pronamespace = 'public'::regnamespace
--   AND prosrc ILIKE '%get_user_tenant_id%'
--   AND proname != 'get_user_tenant_id';
--
-- Expected: 0 rows (no other DB functions call it).
-- Also grep frontend/Edge Function source for 'get_user_tenant_id' — must be 0 hits.
-- ────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────
-- Change 1 — N2: Remove unsafe direct driver UPDATE path
--
-- The approved R1 architecture requires drivers to update order
-- status exclusively via the update_driver_status RPC (SECURITY
-- DEFINER). Direct driver UPDATE via RLS is intentionally
-- prohibited. Belt-and-suspenders cleanup: drop any leftover
-- objects from a previous incorrect apply.
-- ────────────────────────────────────────────────────────────
DROP TRIGGER  IF EXISTS trg_restrict_driver_order_update ON public.orders;
DROP FUNCTION IF EXISTS public.restrict_driver_order_update();
DROP POLICY   IF EXISTS orders_driver_update ON public.orders;


-- ────────────────────────────────────────────────────────────
-- Change 2 — N1: Backfill assignedDriverUserId
--
-- Populates assignedDriverUserId for legacy orders where the
-- driver was set by display_name only, without the corresponding
-- UUID. Safe to re-run (only updates rows where UUID is absent).
-- ────────────────────────────────────────────────────────────
UPDATE public.orders o
SET data = jsonb_set(
  o.data,
  '{assignedDriverUserId}',
  to_jsonb(m.user_id::text),
  true  -- create key if absent
)
FROM public.members m
WHERE o.tenant_id   = m.tenant_id
  AND o.data->>'assignedDriver'       = m.display_name
  AND (o.data->>'assignedDriverUserId') IS NULL
  AND m.role    = 'driver'
  AND m.user_id IS NOT NULL
  AND m.active  = true;


-- ────────────────────────────────────────────────────────────
-- Change 3 — H3 (REVISED): Restrict only safe-to-revoke helpers
--
-- REVOKED (confirmed 0 live RLS policy dependencies — Delta audit):
--   get_user_tenant_id()   — 0 policies ✅ SAFE
--   log_commission_change() — trigger function (0 callable-RPC dependencies)
--   restrict_driver_order_update() — dropped in Change 1; cleanup if present
--
-- NOT REVOKED — these have active live RLS policy dependencies:
--   is_hq()             — 18 live RLS policies across 8 tables ❌ CANNOT REVOKE
--   is_admin()          — 2 live RLS policies on members table ❌ CANNOT REVOKE
--   current_tenant_id() — 40 live RLS policies across 13 tables ❌ CANNOT REVOKE
--   get_user_office_ids() — 0 RLS policies but per Jefe's instruction ❌ DROPPED
--   is_member(text)     — called in orders RLS USING/WITH CHECK ❌ CANNOT REVOKE
--   get_user_role()     — called in orders RLS USING/WITH CHECK ❌ CANNOT REVOKE
--   can_access_order(text) — called in orders RLS USING/WITH CHECK ❌ CANNOT REVOKE
--
-- NEW: Add merge_stripe_payment_completed + merge_stripe_payment_status RPCs
--   restricted to service_role only (REVOKE FROM PUBLIC first per P0-1).
-- ────────────────────────────────────────────────────────────

-- Revoke get_user_tenant_id from PUBLIC first (eliminates default grant),
-- then from named roles explicitly. Safe: 0 live RLS policy dependencies.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'get_user_tenant_id'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM anon, authenticated';
  END IF;

  -- log_commission_change: trigger function — not callable via RPC directly.
  -- Revoke as defense-in-depth; no policy dependency.
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'log_commission_change'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.log_commission_change() FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.log_commission_change() FROM anon, authenticated';
  END IF;

  -- restrict_driver_order_update: dropped in Change 1; revoke as cleanup
  -- in case a zero-argument variant was somehow left callable.
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'restrict_driver_order_update'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.restrict_driver_order_update() FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.restrict_driver_order_update() FROM anon, authenticated';
  END IF;
END $$;


-- ── Webhook JSONB merge RPCs ──────────────────────────────────────────────
-- merge_stripe_payment_completed: called on checkout.session.completed
-- and checkout.session.async_payment_succeeded.
-- Writes stripe_session_id and full payment block into data JSONB.
-- P1-R4-5: Added p_amount_paid NUMERIC (Stripe cents). Converts to dollars,
--           sets payment.paid atomically. Rejects p_amount_paid <= 0.
-- SECURITY: REVOKE FROM PUBLIC first (P0-1), then named roles;
--           explicit GRANT to service_role only.

CREATE OR REPLACE FUNCTION public.merge_stripe_payment_completed(
  p_order_id        TEXT,
  p_tenant_id       TEXT,
  p_session_id      TEXT,
  p_payment_status  TEXT,
  p_payment_method  TEXT,
  p_amount_paid     NUMERIC  -- Stripe amount_total in cents; will be divided by 100.0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- P1-R4-5: Reject zero or negative amounts — do not mark paid with no payment.
  IF p_amount_paid <= 0 THEN
    RAISE EXCEPTION
      'merge_stripe_payment_completed: p_amount_paid must be > 0, got % for order %',
      p_amount_paid, p_order_id;
  END IF;

  UPDATE public.orders
  SET data = data
    || jsonb_build_object('stripe_session_id', p_session_id)
    || jsonb_build_object(
         'payment', COALESCE(data->'payment', '{}'::jsonb)
           || jsonb_build_object(
                'status',            p_payment_status,
                'method',            p_payment_method,
                'stripe_session_id', p_session_id,
                'paid',              (p_amount_paid / 100.0)  -- P1-R4-5: cents → dollars
              )
       )
  WHERE id        = p_order_id
    AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'merge_stripe_payment_completed: order % not found for tenant %',
      p_order_id, p_tenant_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC)
  TO service_role;

-- P1-R5-2: Drop old 5-parameter overload if it exists.
-- CREATE OR REPLACE only replaces a matching signature; a prior 5-param
-- merge_stripe_payment_completed would survive as a separate overload.
-- This preflight DROP eliminates the old overload before the ACL assertion runs.
-- If the function doesn't exist (fresh installs), this is a safe no-op.
DROP FUNCTION IF EXISTS public.merge_stripe_payment_completed(TEXT, TEXT, TEXT, TEXT, TEXT);


-- merge_stripe_payment_status: called on charge.refunded / payment_intent.payment_failed
-- Writes only data.payment.status without touching other payment fields.

CREATE OR REPLACE FUNCTION public.merge_stripe_payment_status(
  p_order_id        TEXT,
  p_tenant_id       TEXT,
  p_payment_status  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.orders
  SET data = data
    || jsonb_build_object(
         'payment', COALESCE(data->'payment', '{}'::jsonb)
           || jsonb_build_object('status', p_payment_status)
       )
  WHERE id        = p_order_id
    AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'merge_stripe_payment_status: order % not found for tenant %',
      p_order_id, p_tenant_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_stripe_payment_status(TEXT,TEXT,TEXT)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_stripe_payment_status(TEXT,TEXT,TEXT)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.merge_stripe_payment_status(TEXT,TEXT,TEXT)
  TO service_role;


-- ────────────────────────────────────────────────────────────
-- Change 3b — Webhook Idempotency: stripe_events table
--
-- P0-M2 FIX: If stripe_events already exists from a prior apply
-- (r6-stripe-idempotency.sql) it will NOT have claimed_at.
-- CREATE TABLE IF NOT EXISTS silently no-ops on existing tables —
-- it does NOT add missing columns.
-- The ALTER TABLE below runs unconditionally and is safe on a
-- fresh table (column already present) or pre-existing table
-- (column added). This guarantees claimed_at always exists before
-- claim_stripe_event() is created below.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.stripe_events (
  id              TEXT        PRIMARY KEY,             -- Stripe event.id (evt_xxx)
  event_type      TEXT        NOT NULL,
  order_id        TEXT,                                -- NULL for non-order events
  tenant_id       TEXT,
  payment_status  TEXT        NOT NULL DEFAULT 'processing',
  -- Values: 'processing' | 'processed' | 'failed'
  claimed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  raw_error       TEXT
);

-- P0-M2: Unconditionally add claimed_at if the table already existed
-- without it (safe no-op when column is already present).
ALTER TABLE IF EXISTS public.stripe_events
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- Ensure claimed_at has a NOT NULL default if it was just added as nullable
-- (covers the case where old schema created it nullable; we want a sensible default).
-- This UPDATE backfills any NULL claimed_at values that might exist from the old schema.
UPDATE public.stripe_events
SET claimed_at = COALESCE(claimed_at, now())
WHERE claimed_at IS NULL;

-- P1-R4-2: Add DEFAULT now() and NOT NULL constraint on claimed_at.
-- After backfill above there are no NULLs, so NOT NULL is safe.
-- This closes the deploy window where old webhook code could INSERT a row
-- with NULL claimed_at (which would be neither active nor stale under claim
-- predicates and could never be reclaimed — silent loss).
-- Both ALTER COLUMN clauses are safe to re-apply on a column that already
-- has these constraints (PostgreSQL silently accepts redundant constraint adds).
ALTER TABLE public.stripe_events
  ALTER COLUMN claimed_at SET DEFAULT now(),
  ALTER COLUMN claimed_at SET NOT NULL;

-- P1-R6-2: Reconcile payment_status contract on existing production tables.
-- r6-stripe-idempotency.sql created payment_status TEXT with no NOT NULL or DEFAULT.
-- R7 intent: payment_status is always one of 'processing', 'processed', 'failed'.
-- CREATE TABLE IF NOT EXISTS is a no-op on existing tables, so the column remained
-- nullable with no default. Backfill + add constraint now.

-- Step 1: Preflight — log current payment_status distribution (safe read)
DO $$
DECLARE
  v_null_count    INTEGER;
  v_unknown_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_null_count
  FROM public.stripe_events
  WHERE payment_status IS NULL;

  SELECT COUNT(*) INTO v_unknown_count
  FROM public.stripe_events
  WHERE payment_status IS NOT NULL
    AND payment_status NOT IN ('processing', 'processed', 'failed');

  IF v_null_count > 0 THEN
    RAISE NOTICE 'stripe_events.payment_status: % NULL rows found — will backfill to ''processing''', v_null_count;
  END IF;
  IF v_unknown_count > 0 THEN
    RAISE NOTICE 'stripe_events.payment_status: % unknown status rows found — will backfill to ''failed''', v_unknown_count;
  END IF;
END $$;

-- Step 2: Backfill NULL payment_status to 'processing'
-- (NULL means the row was inserted under the old schema with no default)
UPDATE public.stripe_events
SET payment_status = 'processing'
WHERE payment_status IS NULL;

-- Step 3: Backfill unknown payment_status values to 'failed'
-- (unknown values are unsafe; mark as failed so they can be reclaimed or investigated)
UPDATE public.stripe_events
SET payment_status = 'failed'
WHERE payment_status NOT IN ('processing', 'processed', 'failed');

-- Step 4: Add NOT NULL constraint and DEFAULT 'processing' now that no NULLs remain
ALTER TABLE public.stripe_events
  ALTER COLUMN payment_status SET DEFAULT 'processing',
  ALTER COLUMN payment_status SET NOT NULL;

-- P1-R5-4: Reconcile processed_at contract on existing production tables.
-- r6-stripe-idempotency.sql created processed_at TIMESTAMPTZ NOT NULL DEFAULT now().
-- R5 intent: processed_at is NULL until finalized (processing claims have NULL processed_at).
-- CREATE TABLE IF NOT EXISTS does not alter existing columns.
-- Fix: drop the NOT NULL constraint and default on existing tables.
--
-- This means:
--   - New processing claims: processed_at IS NULL (correct)
--   - finalize_stripe_event sets processed_at = now() on 'processed' transition only
--   - Failed events: processed_at remains NULL (no timestamp on failure — intentional)
--
-- Safe on fresh tables: ALTER IF EXISTS with conditional check.
DO $$
BEGIN
  -- Drop NOT NULL constraint on processed_at if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'stripe_events'
      AND column_name  = 'processed_at'
      AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE public.stripe_events
      ALTER COLUMN processed_at DROP NOT NULL;
    RAISE NOTICE 'stripe_events.processed_at NOT NULL constraint dropped';
  END IF;

  -- Drop DEFAULT on processed_at if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'stripe_events'
      AND column_name  = 'processed_at'
      AND column_default IS NOT NULL
  ) THEN
    ALTER TABLE public.stripe_events
      ALTER COLUMN processed_at DROP DEFAULT;
    RAISE NOTICE 'stripe_events.processed_at DEFAULT dropped';
  END IF;
END $$;

-- Backfill: set processed_at = NULL for rows that are currently 'processing' or 'failed'
-- (they should not have a processed timestamp from the old DEFAULT now()).
-- Rows that were previously marked 'processed' retain their existing processed_at.
UPDATE public.stripe_events
SET processed_at = NULL
WHERE payment_status IN ('processing', 'failed')
  AND processed_at IS NOT NULL;

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

-- Service_role only (webhook runs as service_role; bypasses RLS anyway,
-- but explicit policies make intent clear and block all client paths).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'stripe_events'
      AND policyname = 'service_only'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "service_only" ON public.stripe_events
        FOR ALL TO service_role
        USING (true) WITH CHECK (true)
    $pol$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'stripe_events'
      AND policyname = 'block_others'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "block_others" ON public.stripe_events
        FOR ALL TO anon, authenticated
        USING (false)
    $pol$;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- Change 3c — claim_stripe_event(): RETURNING-based atomic ownership
--
-- P0-M1 FIX: The previous implementation inferred ownership via a
-- timestamp-window UPDATE after INSERT ON CONFLICT DO NOTHING. This
-- was broken because ALL concurrent callers could see their own row
-- within the 2-second window and all match the UPDATE — all return
-- claimed=true, all proceed, race condition NOT fixed.
--
-- CORRECT APPROACH:
--   - Use INSERT ... RETURNING id INTO v_inserted_id
--   - If v_inserted_id IS NOT NULL → this caller inserted the row → owns it
--   - If v_inserted_id IS NULL → INSERT conflicted → someone else owns it
--   - The stale/failed reclaim path is a SEPARATE conditional, only reached
--     when v_inserted_id IS NULL AND existing row is failed/stale
--   - NEVER infer ownership from a timestamp window on the primary claim path
--
-- Returns JSON:
--   { "claimed": true,  "action": "claimed"    }  → caller owns; proceed
--   { "claimed": false, "action": "duplicate"  }  → already processed (payment_status='processed'); safe 200 ack
--   { "claimed": false, "action": "in_progress"}  → another request is actively processing (not stale); return 409
--   { "claimed": true,  "action": "reclaimed"  }  → stale/failed reclaim; retry
--   { "claimed": false, "action": "unknown"    }  → reclaim race lost but row not in processed/processing;
--                                                     fail closed — do NOT return 200. (See P0-R6-1.)
--                                                     After P1-R6-2 schema reconciliation, NULL/unknown
--                                                     payment_status should never occur at runtime, but
--                                                     the function still fails closed defensively.
--
-- P0-R5-1 FIX: Active-processing concurrent callers now return action='in_progress'
--   (not 'duplicate'). The webhook must return HTTP 409 for in_progress so Stripe
--   retries if the owning request fails, rather than silently acking with 200.
--
-- P0-R6-1 FIX: Reclaim-race loser formerly fell through to a hardcoded
--   action='duplicate' return without confirming the row was actually 'processed'.
--   The winning reclaimer resets the row to 'processing' — returning 'duplicate'
--   at that point caused the losing caller to emit HTTP 200, which could suppress
--   Stripe retries if the winner later failed.
--   Fixed: After a failed reclaim UPDATE, re-read the current row state and
--   classify accurately: 'processed' → duplicate, 'processing' → in_progress,
--   anything else (NULL, unknown) → 'unknown' (fail closed, return 500 upstream).
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_stripe_event(
  p_event_id    TEXT,
  p_event_type  TEXT,
  p_order_id    TEXT    DEFAULT NULL,
  p_tenant_id   TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inserted_id  TEXT;
  v_existing     RECORD;
  _stale_minutes CONSTANT INTEGER := 5;
BEGIN
  -- ── Step 1: Attempt atomic insert, capture whether WE inserted it.
  -- RETURNING only yields a row when this statement actually inserted one.
  -- ON CONFLICT DO NOTHING means a conflicting row produces no RETURNING output.
  -- v_inserted_id will be NULL if the INSERT conflicted (another caller owns it).
  INSERT INTO public.stripe_events (id, event_type, order_id, tenant_id, payment_status, claimed_at)
  VALUES (p_event_id, p_event_type, p_order_id, p_tenant_id, 'processing', now())
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_inserted_id;

  -- ── Step 2: We inserted → we own the claim. No timestamp inference needed.
  IF v_inserted_id IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', true, 'action', 'claimed');
  END IF;

  -- ── Step 3: INSERT conflicted. Read existing row to determine what to do.
  SELECT payment_status, claimed_at
  INTO   v_existing
  FROM   public.stripe_events
  WHERE  id = p_event_id;

  -- Already fully processed → true duplicate, skip safely.
  IF v_existing.payment_status = 'processed' THEN
    RETURN jsonb_build_object('claimed', false, 'action', 'duplicate');
  END IF;

  -- Active processing by another caller (not stale) → return in_progress.
  -- P0-R5-1: Distinguishes from true duplicate (processed) so the webhook
  -- can return 409 instead of 200. Stripe retries on non-2xx — if the owning
  -- request fails, Stripe will retry and the stale reclaim path handles it.
  IF v_existing.payment_status = 'processing'
     AND v_existing.claimed_at >= now() - (_stale_minutes || ' minutes')::INTERVAL THEN
    RETURN jsonb_build_object('claimed', false, 'action', 'in_progress');
  END IF;

  -- ── Step 4: Stale or failed → attempt atomic reclaim.
  -- Only one concurrent caller can win this UPDATE (first writer wins).
  UPDATE public.stripe_events
  SET    payment_status = 'processing',
         claimed_at     = now(),
         raw_error      = NULL
  WHERE  id             = p_event_id
    AND  (
           payment_status = 'failed'
           OR (
             payment_status = 'processing'
             AND claimed_at < now() - (_stale_minutes || ' minutes')::INTERVAL
           )
         );

  IF FOUND THEN
    RETURN jsonb_build_object('claimed', true, 'action', 'reclaimed');
  END IF;

  -- ── Step 5 (P0-R6-1): Reclaim race lost. Re-read to classify accurately.
  -- Do NOT infer 'processed' without reading the actual current state.
  -- The winning reclaimer reset the row to 'processing' — returning 'duplicate'
  -- here (without confirming 'processed') would suppress Stripe retries if that
  -- winner later fails.
  SELECT payment_status INTO v_existing
  FROM   public.stripe_events
  WHERE  id = p_event_id;

  IF v_existing.payment_status = 'processed' THEN
    -- Reclaim winner finished successfully before we re-read. True duplicate.
    RETURN jsonb_build_object('claimed', false, 'action', 'duplicate');
  ELSIF v_existing.payment_status = 'processing' THEN
    -- Reclaim winner is actively processing. Return in_progress so caller returns 409.
    RETURN jsonb_build_object('claimed', false, 'action', 'in_progress');
  ELSE
    -- NULL, unknown, or unexpected state — fail closed. Do not treat as processed.
    -- After P1-R6-2 schema reconciliation, this branch should never be reached
    -- at runtime, but the function still fails closed defensively.
    RETURN jsonb_build_object('claimed', false, 'action', 'unknown');
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_stripe_event(TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_stripe_event(TEXT, TEXT, TEXT, TEXT)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_stripe_event(TEXT, TEXT, TEXT, TEXT)
  TO service_role;


-- ────────────────────────────────────────────────────────────
-- Change 3d — finalize_stripe_event(): transition-validated finalization RPC
--
-- P0-R4-1 FIX: failEvent() and succeedEvent() previously called
-- supabase.from('stripe_events').update({...}).eq('id', event.id)
-- with NO error check and NO rowsAffected/count check. A failed UPDATE
-- left the row in 'processing' permanently. Stripe would retry, see a
-- recent 'processing' row, and claim_stripe_event() would return
-- claimed=false → 200 (duplicate) → the order update is permanently lost.
--
-- This RPC provides transition-validated finalization:
--   - Validates that the current status is in p_allowed_from[]
--   - Returns rows_updated (0 or 1) — caller MUST return 500 if 0
--   - Service-role only — not callable by anon or authenticated
--
-- Callers in stripe-webhook must:
--   1. Call this RPC instead of raw .update()
--   2. Check error AND rows_updated
--   3. Return 500 if rows_updated = 0 (finalization did not land)
--   4. Never return 200 without confirmed DB finalization
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.finalize_stripe_event(
  p_event_id          TEXT,
  p_new_status        TEXT,       -- 'processed' or 'failed'
  p_allowed_from      TEXT[],     -- allowed current statuses e.g. ARRAY['processing']
  p_processed_at      TIMESTAMPTZ DEFAULT NULL,
  p_raw_error         TEXT        DEFAULT NULL
)
RETURNS INTEGER   -- rows_updated: 0 or 1
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows_updated INTEGER;
BEGIN
  UPDATE public.stripe_events
  SET
    payment_status = p_new_status,
    processed_at   = CASE
                       WHEN p_new_status = 'processed' THEN COALESCE(p_processed_at, now())
                       ELSE processed_at
                     END,
    raw_error      = CASE
                       WHEN p_new_status = 'failed' THEN p_raw_error
                       ELSE raw_error
                     END
  WHERE id             = p_event_id
    AND payment_status = ANY(p_allowed_from);

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  RETURN v_rows_updated;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_stripe_event(TEXT, TEXT, TEXT[], TIMESTAMPTZ, TEXT)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_stripe_event(TEXT, TEXT, TEXT[], TIMESTAMPTZ, TEXT)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finalize_stripe_event(TEXT, TEXT, TEXT[], TIMESTAMPTZ, TEXT)
  TO service_role;


-- ────────────────────────────────────────────────────────────
-- Change 3e — Checkout Role Guard (Codex P1-R5)
--
-- BLOCKER ADDRESSED: The stripe-checkout Edge Function resolves
-- any active tenant membership but does NOT verify that the caller
-- has an HQ or office role before using service-role access to
-- create Checkout Sessions for arbitrary orders in the tenant.
-- A driver or other active member could call the Edge Function
-- directly and create Sessions for orders they have no business
-- initiating payment on.
--
-- FIX: get_checkout_authorized_member() is a SECURITY DEFINER
-- helper that the stripe-checkout Edge Function MUST call after
-- resolving user identity. It returns the tenant_id only if the
-- caller has an authorized role ('hq', 'admin', 'owner', 'office').
-- If the caller is a driver or other non-payment role, it returns
-- NULL — the Edge Function must return 403 Forbidden.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_checkout_authorized_member(
  p_user_id TEXT
)
RETURNS TABLE (tenant_id TEXT, member_role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Returns (tenant_id, role) if the user has a checkout-authorized role.
  -- Authorized roles: hq, admin, owner, office.
  -- Drivers and any other role are intentionally excluded.
  -- Returns 0 rows if user has no active membership or an unauthorized role.
  RETURN QUERY
  SELECT
    m.tenant_id,
    COALESCE(m.app_role, m.role) AS member_role
  FROM public.members m
  WHERE m.user_id = p_user_id::uuid
    AND m.active  = true
    AND COALESCE(m.app_role, m.role) IN ('hq', 'admin', 'owner', 'office')
  ORDER BY m.created_at
  LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_checkout_authorized_member(TEXT)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_checkout_authorized_member(TEXT)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_checkout_authorized_member(TEXT)
  TO service_role;


-- ────────────────────────────────────────────────────────────
-- P1-M5 + P1-R4-3: PUBLIC ACL verification (EXPANDED)
--
-- R4 version only checked 3 functions (merge RPCs + claim).
-- P1-R4-3 requires ALL restricted functions to be in the assertion:
--   1. merge_stripe_payment_completed (new 6-param signature)
--   2. merge_stripe_payment_status
--   3. claim_stripe_event
--   4. finalize_stripe_event (new in R5)
--   5. get_checkout_authorized_member (new in R4, was missing from assertion)
--   6. get_user_tenant_id (conditional — may not exist; skip if absent)
--
-- For each function: grantee = 0 (PUBLIC pseudo-role) EXECUTE must NOT exist.
-- Raises EXCEPTION if PUBLIC can still EXECUTE any restricted function.
-- Uses acldefault('f', owner) when proacl IS NULL (default ACL includes
-- PUBLIC EXECUTE — NULL proacl does NOT mean "no PUBLIC access").
--
-- This block runs AFTER all GRANT/REVOKE statements above.
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn         TEXT;
  v_has_public BOOLEAN;
  v_proc_oid   OID;
  v_owner_oid  OID;
BEGIN
  FOR v_fn IN VALUES
    ('merge_stripe_payment_completed(text,text,text,text,text,numeric)'),
    ('merge_stripe_payment_status(text,text,text)'),
    ('claim_stripe_event(text,text,text,text)'),
    ('finalize_stripe_event(text,text,text[],timestamptz,text)'),
    ('get_checkout_authorized_member(text)')
  LOOP
    -- Resolve function OID and owner OID
    SELECT p.oid, p.proowner
    INTO   v_proc_oid, v_owner_oid
    FROM   pg_proc p
    JOIN   pg_namespace n ON p.pronamespace = n.oid
    WHERE  n.nspname = 'public'
      AND  p.oid::regprocedure::text ILIKE v_fn || '%'
    LIMIT 1;

    IF v_proc_oid IS NULL THEN
      RAISE EXCEPTION 'ACL check: function not found: %', v_fn;
    END IF;

    -- Check for PUBLIC EXECUTE: grantee = 0 is the PUBLIC pseudo-role.
    -- When proacl IS NULL, the function has not had its ACL modified from the
    -- default. The default DOES include PUBLIC EXECUTE (PostgreSQL default for
    -- new functions). We check acldefault('f', owner) in that case.
    SELECT EXISTS (
      SELECT 1
      FROM aclexplode(
        COALESCE(
          (SELECT proacl FROM pg_proc WHERE oid = v_proc_oid),
          acldefault('f', v_owner_oid)
        )
      )
      WHERE grantee = 0
        AND privilege_type = 'EXECUTE'
    ) INTO v_has_public;

    IF v_has_public THEN
      RAISE EXCEPTION
        'SECURITY VIOLATION: PUBLIC EXECUTE still present on function: %. '
        'REVOKE did not land correctly. DO NOT APPLY this migration.',
        v_fn;
    END IF;
  END LOOP;

  -- get_user_tenant_id: conditional — only assert if function exists.
  -- It may not exist on all environments; the revoke block earlier is also conditional.
  SELECT p.oid, p.proowner
  INTO   v_proc_oid, v_owner_oid
  FROM   pg_proc p
  JOIN   pg_namespace n ON p.pronamespace = n.oid
  WHERE  n.nspname = 'public'
    AND  p.proname = 'get_user_tenant_id'
  LIMIT 1;

  IF v_proc_oid IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM aclexplode(
        COALESCE(
          (SELECT proacl FROM pg_proc WHERE oid = v_proc_oid),
          acldefault('f', v_owner_oid)
        )
      )
      WHERE grantee = 0
        AND privilege_type = 'EXECUTE'
    ) INTO v_has_public;

    IF v_has_public THEN
      RAISE EXCEPTION
        'SECURITY VIOLATION: PUBLIC EXECUTE still present on function: get_user_tenant_id(). '
        'REVOKE did not land correctly. DO NOT APPLY this migration.';
    END IF;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- Change 4 — M2: Pin SET search_path = '' on four financial functions
--
-- Preserves existing function bodies exactly; only adds
-- SET search_path = ''. All table references are schema-qualified
-- (public.*) to compensate. Matches SECURITY-FIX-PATCH.sql pattern.
-- ────────────────────────────────────────────────────────────

-- M2.1: generate_receipt_number
CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  next_seq   INTEGER;
  year_month TEXT;
BEGIN
  year_month := TO_CHAR(NOW(), 'YYYY-MM');
  SELECT COUNT(*) + 1 INTO next_seq
  FROM public.payment_receipts
  WHERE receipt_number LIKE 'RCP-' || year_month || '-%';
  RETURN 'RCP-' || year_month || '-' || LPAD(next_seq::TEXT, 5, '0');
END;
$$;

-- M2.2: generate_invoice_number
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  next_seq   INTEGER;
  year_month TEXT;
BEGIN
  year_month := TO_CHAR(NOW(), 'YYYY-MM');
  SELECT COUNT(*) + 1 INTO next_seq
  FROM public.invoices
  WHERE invoice_number LIKE 'INV-' || year_month || '-%';
  RETURN 'INV-' || year_month || '-' || LPAD(next_seq::TEXT, 5, '0');
END;
$$;

-- M2.3: calculate_invoice_total
CREATE OR REPLACE FUNCTION public.calculate_invoice_total(
  p_subtotal_cents  INTEGER,
  p_shipping_cents  INTEGER,
  p_tax_cents       INTEGER,
  p_discount_cents  INTEGER DEFAULT 0
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  RETURN (p_subtotal_cents + p_shipping_cents + p_tax_cents - COALESCE(p_discount_cents, 0));
END;
$$;

-- M2.4: update_invoice_timestamp
-- Note: auth.uid() is schema-qualified by Supabase internals; safe with SET search_path = ''.
CREATE OR REPLACE FUNCTION public.update_invoice_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$;

COMMIT;


-- ============================================================
-- POST-COMMIT VERIFICATION QUERIES
-- Run these in the SQL Editor after applying to confirm all
-- changes landed correctly. Do NOT apply to Supabase without
-- running these verifications.
-- ============================================================

-- V1: Confirm orders_driver_update policy does NOT exist (N2: intentionally removed)
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'orders'
  AND policyname = 'orders_driver_update';
-- Expected: 0 rows

-- V2: Confirm restrict_driver_order_update trigger does NOT exist (N2: intentionally removed)
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'trg_restrict_driver_order_update'
  AND tgrelid = 'public.orders'::regclass;
-- Expected: 0 rows

-- V3: N1 backfill — remaining unfilled rows (should be 0 or near 0)
SELECT COUNT(*) AS unfilled_driver_orders
FROM public.orders o
WHERE o.data->>'assignedDriver' IS NOT NULL
  AND (o.data->>'assignedDriverUserId') IS NULL;
-- Expected: 0 ideally; residual rows had no matching members.display_name

-- V4: Confirm get_user_tenant_id revoke landed (only if function exists) (P1-R5-3)
-- The revoke is conditional on function existence; the verification must be too.
-- Unconditionally calling has_function_privilege() on a non-existent function throws an error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'get_user_tenant_id'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    IF has_function_privilege('anon', 'public.get_user_tenant_id()', 'EXECUTE') OR
       has_function_privilege('authenticated', 'public.get_user_tenant_id()', 'EXECUTE') THEN
      RAISE WARNING 'get_user_tenant_id() is still callable by anon or authenticated — revoke did not land';
    ELSE
      RAISE NOTICE 'get_user_tenant_id() revoke confirmed: anon=false, authenticated=false';
    END IF;
  ELSE
    RAISE NOTICE 'get_user_tenant_id() does not exist on this environment — optional revoke skipped';
  END IF;
END $$;

-- V4b: Confirm RLS helpers still callable by authenticated (MUST remain callable)
SELECT
  has_function_privilege('authenticated', 'public.is_hq()',              'EXECUTE') AS is_hq_ok,
  has_function_privilege('authenticated', 'public.is_admin()',           'EXECUTE') AS is_admin_ok,
  has_function_privilege('authenticated', 'public.current_tenant_id()',  'EXECUTE') AS current_tenant_id_ok,
  has_function_privilege('authenticated', 'public.get_user_role()',      'EXECUTE') AS get_user_role_ok,
  has_function_privilege('authenticated', 'public.get_user_office_ids()', 'EXECUTE') AS office_ids_ok;
-- Expected: ALL true — these must remain callable for RLS policy evaluation

-- V5: Confirm merge RPCs are SECURITY DEFINER, restricted to service_role only
SELECT
  proname,
  prosecdef    AS is_security_definer,
  proconfig    AS search_path_config,
  has_function_privilege('anon',         'public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC)', 'EXECUTE') AS anon_blocked_completed,
  has_function_privilege('authenticated','public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC)', 'EXECUTE') AS auth_blocked_completed,
  has_function_privilege('service_role', 'public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC)', 'EXECUTE') AS service_allowed_completed
FROM pg_proc
WHERE proname = 'merge_stripe_payment_completed'
  AND pronamespace = 'public'::regnamespace;

SELECT
  proname,
  prosecdef    AS is_security_definer,
  proconfig    AS search_path_config,
  has_function_privilege('anon',         'public.merge_stripe_payment_status(TEXT,TEXT,TEXT)', 'EXECUTE') AS anon_blocked,
  has_function_privilege('authenticated','public.merge_stripe_payment_status(TEXT,TEXT,TEXT)', 'EXECUTE') AS auth_blocked,
  has_function_privilege('service_role', 'public.merge_stripe_payment_status(TEXT,TEXT,TEXT)', 'EXECUTE') AS service_allowed
FROM pg_proc
WHERE proname = 'merge_stripe_payment_status'
  AND pronamespace = 'public'::regnamespace;
-- Expected: prosecdef=true, search_path_config includes 'search_path=',
--           anon_blocked=false, auth_blocked=false, service_allowed=true

-- V5b: Confirm exactly one overload of merge_stripe_payment_completed exists (P1-R5-2)
SELECT proname, pg_get_function_identity_arguments(oid) AS signature
FROM pg_proc
WHERE proname = 'merge_stripe_payment_completed'
  AND pronamespace = 'public'::regnamespace;
-- Expected: exactly 1 row, signature = 'order_id text, tenant_id text, session_id text, payment_status text, payment_method text, amount_paid numeric'
-- If 2 rows appear, the DROP FUNCTION in P1-R5-2 did not land for the old 5-param overload.

-- V6: Confirm claim_stripe_event, get_checkout_authorized_member, and
--     finalize_stripe_event exist and are restricted to service_role
SELECT proname,
       has_function_privilege('anon',         proname || '(TEXT,TEXT,TEXT,TEXT)', 'EXECUTE') AS anon_blocked,
       has_function_privilege('service_role', proname || '(TEXT,TEXT,TEXT,TEXT)', 'EXECUTE') AS service_allowed
FROM pg_proc
WHERE proname = 'claim_stripe_event'
  AND pronamespace = 'public'::regnamespace;

SELECT proname,
       has_function_privilege('anon',         proname || '(TEXT)', 'EXECUTE') AS anon_blocked,
       has_function_privilege('service_role', proname || '(TEXT)', 'EXECUTE') AS service_allowed
FROM pg_proc
WHERE proname = 'get_checkout_authorized_member'
  AND pronamespace = 'public'::regnamespace;

SELECT proname,
       has_function_privilege('anon',         'public.finalize_stripe_event(TEXT,TEXT,TEXT[],TIMESTAMPTZ,TEXT)', 'EXECUTE') AS anon_blocked,
       has_function_privilege('service_role', 'public.finalize_stripe_event(TEXT,TEXT,TEXT[],TIMESTAMPTZ,TEXT)', 'EXECUTE') AS service_allowed
FROM pg_proc
WHERE proname = 'finalize_stripe_event'
  AND pronamespace = 'public'::regnamespace;
-- Expected: anon_blocked=false, service_allowed=true for all three

-- V6b: Confirm PUBLIC ACL is clear for all 6 restricted functions
-- (aclexplode approach — mirrors P1-M5 + P1-R4-3 block above)
SELECT
  p.proname,
  p.oid::regprocedure::text AS full_signature,
  EXISTS (
    SELECT 1
    FROM aclexplode(
      COALESCE(p.proacl, acldefault('f', p.proowner))
    )
    WHERE grantee = 0 AND privilege_type = 'EXECUTE'
  ) AS public_execute_present
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'merge_stripe_payment_completed',
    'merge_stripe_payment_status',
    'claim_stripe_event',
    'finalize_stripe_event',
    'get_checkout_authorized_member',
    'get_user_tenant_id'
  );
-- Expected: public_execute_present = false for ALL rows.
-- If ANY row shows true, the REVOKE did not land. DO NOT PROCEED.

-- V7: Confirm stripe_events table has RLS enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename  = 'stripe_events';
-- Expected: rowsecurity = true

-- V7b: Confirm claimed_at column exists, has DEFAULT and NOT NULL (P0-M2 + P1-R4-2 fix)
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'stripe_events'
ORDER BY ordinal_position;
-- Expected: claimed_at present (data_type = 'timestamp with time zone'),
--           is_nullable = 'NO', column_default = 'now()'

-- V7c: Confirm processed_at contract (P1-R5-4)
SELECT
  column_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'stripe_events'
  AND column_name  = 'processed_at';
-- Expected: is_nullable = 'YES', column_default = NULL
-- (processed_at is only set by finalize_stripe_event on 'processed' transition)

-- V7d: Confirm payment_status contract (P1-R6-2)
SELECT
  column_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'stripe_events'
  AND column_name  = 'payment_status';
-- Expected: is_nullable = 'NO', column_default = '''processing'''

-- V7e: Confirm zero NULL or unknown payment_status rows (P1-R6-2)
SELECT
  COUNT(*) FILTER (WHERE payment_status IS NULL)                                             AS null_count,
  COUNT(*) FILTER (WHERE payment_status NOT IN ('processing','processed','failed'))          AS unknown_count
FROM public.stripe_events;
-- Expected: null_count = 0, unknown_count = 0

-- V8: Confirm M2 functions have search_path pinned
SELECT proname, proconfig
FROM pg_proc
WHERE proname IN (
  'generate_receipt_number',
  'generate_invoice_number',
  'calculate_invoice_total',
  'update_invoice_timestamp'
)
AND pronamespace = 'public'::regnamespace;
-- Expected: all 4 rows have proconfig containing 'search_path='

-- V9: Confirm NO live RLS policies were broken
-- Run the Delta dependency query to confirm all 42 policies still exist
SELECT
  p.tablename,
  p.policyname,
  CASE
    WHEN p.qual ILIKE '%is_hq%'             THEN 'is_hq'
    WHEN p.qual ILIKE '%is_admin%'          THEN 'is_admin'
    WHEN p.qual ILIKE '%current_tenant_id%' THEN 'current_tenant_id'
    WHEN p.with_check ILIKE '%is_hq%'       THEN 'is_hq(with_check)'
    WHEN p.with_check ILIKE '%is_admin%'    THEN 'is_admin(with_check)'
    WHEN p.with_check ILIKE '%current_tenant_id%' THEN 'current_tenant_id(with_check)'
    ELSE 'other'
  END AS depends_on
FROM pg_policies p
WHERE p.qual ILIKE '%is_hq%'
   OR p.qual ILIKE '%is_admin%'
   OR p.qual ILIKE '%current_tenant_id%'
   OR p.with_check ILIKE '%is_hq%'
   OR p.with_check ILIKE '%is_admin%'
   OR p.with_check ILIKE '%current_tenant_id%'
ORDER BY p.tablename, p.policyname;
-- Expected: 42+ rows — same as Delta's pre-migration baseline.
-- If count drops, a policy was accidentally dropped. DO NOT PROCEED.

-- V10: Confirm finalize_stripe_event returns 1 on valid transition, 0 on invalid
-- (Run in a test transaction — ROLLBACK after verifying results)
-- BEGIN;
-- INSERT INTO public.stripe_events (id, event_type, payment_status, claimed_at)
--   VALUES ('evt_test_v10', 'test.event', 'processing', now());
-- SELECT public.finalize_stripe_event('evt_test_v10', 'processed', ARRAY['processing'], now(), NULL);
-- -- Expected: 1
-- SELECT public.finalize_stripe_event('evt_test_v10', 'failed', ARRAY['processing'], NULL, 'test');
-- -- Expected: 0 (row is now 'processed', not in allowed_from)
-- ROLLBACK;

-- V11: Confirm merge_stripe_payment_completed rejects p_amount_paid <= 0
-- (Run in a test transaction — ROLLBACK after verifying results)
-- BEGIN;
-- SELECT public.merge_stripe_payment_completed('test-order', 'test-tenant', 'sess_x', 'paid', 'stripe', 0);
-- -- Expected: EXCEPTION 'p_amount_paid must be > 0'
-- ROLLBACK;
