-- ════════════════════════════════════════════════════════════════════════════
-- r1-rls-driver-fix-rollback.sql
-- Casabe Konnect — R1 RLS Driver Fix: ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- Author  : Forge (Dev Lead)
-- Reviewer: Delta (QA Lead) — review alongside forward migration
-- Date    : 2026-06-14
--
-- PURPOSE:
--   Reverts r1-rls-driver-fix.sql completely.
--   Drops all 5 new scoped policies and restores the original
--   orders_member_all policy (FOR ALL USING (is_member(tenant_id))).
--
-- WHEN TO USE:
--   Only if r1-rls-driver-fix.sql was applied and must be reversed.
--   After rollback, the driver cross-order visibility gap is REOPENED.
--   Do not leave rollback state in production. Re-apply the fix ASAP.
--
-- WARNING:
--   Rolling back restores the P0 security gap (Driver B sees all orders).
--   Only use in an emergency with explicit Jeffrey approval.
--
-- ROLLBACK DOES NOT TOUCH:
--   • test_tenant_anon_* policies (were not modified by the forward migration)
--   • Any other table's RLS policies
--   • Any functions (is_member, get_user_role, can_access_order)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 1: Drop the scoped policies added by r1-rls-driver-fix.sql
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS orders_hq_office_select ON public.orders;
DROP POLICY IF EXISTS orders_driver_select    ON public.orders;
DROP POLICY IF EXISTS orders_hq_office_insert ON public.orders;
DROP POLICY IF EXISTS orders_hq_office_update ON public.orders;
DROP POLICY IF EXISTS orders_hq_office_delete ON public.orders;


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 2: Restore the original overly-permissive policy
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️  WARNING: This restores the P0 security gap.
-- Any authenticated tenant member (including drivers) will again have
-- full SELECT access to all tenant orders.

CREATE POLICY orders_member_all ON public.orders
  FOR ALL
  USING (is_member(tenant_id));


COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- POST-ROLLBACK VERIFICATION
-- ════════════════════════════════════════════════════════════════════════════

-- R1: Confirm orders_member_all is restored.
-- Expected: 1 row

SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'orders'
  AND policyname = 'orders_member_all';

-- R2: Confirm all 5 scoped policies are gone.
-- Expected: 0 rows

SELECT policyname
FROM pg_policies
WHERE tablename = 'orders'
  AND policyname IN (
    'orders_hq_office_select',
    'orders_driver_select',
    'orders_hq_office_insert',
    'orders_hq_office_update',
    'orders_hq_office_delete'
  );

-- R3: Full orders policy list after rollback.

SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'orders'
ORDER BY policyname;
