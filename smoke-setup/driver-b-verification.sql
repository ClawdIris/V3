-- ════════════════════════════════════════════════════════════════════════════
-- driver-b-verification.sql
-- Casabe Konnect — Cross-Driver Isolation Verification Queries
-- ════════════════════════════════════════════════════════════════════════════
-- Author  : Forge (Dev Lead) — Delta runs these after account creation
-- Date    : 2026-06-14
-- Purpose : Prove driver-to-driver order isolation at the DB layer (not UI)
--
-- PREREQUISITES (must all be true before running):
--   1. r1-rls-driver-fix.sql has been applied to the live DB
--   2. create-driver-b.js has been run → Driver B account exists in
--      test-tenant as role=driver
--   3. SMOKE-001 and SMOKE-002 orders exist, assigned to Driver A
--      (test-driver@casabekonnect.test)
--   4. You have the JWT tokens for:
--      • smoke-hq@casabe-test.internal         (role=hq)
--      • test-driver@casabekonnect.test   (role=driver, SMOKE-001+002)
--      • smoke-office@casabe-test.internal     (role=office)
--      • test-driver-b@casabekonnect.test      (role=driver, NO orders)
--
-- HOW TO RUN AUTHENTICATED DB QUERIES WITH A JWT:
--   Use the Supabase SQL Editor "Run as user" feature, OR use the REST API
--   with the user's JWT in the Authorization header:
--
--     curl -X POST https://<project>.supabase.co/rest/v1/rpc/...
--       -H "Authorization: Bearer <USER_JWT>"
--       -H "apikey: <ANON_KEY>"
--
--   Or use the Node.js Supabase client with createClient(url, ANON_KEY)
--   and then supabase.auth.setSession({ access_token: '<JWT>' }) before
--   querying. The service_role key bypasses RLS — do NOT use it for
--   these tests. Tests must use user-level JWTs.
--
-- ════════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────────
-- TEST 1 — Driver A: Sees exactly SMOKE-001 and SMOKE-002
-- ────────────────────────────────────────────────────────────────────────────
-- Run this query authenticated as test-driver@casabekonnect.test.
-- RLS will filter to only orders where assignedDriverUserId = Driver A's UUID.
--
-- EXPECTED RESULT:
--   • Exactly 2 rows returned
--   • Row 1: id = 'SMOKE-001' (or its UUID), data->>'assignedDriverUserId' = Driver A's auth.uid()
--   • Row 2: id = 'SMOKE-002' (or its UUID), data->>'assignedDriverUserId' = Driver A's auth.uid()
--
-- FAIL CRITERIA:
--   • 0 rows → Driver A cannot see their own orders (policy too restrictive)
--   • >2 rows → Driver A sees other orders (policy too permissive)
--   • Any row where assignedDriverUserId ≠ Driver A's UUID → isolation broken

SELECT
  id,
  tenant_id,
  data->>'assignedDriverUserId'   AS assigned_driver_user_id,
  data->>'status'                  AS status,
  created_at
FROM public.orders
WHERE tenant_id = 'test-tenant'
ORDER BY created_at;

-- Quick row count (should be exactly 2 when run as Driver A):
SELECT COUNT(*) AS driver_a_visible_orders FROM public.orders WHERE tenant_id = 'test-tenant';


-- ────────────────────────────────────────────────────────────────────────────
-- TEST 2 — Driver B: Sees ZERO orders
-- ────────────────────────────────────────────────────────────────────────────
-- Run this query authenticated as test-driver-b@casabekonnect.test.
-- Driver B has no orders assigned. RLS must return zero rows.
--
-- EXPECTED RESULT:
--   • 0 rows returned (empty result set)
--   • COUNT = 0
--
-- FAIL CRITERIA:
--   • ANY rows returned → Driver B has cross-order visibility (P0 RLS gap not closed)
--   • This is the primary gate for R1 conditional release

SELECT
  id,
  tenant_id,
  data->>'assignedDriverUserId'   AS assigned_driver_user_id,
  data->>'status'                  AS status,
  created_at
FROM public.orders
WHERE tenant_id = 'test-tenant'
ORDER BY created_at;

-- Quick row count (must be exactly 0 when run as Driver B):
SELECT COUNT(*) AS driver_b_visible_orders FROM public.orders WHERE tenant_id = 'test-tenant';

-- Direct assertion form (useful in psql script):
-- Expected: 1 row with result = PASS
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS — Driver B sees zero orders ✅'
    ELSE 'FAIL — Driver B sees ' || COUNT(*) || ' order(s) ❌'
  END AS isolation_test_result
FROM public.orders
WHERE tenant_id = 'test-tenant';


-- ────────────────────────────────────────────────────────────────────────────
-- TEST 3 — HQ: Sees ALL tenant orders (no upper bound)
-- ────────────────────────────────────────────────────────────────────────────
-- Run authenticated as smoke-hq@casabe-test.internal (role=hq).
-- HQ must see every order in the tenant including SMOKE-001 and SMOKE-002.
--
-- EXPECTED RESULT:
--   • COUNT ≥ 2 (all existing orders, at minimum SMOKE-001 and SMOKE-002)
--   • Both SMOKE-001 and SMOKE-002 appear in results
--
-- FAIL CRITERIA:
--   • COUNT < 2 → HQ policy is too restrictive
--   • SMOKE-001 or SMOKE-002 missing → HQ cannot see assigned-driver orders

SELECT
  id,
  tenant_id,
  data->>'assignedDriverUserId'   AS assigned_driver_user_id,
  data->>'status'                  AS status,
  created_at
FROM public.orders
WHERE tenant_id = 'test-tenant'
ORDER BY created_at;

-- Count check:
SELECT COUNT(*) AS hq_visible_orders FROM public.orders WHERE tenant_id = 'test-tenant';

-- Specific SMOKE order check:
SELECT id, data->>'status' AS status
FROM public.orders
WHERE tenant_id = 'test-tenant'
  AND id IN (
    -- Replace with actual UUIDs from your smoke order creation run
    -- e.g. 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
    -- Or query by tracking number if your schema stores it differently:
    -- data->>'trackingId' IN ('SMOKE-001', 'SMOKE-002')
    SELECT id FROM public.orders
    WHERE tenant_id = 'test-tenant'
      AND data->>'trackingId' IN ('SMOKE-001', 'SMOKE-002')
  );


-- ────────────────────────────────────────────────────────────────────────────
-- TEST 4 — Office: Sees ALL tenant orders
-- ────────────────────────────────────────────────────────────────────────────
-- Run authenticated as smoke-office@casabe-test.internal (role=office).
-- Office has the same SELECT scope as HQ.
--
-- EXPECTED RESULT:
--   • Same result as HQ (all tenant orders visible)
--   • COUNT ≥ 2
--
-- FAIL CRITERIA:
--   • COUNT differs from HQ count → Office policy is inconsistent with HQ

SELECT COUNT(*) AS office_visible_orders FROM public.orders WHERE tenant_id = 'test-tenant';


-- ────────────────────────────────────────────────────────────────────────────
-- TEST 5 — Anon / Unauthenticated: Sees ZERO orders (belt-and-suspenders)
-- ────────────────────────────────────────────────────────────────────────────
-- Run without a JWT (using only the anon key with no user session).
-- The orders table has RLS enabled; anon users have no members row and
-- is_member() returns false for all rows.
--
-- EXPECTED RESULT:
--   • 0 rows (for casabe-xpress tenant — test-tenant has anon policies)
--   • For test-tenant, the test_tenant_anon_* policies may allow anon reads;
--     this is a known dev-only gap (separate cleanup ticket)
--
-- NOTE: This test verifies production tenant isolation for anon users.
-- Run against tenant_id = 'casabe-xpress' (NOT 'test-tenant').

SELECT COUNT(*) AS anon_visible_production_orders
FROM public.orders
WHERE tenant_id = 'casabe-xpress';


-- ════════════════════════════════════════════════════════════════════════════
-- SUMMARY REPORT TEMPLATE
-- Copy this into your test run notes:
-- ════════════════════════════════════════════════════════════════════════════
--
-- TEST RUN DATE   : ____________________
-- TESTER          : Delta (QA Lead)
-- MIGRATION APPLIED: r1-rls-driver-fix.sql (commit: ________)
--
-- TEST 1 — Driver A sees SMOKE-001 + SMOKE-002:   [ PASS / FAIL ]
--   Row count observed: ___
--   Notes: ______________________________________________
--
-- TEST 2 — Driver B sees ZERO orders:             [ PASS / FAIL ]
--   Row count observed: ___  (must be 0)
--   Notes: ______________________________________________
--
-- TEST 3 — HQ sees all tenant orders:             [ PASS / FAIL ]
--   Row count observed: ___  (must be ≥2)
--   SMOKE-001 present: [ YES / NO ]
--   SMOKE-002 present: [ YES / NO ]
--   Notes: ______________________________________________
--
-- TEST 4 — Office sees all tenant orders:         [ PASS / FAIL ]
--   Row count observed: ___  (must match HQ)
--   Notes: ______________________________________________
--
-- TEST 5 — Anon sees zero production orders:      [ PASS / FAIL ]
--   Row count observed: ___  (must be 0)
--   Notes: ______________________________________________
--
-- OVERALL RESULT: [ ALL PASS — CLEAR FOR JEFFREY REVIEW ]
--             OR: [ FAIL — SEE NOTES — DO NOT RELEASE ]
--
-- Delta Sign-off: ____________________  Date: __________
-- ════════════════════════════════════════════════════════════════════════════
