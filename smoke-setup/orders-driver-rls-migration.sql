-- NOTE: test_tenant_anon_* policies should be removed before R1 launch (separate cleanup migration)

-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION: Orders Driver RLS — Wire can_access_order() into SELECT policy
-- ════════════════════════════════════════════════════════════════════════════
-- Project  : Casabe Konnect (exayifxbqduhsxmmsnxr)
-- Author   : Forge (Dev Lead) — reviewed by Delta, approved by Jefe before apply
-- Date     : 2026-06-10
-- Priority : P0 Security Blocker — R1 gate
--
-- PROBLEM:
--   The existing `orders_member_all` policy grants SELECT (and ALL) access to
--   every tenant member via `is_member(tenant_id)`. This means Driver B can
--   query ALL tenant orders directly through the Supabase API. UI filtering is
--   not authorization. can_access_order() exists but is not wired into any RLS
--   policy.
--
-- SOLUTION:
--   1. Drop `orders_member_all` (the overly-permissive ALL policy).
--   2. Create `orders_hq_office_select` — HQ + Office roles get full tenant
--      SELECT access.
--   3. Create `orders_driver_select` — Drivers are scoped to orders where
--      data->>'assignedDriverUserId' matches their auth.uid().
--   4. Create HQ/Office INSERT, UPDATE, DELETE policies.
--   NOTE: No driver UPDATE policy — drivers write via update_driver_status()
--         RPC (SECURITY DEFINER, status-only). This closes the P0 issue where
--         a broad driver UPDATE policy would have exposed payment, customer,
--         and assignment fields to client-side writes.
--
-- PRESERVED:
--   The three test-tenant anon policies (test_tenant_anon_insert,
--   test_tenant_anon_read, test_tenant_anon_update) are NOT touched by this
--   migration. They are tenant_id-scoped to 'test-tenant' and do not affect
--   casabe-xpress data.
--
-- FUNCTION NAMES (confirmed from live DB and source):
--   • is_member(tenant_id)     — live, used by existing orders_member_all
--   • get_user_role()          — live, defined in SECURITY-FIX-PATCH.sql;
--                                reads COALESCE(app_role, role) from members
--   • can_access_order(p_order_id) — live, confirmed by Delta preflight Check 3;
--                                    reads app_role; checks assignedDriverUserId
--
--   ⚠️  get_user_tenant_id() does NOT exist in the codebase or live DB.
--       Tenant scoping uses is_member(tenant_id) — the column reference from
--       the orders row — consistent with the existing live policy pattern.
--
-- SCHEMA CHANGE GATE:
--   DO NOT APPLY without Delta review + Jefe approval.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Drop the overly-permissive policy
-- ─────────────────────────────────────────────────────────────────────────────
-- orders_member_all covers ALL commands (SELECT + INSERT + UPDATE + DELETE)
-- for any active tenant member. Dropping it removes the SELECT over-exposure.

DROP POLICY IF EXISTS orders_member_all ON public.orders;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: HQ and Office SELECT policy
-- ─────────────────────────────────────────────────────────────────────────────
-- HQ and Office roles can SELECT any order in their tenant.
-- Tenant isolation: is_member(tenant_id) ensures the row belongs to the
-- same tenant the calling user is a member of.
-- Role check: get_user_role() returns COALESCE(app_role, role) from members.

CREATE POLICY orders_hq_office_select ON public.orders
  FOR SELECT
  USING (
    is_member(tenant_id)
    AND (
      get_user_role() = 'hq'
      OR get_user_role() = 'office'
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Driver SELECT policy (scoped to assigned orders only)
-- ─────────────────────────────────────────────────────────────────────────────
-- Drivers can only SELECT orders where data->>'assignedDriverUserId' = auth.uid().
-- This is enforced inside can_access_order(id):
--   • Checks me.tenant_id = order.tenant_id (tenant isolation)
--   • Checks me.app_role = 'driver' AND assignedDriverUserId = me.user_id::text
-- The outer is_member(tenant_id) is a fast short-circuit guard.

CREATE POLICY orders_driver_select ON public.orders
  FOR SELECT
  USING (
    is_member(tenant_id)
    AND get_user_role() = 'driver'
    AND can_access_order(id)
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: HQ and Office INSERT policy
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY orders_hq_office_insert ON public.orders
  FOR INSERT
  WITH CHECK (
    is_member(tenant_id)
    AND (get_user_role() = 'hq' OR get_user_role() = 'office')
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: HQ and Office UPDATE policy
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY orders_hq_office_update ON public.orders
  FOR UPDATE
  USING (
    is_member(tenant_id)
    AND (get_user_role() = 'hq' OR get_user_role() = 'office')
  )
  WITH CHECK (
    is_member(tenant_id)
    AND (get_user_role() = 'hq' OR get_user_role() = 'office')
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: HQ and Office DELETE policy
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY orders_hq_office_delete ON public.orders
  FOR DELETE
  USING (
    is_member(tenant_id)
    AND (get_user_role() = 'hq' OR get_user_role() = 'office')
  );

-- NOTE: No orders_driver_update policy.
-- Drivers update order status exclusively through the update_driver_status()
-- SECURITY DEFINER RPC, which writes only `status` and `updated_at`.
-- A broad client-side UPDATE policy would expose payment, customer, and
-- assignment fields to driver manipulation.

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (run as a transaction if migration needs to be reversed):
-- ════════════════════════════════════════════════════════════════════════════
-- BEGIN;
-- DROP POLICY IF EXISTS orders_hq_office_select ON public.orders;
-- DROP POLICY IF EXISTS orders_driver_select ON public.orders;
-- DROP POLICY IF EXISTS orders_hq_office_insert ON public.orders;
-- DROP POLICY IF EXISTS orders_hq_office_update ON public.orders;
-- DROP POLICY IF EXISTS orders_hq_office_delete ON public.orders;
-- CREATE POLICY orders_member_all ON public.orders FOR ALL USING (is_member(tenant_id));
-- COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES
-- ════════════════════════════════════════════════════════════════════════════
-- Run these AFTER applying the migration and BEFORE running smoke tests.

-- Verify 1: Full policy list on orders table
-- Expected: orders_hq_office_select, orders_driver_select, and the three
-- test_tenant_anon_* policies. orders_member_all and orders_driver_update
-- should NOT appear.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'orders'
ORDER BY policyname;

-- Verify 2: Confirm can_access_order() is referenced in policy qual
-- Expected: 1 row — orders_driver_select
SELECT policyname, qual
FROM pg_policies
WHERE tablename = 'orders'
  AND qual LIKE '%can_access_order%';

-- Verify 3: Confirm orders_member_all is gone
-- Expected: 0 rows
SELECT policyname
FROM pg_policies
WHERE tablename = 'orders'
  AND policyname = 'orders_member_all';

-- Verify 4: Confirm get_user_role() function exists in public schema
-- Expected: 1 row
SELECT routine_name, routine_schema
FROM information_schema.routines
WHERE routine_name = 'get_user_role'
  AND routine_schema = 'public';

-- Verify 5: Confirm can_access_order() function exists in public schema
-- Expected: 1 row
SELECT routine_name, routine_schema
FROM information_schema.routines
WHERE routine_name = 'can_access_order'
  AND routine_schema = 'public';

-- Verify 6: Confirm all 5 expected policies present after migration
-- Expected: 5 rows
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'orders'
AND policyname IN (
  'orders_hq_office_select',
  'orders_driver_select',
  'orders_hq_office_insert',
  'orders_hq_office_update',
  'orders_hq_office_delete'
)
ORDER BY cmd, policyname;
-- Expected: 5 rows

-- Verify 7: Confirm orders_driver_update does NOT exist
-- Expected: 0 rows
SELECT policyname
FROM pg_policies
WHERE tablename = 'orders'
  AND policyname = 'orders_driver_update';


-- ════════════════════════════════════════════════════════════════════════════
-- GAPS FOR DELTA REVIEW (before Jefe approval)
-- ════════════════════════════════════════════════════════════════════════════
--
-- GAP 1 — Driver writes now via RPC:
--   Driver status changes go through update_driver_status() (SECURITY DEFINER).
--   Deploy update-driver-status-rpc.sql before or alongside this migration.
--   The index.html changeStatus() function has been patched to call the RPC
--   when roleKey === 'driver', falling back to _db.upsert for HQ/Office.
--
-- GAP 2 — test_tenant_anon_* policies:
--   These allow anon INSERT/UPDATE/READ on tenant_id = 'test-tenant'. They are
--   not removed by this migration. Delta should confirm these are intentional
--   dev-only policies and schedule removal before R1 production launch.
--
-- GAP 3 — get_user_role() reads COALESCE(app_role, role):
--   Since get_user_role() uses COALESCE(app_role, role), existing members rows
--   where app_role IS NULL will fall back to role. For R1 smoke accounts this
--   is fine since create-smoke-accounts.js now writes both columns. For any
--   existing real user accounts, confirm app_role is populated or that the
--   COALESCE fallback is acceptable.
