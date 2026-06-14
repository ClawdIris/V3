-- ════════════════════════════════════════════════════════════════════════════
-- r1-rls-driver-fix.sql
-- Casabe Konnect — R1 Conditional Release: Driver RLS Gap Fix
-- ════════════════════════════════════════════════════════════════════════════
-- Author  : Forge (Dev Lead)
-- Reviewer: Delta (QA Lead)
-- Date    : 2026-06-14
-- Priority: P0 SECURITY BLOCKER — R1 conditional release gate
-- Status  : ALREADY LIVE — DO NOT REAPPLY
--           Verified by Jeffrey Gonzalez 2026-06-14 16:14 EDT
--           orders_member_all: ABSENT. Five scoped policies: live.
--           Driver A sees exactly SMOKE-001+002. HQ/Office see all 19.
--           Cross-tenant: zero. Anon: zero.
--           Reapplying would fail — policy names already exist.
--
-- PROBLEM:
--   The existing `orders_member_all` policy (FOR ALL USING (is_member(tenant_id)))
--   grants every active tenant member — including drivers — full SELECT access
--   to all tenant orders. can_access_order() exists in the live DB but is NOT
--   wired into any RLS policy. Driver-to-driver isolation is frontend-only.
--   Driver B can issue a raw Supabase query and see Driver A's orders.
--
-- SOLUTION:
--   1. DROP orders_member_all (the overly-broad ALL policy).
--   2. CREATE orders_hq_office_select — HQ + Office + Owner + Admin roles
--      get full tenant SELECT (all orders in their tenant).
--   3. CREATE orders_driver_select — Drivers see ONLY orders where
--      data->>'assignedDriverUserId' = auth.uid()::text, enforced via
--      can_access_order(id) which is a live SECURITY DEFINER function.
--   4. Recreate non-SELECT policies (INSERT, UPDATE, DELETE) scoped to
--      HQ/Office only. Drivers write exclusively via the
--      update_driver_status() RPC (SECURITY DEFINER).
--
-- SCOPE OF CHANGE:
--   Only the `orders` table RLS policies are modified.
--   No schema changes (no ADD COLUMN, no ALTER TABLE).
--   No other tables are affected.
--   The three test_tenant_anon_* policies are NOT touched.
--
-- FUNCTIONS RELIED UPON (all confirmed live in DB):
--   • is_member(tenant_id TEXT)       — tenant membership check
--   • get_user_role()                  — returns COALESCE(app_role, role)
--   • can_access_order(p_order_id TEXT)— driver-scope check; verifies
--       tenant match + role='driver' + assignedDriverUserId = auth.uid()
--       NOTE: orders.id is TEXT (not UUID). Function signature is TEXT.
--
-- VERIFICATION QUERIES:
--   After apply, run the queries at the bottom of this file to confirm
--   the expected policy set before running smoke tests.
--
-- ROLLBACK:
--   See r1-rls-driver-fix-rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- SAFETY GATE: Confirm required helper functions exist before changing policies.
-- If any of these return 0 rows, ABORT and investigate before proceeding.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing TEXT := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'is_member'
  ) THEN
    v_missing := v_missing || ' is_member()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'get_user_role'
  ) THEN
    v_missing := v_missing || ' get_user_role()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'can_access_order'
  ) THEN
    v_missing := v_missing || ' can_access_order()';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'R1-RLS-GATE: Required functions missing:%  — ABORT migration.', v_missing;
  END IF;
END;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 1: Drop the overly-permissive policy
-- ────────────────────────────────────────────────────────────────────────────
-- orders_member_all was FOR ALL USING (is_member(tenant_id)).
-- It granted any tenant member (including drivers) full SELECT + INSERT +
-- UPDATE + DELETE access with no role discrimination. Dropping it closes
-- the driver cross-order visibility gap. The explicit policies below
-- replace it with properly scoped access.

DROP POLICY IF EXISTS orders_member_all ON public.orders;


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 2: HQ, Office, Owner, Admin SELECT policy
-- ────────────────────────────────────────────────────────────────────────────
-- These roles have full visibility into all orders within their tenant.
-- Tenant isolation: is_member(tenant_id) verifies the row belongs to the
-- calling user's tenant. Role check: get_user_role() reads
-- COALESCE(app_role, role) from members.

CREATE POLICY orders_hq_office_select ON public.orders
  FOR SELECT
  USING (
    is_member(tenant_id)
    AND get_user_role() IN ('hq', 'office', 'owner', 'admin')
  );


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 3: Driver SELECT policy — scoped to assigned orders only
-- ────────────────────────────────────────────────────────────────────────────
-- Drivers see ONLY orders they are assigned to.
--
-- can_access_order(id) is a SECURITY DEFINER function that checks:
--   1. The calling user is an active member of the order's tenant
--   2. The calling user's role is 'driver'
--   3. data->>'assignedDriverUserId' = calling user's auth.uid()::text
--
-- The outer is_member(tenant_id) is a fast short-circuit guard that
-- avoids calling can_access_order() on orders from unrelated tenants.
--
-- NET EFFECT: Driver B sees zero orders until assigned to one. Driver A
-- sees only their assigned orders. Cross-driver visibility is closed at
-- the DB layer, not just in the frontend.

CREATE POLICY orders_driver_select ON public.orders
  FOR SELECT
  USING (
    is_member(tenant_id)
    AND get_user_role() = 'driver'
    AND can_access_order(id)
  );


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 4: HQ/Office INSERT policy
-- ────────────────────────────────────────────────────────────────────────────

CREATE POLICY orders_hq_office_insert ON public.orders
  FOR INSERT
  WITH CHECK (
    is_member(tenant_id)
    AND get_user_role() IN ('hq', 'office', 'owner', 'admin')
  );


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 5: HQ/Office UPDATE policy
-- ────────────────────────────────────────────────────────────────────────────
-- Drivers do NOT get an UPDATE policy here.
-- Driver status changes go exclusively through update_driver_status()
-- (SECURITY DEFINER RPC), which writes only `status` and `updated_at`.
-- A broad driver UPDATE policy would expose payment, customer, and
-- assignment fields to client-side writes.

CREATE POLICY orders_hq_office_update ON public.orders
  FOR UPDATE
  USING (
    is_member(tenant_id)
    AND get_user_role() IN ('hq', 'office', 'owner', 'admin')
  )
  WITH CHECK (
    is_member(tenant_id)
    AND get_user_role() IN ('hq', 'office', 'owner', 'admin')
  );


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 6: HQ/Office DELETE policy
-- ────────────────────────────────────────────────────────────────────────────

CREATE POLICY orders_hq_office_delete ON public.orders
  FOR DELETE
  USING (
    is_member(tenant_id)
    AND get_user_role() IN ('hq', 'office', 'owner', 'admin')
  );


COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFICATION QUERIES
-- Run ALL of these after applying; all must return expected results.
-- ════════════════════════════════════════════════════════════════════════════

-- V1: Full policy list on orders table.
-- Expected after apply:
--   orders_hq_office_select (SELECT)
--   orders_driver_select    (SELECT)
--   orders_hq_office_insert (INSERT)
--   orders_hq_office_update (UPDATE)
--   orders_hq_office_delete (DELETE)
--   test_tenant_anon_insert, test_tenant_anon_read, test_tenant_anon_update
--     (these are unchanged — dev-only, scoped to tenant_id = 'test-tenant')
--   orders_member_all should NOT appear.

SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'orders'
ORDER BY policyname;

-- V2: Confirm driver policy uses can_access_order().
-- Expected: 1 row — orders_driver_select

SELECT policyname, qual
FROM pg_policies
WHERE tablename = 'orders'
  AND qual ILIKE '%can_access_order%';

-- V3: Confirm orders_member_all is gone.
-- Expected: 0 rows

SELECT policyname
FROM pg_policies
WHERE tablename = 'orders'
  AND policyname = 'orders_member_all';

-- V4: Confirm all 5 new policies present.
-- Expected: 5 rows

SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'orders'
  AND policyname IN (
    'orders_hq_office_select',
    'orders_driver_select',
    'orders_hq_office_insert',
    'orders_hq_office_update',
    'orders_hq_office_delete'
  )
ORDER BY cmd, policyname;

-- V5: Confirm helper functions are executable by authenticated role.
-- Expected: all 3 rows = TRUE

SELECT
  has_function_privilege('authenticated', 'public.is_member(text)',   'EXECUTE') AS is_member_ok,
  has_function_privilege('authenticated', 'public.get_user_role()',   'EXECUTE') AS get_user_role_ok,
  has_function_privilege('authenticated', 'public.can_access_order(text)', 'EXECUTE') AS can_access_order_ok;

-- V6: Confirm no driver UPDATE policy exists (drivers use RPC only).
-- Expected: 0 rows

SELECT policyname
FROM pg_policies
WHERE tablename = 'orders'
  AND policyname = 'orders_driver_update';
