-- ============================================================
-- stripe-security-migration.sql
-- Casabe Konnect — Security Sprint tickets N2, N1, H3, M2
-- Author: Forge (Dev Lead)
-- Status: DRAFT — pending Delta review + Jefe go-ahead
-- DO NOT APPLY without explicit approval
-- ============================================================
-- Changes (in order):
--   1. N2  — Driver UPDATE policy + restrict_driver_order_update trigger
--   2. N1  — Backfill assignedDriverUserId from members.display_name
--   3. H3  — Revoke public EXECUTE on internal SECURITY DEFINER helpers
--            + add merge_stripe_payment_completed / merge_stripe_payment_status RPCs
--   4. M2  — Pin SET search_path = '' on four financial functions
-- ============================================================

-- ============================================================
-- ROLLBACK BLOCK (commented out — uncomment to reverse)
-- ============================================================
/*
BEGIN;

-- Reverse M2
CREATE OR REPLACE FUNCTION public.generate_receipt_number() RETURNS TEXT AS $$
DECLARE next_seq INTEGER; year_month TEXT;
BEGIN
  year_month := TO_CHAR(NOW(), 'YYYY-MM');
  SELECT COUNT(*) + 1 INTO next_seq FROM payment_receipts
    WHERE receipt_number LIKE 'RCP-' || year_month || '-%';
  RETURN 'RCP-' || year_month || '-' || LPAD(next_seq::TEXT, 5, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.generate_invoice_number() RETURNS TEXT AS $$
DECLARE next_seq INTEGER; year_month TEXT;
BEGIN
  year_month := TO_CHAR(NOW(), 'YYYY-MM');
  SELECT COUNT(*) + 1 INTO next_seq FROM invoices
    WHERE invoice_number LIKE 'INV-' || year_month || '-%';
  RETURN 'INV-' || year_month || '-' || LPAD(next_seq::TEXT, 5, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.calculate_invoice_total(
  p_subtotal_cents INTEGER, p_shipping_cents INTEGER,
  p_tax_cents INTEGER, p_discount_cents INTEGER DEFAULT 0
) RETURNS INTEGER AS $$
BEGIN
  RETURN (p_subtotal_cents + p_shipping_cents + p_tax_cents - COALESCE(p_discount_cents, 0));
END; $$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.update_invoice_timestamp() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); NEW.updated_by = auth.uid(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- Reverse H3: re-grant execute on internal helpers
-- (Re-grant only if you confirmed it is safe to restore public access)
GRANT EXECUTE ON FUNCTION public.get_user_role()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_office_ids()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role()             TO anon;

-- Drop merge RPCs added by H3
DROP FUNCTION IF EXISTS public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS public.merge_stripe_payment_status(TEXT,TEXT,TEXT);

-- Reverse N1 (cannot safely undo — data update is idempotent, leaving in place is safe)

-- Reverse N2
-- Note: orders_driver_update policy and restrict_driver_order_update trigger/function
-- were intentionally NOT created in the P0-2-fixed migration. Nothing to drop.
-- If these were applied from the *pre-fix* version, you can clean them up with:
-- DROP TRIGGER IF EXISTS trg_restrict_driver_order_update ON public.orders;
-- DROP FUNCTION IF EXISTS public.restrict_driver_order_update();
-- DROP POLICY IF EXISTS orders_driver_update ON public.orders;

COMMIT;
*/

-- ============================================================
-- MAIN MIGRATION
-- ============================================================
BEGIN;

-- ────────────────────────────────────────────────────────────
-- Change 1 — N2: Driver order access (RPC-only, no direct UPDATE)
--
-- P0-2 FIX: orders_driver_update policy is intentionally NOT created here.
-- Drivers update order status exclusively via the update_driver_status RPC
-- (SECURITY DEFINER). Direct driver UPDATE via RLS is intentionally prohibited.
-- The approved R1 architecture removed orders_driver_update; recreating it here
-- would reintroduce unsafe broad UPDATE access that the trigger cannot fully
-- constrain (it only blocks specific JSONB fields, not all non-status fields).
-- See: smoke-setup/update-driver-status-rpc.sql
--
-- NOTE: No orders_driver_update policy is created here.
-- Drivers update order status exclusively via the update_driver_status RPC (SECURITY DEFINER).
-- Direct driver UPDATE via RLS is intentionally prohibited.
-- See: smoke-setup/update-driver-status-rpc.sql
--
-- The restrict_driver_order_update trigger is also NOT created here: it is
-- defense-in-depth that only makes sense if drivers have UPDATE access at all.
-- Without the orders_driver_update policy, drivers have no UPDATE access to
-- block in the first place. The trigger is preserved in rollback for reference.
-- ────────────────────────────────────────────────────────────

-- Drop these objects if they exist from a previous (incorrect) apply.
-- Belt-and-suspenders cleanup: ensure no leftover policy or trigger remains.
DROP TRIGGER IF EXISTS trg_restrict_driver_order_update ON public.orders;
DROP FUNCTION IF EXISTS public.restrict_driver_order_update();
DROP POLICY IF EXISTS orders_driver_update ON public.orders;


-- ────────────────────────────────────────────────────────────
-- Change 2 — N1: Backfill assignedDriverUserId
-- Populates assignedDriverUserId for legacy orders where the
-- driver was set by name only (assignedDriver = display_name)
-- without the corresponding UUID.
-- NOTE: members.display_name is the column confirmed by the
-- frontend query (.select('user_id, display_name')) and by the
-- login handler (membership.display_name). If the live schema
-- uses a different column, replace display_name below.
-- ────────────────────────────────────────────────────────────
UPDATE public.orders o
SET data = jsonb_set(
  o.data,
  '{assignedDriverUserId}',
  to_jsonb(m.user_id::text),
  true  -- create key if absent
)
FROM public.members m
WHERE o.tenant_id = m.tenant_id
  AND o.data->>'assignedDriver' = m.display_name  -- match by driver's display name
  AND (o.data->>'assignedDriverUserId') IS NULL    -- only backfill missing entries
  AND m.role = 'driver'
  AND m.user_id IS NOT NULL
  AND m.active = true;                             -- only from active members


-- ────────────────────────────────────────────────────────────
-- Change 3 — H3: Revoke PUBLIC EXECUTE on internal helpers
-- + add webhook JSONB merge RPCs (called by service_role only)
--
-- P0-1 FIX: REVOKE FROM PUBLIC first, then from anon/authenticated.
-- PostgreSQL grants EXECUTE to PUBLIC by default on CREATE FUNCTION.
-- Revoking only from anon/authenticated leaves the PUBLIC grant intact,
-- which means any role (including future roles) can still call these RPCs.
-- Revoking from PUBLIC removes the default grant entirely.
--
-- P0-3 FIX: is_member, get_user_role, and can_access_order are NOT revoked.
-- These are called directly in RLS USING/WITH CHECK clauses on the orders
-- table. When PostgreSQL evaluates an RLS policy, it runs as the CALLING
-- role (not the function owner) unless the policy itself is SECURITY DEFINER.
-- Standard RLS policies are NOT SECURITY DEFINER — they run as the calling
-- user. If the calling authenticated user lacks EXECUTE on a helper referenced
-- in a USING/WITH CHECK clause, every RLS-gated read/write for that user will
-- fail with a permission error. Do not revoke these.
--
-- Functions NOT revoked (intentional):
--   is_member(text)       — called in RLS USING/WITH CHECK on orders
--   get_user_role()       — called in RLS USING/WITH CHECK on orders
--   can_access_order(text)— called in RLS USING/WITH CHECK on orders
--   lookup_tracking       — public tracking endpoint
--
-- Functions that ARE revoked (not directly embedded in RLS clauses):
--   get_user_office_ids()  — application code / other SECURITY DEFINER fns
--   is_hq()                — application code only
--   is_admin()             — application code only
--   current_tenant_id()    — application code only
--   get_user_tenant_id()   — application code only
--   log_commission_change()— trigger function (extra safety)
--
-- DELTA: Before applying, confirm that is_member, get_user_role, and
-- can_access_order are NOT also called from application-code RPC paths
-- that rely on direct client invocation. If they are, those callers must
-- be migrated to SECURITY DEFINER wrapper RPCs before these are revoked.
-- The functions listed above as revoked should be safe; verify with:
--   SELECT proname FROM pg_proc WHERE proname IN ('get_user_office_ids',
--   'is_hq','is_admin','current_tenant_id','get_user_tenant_id')
--   AND pronamespace = 'public'::regnamespace;
-- ────────────────────────────────────────────────────────────

-- P0-1: REVOKE FROM PUBLIC first, then named roles.
-- get_user_office_ids is a non-RLS helper; safe to fully revoke.
REVOKE EXECUTE ON FUNCTION public.get_user_office_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_office_ids() FROM anon, authenticated;

-- P0-3: IMPORTANT: is_member, get_user_role, and can_access_order are NOT revoked.
-- These are called directly in RLS USING/WITH CHECK clauses on the orders table.
-- Revoking EXECUTE from authenticated would break ALL RLS policy evaluation for
-- authenticated users — every read and write on orders would fail.
-- They are protected by being SECURITY DEFINER with SET search_path = ''
-- and should not be directly callable for sensitive write operations.
-- The appropriate mitigation is ensuring they cannot be misused as stand-alone
-- attack vectors (they are read-only membership/role checks with no side effects).

-- Tenant resolution and role helpers — not embedded in RLS USING clauses.
-- P0-1: Revoke from PUBLIC first, then named roles.
-- check_stripe_payment_write is a trigger function (not callable via RPC), kept as-is.
DO $$
BEGIN
  -- is_hq — application code only; safe to revoke
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_hq' AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.is_hq() FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.is_hq() FROM anon, authenticated';
  END IF;
  -- is_admin — application code only; safe to revoke
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_admin' AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, authenticated';
  END IF;
  -- is_member(text) — P0-3: DO NOT revoke. Called in RLS USING/WITH CHECK on orders.
  -- Revoking would break all authenticated user reads/writes on orders.
  -- (Left here as a comment to make the intentional omission explicit.)
  -- current_tenant_id — application code only; safe to revoke
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id' AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM anon, authenticated';
  END IF;
  -- get_user_tenant_id — application code only; safe to revoke
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_user_tenant_id' AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM anon, authenticated';
  END IF;
  -- can_access_order(text) — P0-3: DO NOT revoke. Called in RLS USING/WITH CHECK on orders.
  -- Revoking would break all authenticated user reads/writes on orders.
  -- (Left here as a comment to make the intentional omission explicit.)
  -- get_user_role() — P0-3: DO NOT revoke. Called in RLS USING/WITH CHECK on orders.
  -- (Left here as a comment to make the intentional omission explicit.)
  -- log_commission_change (trigger function — cannot be called via RPC directly,
  -- but revoke anyway in case a zero-argument variant is callable)
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'log_commission_change' AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.log_commission_change() FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.log_commission_change() FROM anon, authenticated';
  END IF;
  -- restrict_driver_order_update: dropped above in Change 1; nothing to revoke.
  -- If it is somehow still present from a previous migration, clean up.
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'restrict_driver_order_update' AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.restrict_driver_order_update() FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.restrict_driver_order_update() FROM anon, authenticated';
  END IF;
END $$;

-- NOTE: lookup_tracking is deliberately NOT revoked here.
-- It is the public tracking endpoint used by the TrackingPage and external links.
-- Rate limiting for lookup_tracking should be enforced at the API gateway / Edge Function
-- layer, not via REVOKE. TODO: add rate limiter in the tracking Edge Function.

-- ── Webhook JSONB merge RPCs (called ONLY by service_role webhook) ──────────
-- These two functions are used by the stripe-webhook Edge Function to write
-- payment status inside the data JSONB column without clobbering other fields.
-- Callable only by service_role; anon/authenticated explicitly denied.

-- merge_stripe_payment_completed: called on checkout.session.completed
-- Writes stripe_session_id and full payment block into data JSONB.
CREATE OR REPLACE FUNCTION public.merge_stripe_payment_completed(
  p_order_id        TEXT,
  p_tenant_id       TEXT,
  p_session_id      TEXT,
  p_payment_status  TEXT,
  p_payment_method  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.orders
  SET data = data
    -- Set stripe_session_id inside data JSONB
    || jsonb_build_object('stripe_session_id', p_session_id)
    -- Merge payment block: preserve any existing payment fields, override status/method/session
    || jsonb_build_object(
         'payment', COALESCE(data->'payment', '{}'::jsonb)
           || jsonb_build_object(
                'status',            p_payment_status,
                'method',            p_payment_method,
                'stripe_session_id', p_session_id
              )
       )
  WHERE id = p_order_id
    AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_stripe_payment_completed: order % not found for tenant %', p_order_id, p_tenant_id;
  END IF;
END;
$$;

-- P0-1: Revoke from PUBLIC first to eliminate the default grant,
-- then revoke from named roles explicitly.
REVOKE EXECUTE ON FUNCTION public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT)
  FROM anon, authenticated;
-- Explicitly grant to service_role (does not rely on superuser bypass)
GRANT EXECUTE ON FUNCTION public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT)
  TO service_role;

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
  WHERE id = p_order_id
    AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_stripe_payment_status: order % not found for tenant %', p_order_id, p_tenant_id;
  END IF;
END;
$$;

-- P0-1: Revoke from PUBLIC first, then named roles.
REVOKE EXECUTE ON FUNCTION public.merge_stripe_payment_status(TEXT,TEXT,TEXT)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_stripe_payment_status(TEXT,TEXT,TEXT)
  FROM anon, authenticated;
-- Explicitly grant to service_role (does not rely on superuser bypass)
GRANT EXECUTE ON FUNCTION public.merge_stripe_payment_status(TEXT,TEXT,TEXT)
  TO service_role;


-- ────────────────────────────────────────────────────────────
-- Change 4 — M2: Pin SET search_path = '' on four financial functions
-- Preserves existing function bodies exactly; only adds SET search_path = ''.
-- All table references are schema-qualified (public.*) to compensate.
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
-- Note: This function calls auth.uid() which requires the auth schema to be
-- accessible. SET search_path = '' makes schema resolution explicit.
-- auth.uid() is schema-qualified already by Supabase internals, so this is safe.
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
-- POST-COMMIT VERIFY
-- Run these queries after applying to confirm all changes landed.
-- ============================================================

-- V1: Confirm orders_driver_update policy does NOT exist (P0-2: intentionally removed)
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'orders' AND policyname = 'orders_driver_update';
-- Expected: 0 rows (policy intentionally absent; drivers use update_driver_status RPC)

-- V2: Confirm restrict_driver_order_update trigger does NOT exist (P0-2: intentionally removed)
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'trg_restrict_driver_order_update'
  AND tgrelid = 'public.orders'::regclass;
-- Expected: 0 rows (trigger intentionally absent)

-- V3: Confirm N1 backfill ran (check for any remaining unfilled rows)
SELECT COUNT(*) AS unfilled_driver_orders
FROM public.orders o
WHERE o.data->>'assignedDriver' IS NOT NULL
  AND (o.data->>'assignedDriverUserId') IS NULL;
-- Expected: ideally 0; any residual rows had no matching members.display_name row

-- V4: Confirm REVOKE landed for revoked helpers
-- P0-3: get_user_role, is_member, can_access_order are intentionally NOT revoked
-- (they are called in RLS USING/WITH CHECK clauses).
SELECT proname, proacl
FROM pg_proc
WHERE proname IN ('get_user_office_ids', 'is_hq', 'is_admin',
                  'current_tenant_id', 'get_user_tenant_id', 'log_commission_change')
  AND pronamespace = 'public'::regnamespace;
-- Expected: proacl should NOT contain entries for anon, authenticated, or PUBLIC.
-- (NULL proacl means all-default stripped — correct after REVOKE FROM PUBLIC)

-- V4b: Confirm RLS helpers are still callable by authenticated (P0-3: must NOT be revoked)
SELECT proname, proacl
FROM pg_proc
WHERE proname IN ('get_user_role', 'is_member', 'can_access_order')
  AND pronamespace = 'public'::regnamespace;
-- Expected: proacl should still include PUBLIC or authenticated EXECUTE grant
-- (these must remain callable for RLS USING/WITH CHECK evaluation)

-- V5: Confirm merge RPCs exist, are SECURITY DEFINER, and are restricted to service_role
SELECT proname, prosecdef, proconfig, proacl
FROM pg_proc
WHERE proname IN ('merge_stripe_payment_completed', 'merge_stripe_payment_status')
  AND pronamespace = 'public'::regnamespace;
-- Expected: 2 rows
--   prosecdef = true
--   proconfig includes 'search_path='
--   proacl: should contain service_role=X grant; should NOT contain PUBLIC, anon, or authenticated

-- V6: Confirm M2 functions have search_path pinned
SELECT proname, proconfig
FROM pg_proc
WHERE proname IN ('generate_receipt_number', 'generate_invoice_number',
                  'calculate_invoice_total', 'update_invoice_timestamp')
  AND pronamespace = 'public'::regnamespace;
-- Expected: all 4 rows have proconfig = '{search_path=}'

-- V7: Smoke-test merge RPC with a test order (replace with real test order ID)
-- SELECT public.merge_stripe_payment_status('SMOKE-001', '<tenant_id>', 'paid');
-- SELECT data->'payment'->>'status', data->>'stripe_session_id' FROM orders WHERE id = 'SMOKE-001';
