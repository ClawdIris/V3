-- ============================================================
-- Migration: test-tenant-policy-cleanup.sql
-- Purpose: Remove all anonymous order policies for test-tenant.
-- The ?debug=1 flow uses authenticated smoke accounts and does
-- not require anonymous order access. These policies are safe
-- to drop entirely.
-- Applied: pending Jefe approval + Delta review
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS test_tenant_anon_read   ON public.orders;
DROP POLICY IF EXISTS test_tenant_anon_insert ON public.orders;
DROP POLICY IF EXISTS test_tenant_anon_update ON public.orders;

COMMIT;

-- POST-COMMIT VERIFY:
-- Expected: 0 rows (all three policies removed)
SELECT policyname, roles, cmd
FROM pg_policies
WHERE tablename = 'orders'
  AND policyname IN (
    'test_tenant_anon_read',
    'test_tenant_anon_insert',
    'test_tenant_anon_update'
  );
-- Expected: 0 rows

-- Confirm no remaining anon policies on orders:
SELECT policyname, roles, cmd
FROM pg_policies
WHERE tablename = 'orders'
  AND 'anon' = ANY(roles);
-- Expected: 0 rows (no anon policies should remain)

-- ROLLBACK (if needed — run as transaction):
-- BEGIN;
-- CREATE POLICY test_tenant_anon_read ON public.orders
--   FOR SELECT TO anon USING (tenant_id = 'test-tenant');
-- CREATE POLICY test_tenant_anon_insert ON public.orders
--   FOR INSERT TO anon WITH CHECK (tenant_id = 'test-tenant');
-- CREATE POLICY test_tenant_anon_update ON public.orders
--   FOR UPDATE TO anon USING (tenant_id = 'test-tenant')
--   WITH CHECK (tenant_id = 'test-tenant');
-- COMMIT;
