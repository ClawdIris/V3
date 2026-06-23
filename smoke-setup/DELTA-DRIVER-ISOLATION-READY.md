# DELTA — Driver A/B Isolation Test: READY TO RUN
**Date:** 2026-06-14  
**Analyst:** Delta (QA/Debugger)  
**Status:** ✅ READY — awaiting Jefe to create SMOKE-001 and SMOKE-002 through HQ UI  
**Supabase Project:** `exayifxbqduhsxmmsnxr`  
**Production Tenant:** `casabe-xpress`  
**Debug URL:** `https://casabe-connect.netlify.app/?debug=1`

---

## OVERVIEW

This document is the complete, ready-to-run isolation test for the R1 Driver A/B
visibility gate. It covers all five required verification points:

1. SMOKE-001 and SMOKE-002 exist in DB (created via HQ UI)
2. HQ can see both orders
3. Office (Casabe Xpress) can see both orders (same tenant)
4. Driver A can see only their assigned orders
5. Driver B sees ZERO rows from Driver A's orders (DB-level RLS, not UI)
6. Cross-tenant query returns zero rows (belt-and-suspenders)

**IMPORTANT: Do NOT run this test until Jefe confirms both smoke orders exist.**
See Section 1 (Preflight Checklist) before touching the DB.

---

## SECTION 1 — PREFLIGHT CHECKLIST

All items below must be confirmed TRUE before running any query in this document.
Delta must sign off on each line.

### 1.1 — Applied Migrations

| Migration | File | Applied | Verified |
|-----------|------|---------|---------|
| Orders Driver RLS | `smoke-setup/orders-driver-rls-migration.sql` | ✅ (2026-06-10, DELTA-APPLY-RESULTS.md) | ✅ (5 policies confirmed) |
| Driver Status RPC | `smoke-setup/update-driver-status-rpc.sql` | ✅ (2026-06-10, DELTA-APPLY-RESULTS.md) | ✅ (GRANT confirmed) |
| Anon policy cleanup | `smoke-setup/test-tenant-policy-fix.sql` | ✅ (DELTA-TEST-TENANT-CLEANUP-APPLY.md) | ✅ |
| Members index (idx_members_user_id) | `routes-rebuild/migrations/03-members-index.sql` | ✅ (DELTA-MIGRATION-03-APPLY.md) | ✅ |

- [ ] Confirm: `orders_member_all` policy does NOT exist (was dropped by migration)
- [ ] Confirm: `orders_driver_select` policy EXISTS and references `can_access_order(id)`
- [ ] Confirm: `orders_hq_office_select` policy EXISTS
- [ ] Confirm: `can_access_order()` function EXISTS in `public` schema
- [ ] Confirm: `get_user_role()` function EXISTS in `public` schema
- [ ] Confirm: `update_driver_status()` RPC EXISTS in `public` schema

**Verification query (run as service role — READ ONLY):**
```sql
-- Run this block first. All 6 checks must pass before proceeding.

-- Check 1: orders_member_all must be gone
SELECT CASE WHEN COUNT(*) = 0
  THEN '✅ PASS — orders_member_all not present'
  ELSE '❌ FAIL — orders_member_all still exists!'
END AS check_1_member_all_gone
FROM pg_policies
WHERE tablename = 'orders' AND policyname = 'orders_member_all';

-- Check 2: driver select policy wired to can_access_order
SELECT CASE WHEN COUNT(*) = 1
  THEN '✅ PASS — orders_driver_select references can_access_order'
  ELSE '❌ FAIL — orders_driver_select not found or not wired'
END AS check_2_driver_select_policy
FROM pg_policies
WHERE tablename = 'orders'
  AND policyname = 'orders_driver_select'
  AND qual LIKE '%can_access_order%';

-- Check 3: HQ/Office select policy exists
SELECT CASE WHEN COUNT(*) = 1
  THEN '✅ PASS — orders_hq_office_select exists'
  ELSE '❌ FAIL — orders_hq_office_select missing'
END AS check_3_hq_office_select
FROM pg_policies
WHERE tablename = 'orders' AND policyname = 'orders_hq_office_select';

-- Check 4: can_access_order function exists
SELECT CASE WHEN COUNT(*) = 1
  THEN '✅ PASS — can_access_order() exists'
  ELSE '❌ FAIL — can_access_order() missing'
END AS check_4_can_access_order
FROM information_schema.routines
WHERE routine_name = 'can_access_order' AND routine_schema = 'public';

-- Check 5: get_user_role function exists
SELECT CASE WHEN COUNT(*) = 1
  THEN '✅ PASS — get_user_role() exists'
  ELSE '❌ FAIL — get_user_role() missing'
END AS check_5_get_user_role
FROM information_schema.routines
WHERE routine_name = 'get_user_role' AND routine_schema = 'public';

-- Check 6: update_driver_status RPC exists
SELECT CASE WHEN COUNT(*) = 1
  THEN '✅ PASS — update_driver_status() exists'
  ELSE '❌ FAIL — update_driver_status() missing'
END AS check_6_rpc_exists
FROM information_schema.routines
WHERE routine_name = 'update_driver_status' AND routine_schema = 'public';
```

**Expected: all 6 checks return PASS. If any FAIL, stop — do not proceed.**

---

### 1.2 — Smoke Accounts

All four smoke accounts must exist in `auth.users` AND have matching `public.members` rows with both `role` and `app_role` populated.

| Account | Email | Role | app_role | Expected Created |
|---------|-------|------|----------|-----------------|
| Smoke HQ | `smoke-hq@casabe-test.internal` | `hq` | `hq` | 2026-06-11 |
| Smoke Office | `smoke-office@casabe-test.internal` | `office` | `office` | 2026-06-11 |
| Smoke Driver A | `smoke-driver-a@casabe-test.internal` | `driver` | `driver` | 2026-06-11 |
| Smoke Driver B | `smoke-driver-b@casabe-test.internal` | `driver` | `driver` | 2026-06-11 |

**Verification query (run as service role — READ ONLY):**
```sql
-- Confirm all 4 smoke accounts exist in auth.users and members
-- Run as service role (bypasses RLS — read-only check only)
SELECT
  au.email,
  m.role,
  m.app_role,
  m.tenant_id,
  m.active,
  m.user_id AS member_user_id,
  au.id     AS auth_user_id,
  CASE WHEN au.id = m.user_id THEN '✅ UUID match' ELSE '❌ UUID MISMATCH' END AS uuid_check,
  CASE WHEN m.app_role IS NOT NULL THEN '✅ app_role set' ELSE '❌ app_role NULL' END AS app_role_check
FROM auth.users au
LEFT JOIN public.members m ON m.user_id = au.id AND m.tenant_id = 'casabe-xpress'
WHERE au.email IN (
  'smoke-hq@casabe-test.internal',
  'smoke-office@casabe-test.internal',
  'smoke-driver-a@casabe-test.internal',
  'smoke-driver-b@casabe-test.internal'
)
ORDER BY au.email;
```

**Expected: 4 rows, all with `active = true`, `uuid_check = ✅ UUID match`, `app_role_check = ✅ app_role set`.**

**CRITICAL:** If `app_role` is NULL for either driver account, `can_access_order()` will return `false` for all orders (the function reads `app_role`, not `role`). The RLS driver SELECT policy will produce a false zero for Driver A. Do NOT proceed until `app_role` is populated for all 4 accounts.

---

### 1.3 — Smoke Orders Created via HQ UI

**GATE: This section cannot be checked until Jefe creates SMOKE-001 and SMOKE-002 through the HQ UI at `https://casabe-connect.netlify.app/?debug=1`.**

Required order specifications (from HQ-ORDER-CREATION.md and DRIVER-SELECTOR-ACCEPTANCE-TEST.md):

| Order Label | Customer Name | Status | Assigned Driver | UUID Dual-Write Required |
|-------------|--------------|--------|-----------------|------------------------|
| SMOKE-001 | `Smoke Customer 001` | `need_box` | Smoke Driver A | ✅ `data.assignedDriverUserId` must be non-empty |
| SMOKE-002 | `Smoke Customer 002` | `ready_pickup` | Smoke Driver A | ✅ `data.assignedDriverUserId` must be non-empty |

Once created, record the actual system UUIDs here before running tests:

```
SMOKE-001 system UUID: ___________________________________
SMOKE-002 system UUID: ___________________________________
Smoke Driver A user_id UUID: ___________________________
```

**Verification query — confirm orders exist with correct dual-write (run as service role):**
```sql
-- Run after Jefe creates the orders through HQ UI
-- Replace the customer name filter if different names were used
SELECT
  id AS order_uuid,
  tenant_id,
  data->>'status'                AS status,
  data->>'assignedDriver'        AS assigned_driver_name,
  data->>'assignedDriverUserId'  AS assigned_driver_uuid,
  CASE
    WHEN data->>'assignedDriverUserId' IS NULL OR data->>'assignedDriverUserId' = ''
      THEN '❌ FAIL — assignedDriverUserId empty (dual-write broken)'
    ELSE '✅ UUID written'
  END AS dual_write_check
FROM public.orders
WHERE tenant_id = 'casabe-xpress'
  AND (
    data->>'fullName' IN ('Smoke Customer 001', 'Smoke Customer 002')
    OR data->>'customerName' IN ('Smoke Customer 001', 'Smoke Customer 002')
  )
ORDER BY created_at;

-- Row count check — expected 2 rows
SELECT COUNT(*) AS smoke_order_count
FROM public.orders
WHERE tenant_id = 'casabe-xpress'
  AND (
    data->>'fullName' IN ('Smoke Customer 001', 'Smoke Customer 002')
    OR data->>'customerName' IN ('Smoke Customer 001', 'Smoke Customer 002')
  );
```

**Expected: 2 rows, both with `dual_write_check = ✅ UUID written`, statuses `need_box` and `ready_pickup`.**

Also verify SMOKE-001 UUID matches Driver A UUID:
```sql
-- Confirm the driver UUID in the order matches the actual smoke-driver-a user_id
-- Replace '<SMOKE-001-UUID>' and '<DRIVER-A-UUID>' with actual values from above
SELECT
  o.id AS order_id,
  o.data->>'assignedDriverUserId' AS order_driver_uuid,
  m.user_id AS member_driver_uuid,
  au.email AS driver_email,
  CASE
    WHEN o.data->>'assignedDriverUserId' = m.user_id::text
      THEN '✅ PASS — UUID in order matches Driver A member row'
    ELSE '❌ FAIL — UUID mismatch between order and Driver A member row'
  END AS uuid_match_check
FROM public.orders o
JOIN auth.users au ON au.email = 'smoke-driver-a@casabe-test.internal'
JOIN public.members m ON m.user_id = au.id AND m.tenant_id = 'casabe-xpress'
WHERE o.tenant_id = 'casabe-xpress'
  AND (
    o.data->>'fullName' IN ('Smoke Customer 001', 'Smoke Customer 002')
    OR o.data->>'customerName' IN ('Smoke Customer 001', 'Smoke Customer 002')
  );
```

**Expected: 2 rows, both with `uuid_match_check = ✅ PASS`.**

---

## SECTION 2 — AUTHENTICATED ISOLATION TESTS

**METHOD:** Use the Supabase JavaScript client with user-level JWT tokens. Do NOT use the service_role key for these tests — the service_role bypasses RLS entirely and produces meaningless results.

### How to obtain JWT tokens for each account

```javascript
// Pattern for each account — run in Node.js with @supabase/supabase-js
// Use ANON key (not service_role) for all five tests below

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = 'https://exayifxbqduhsxmmsnxr.supabase.co';
const ANON_KEY     = process.env.SUPABASE_ANON_KEY; // public anon key — safe to use here

const supabase = createClient(SUPABASE_URL, ANON_KEY);

// Sign in with credentials for the account under test:
const { data: { session }, error } = await supabase.auth.signInWithPassword({
  email:    '<smoke-account-email>',
  password: '<password from password manager>',
});

const JWT = session.access_token;
console.log('JWT:', JWT);
// Use this JWT in the queries below
```

Alternatively, use the Supabase SQL Editor "Run as user" feature if available,
or pass the JWT to the REST API:
```
Authorization: Bearer <USER_JWT>
apikey: <ANON_KEY>
```

---

### TEST 1 — HQ Sees Both Smoke Orders ✅ Expected: PASS

**Run authenticated as:** `smoke-hq@casabe-test.internal`  
**RLS path:** `orders_hq_office_select` → `is_member(tenant_id) AND get_user_role() = 'hq'`

```javascript
// Authenticated as smoke-hq@casabe-test.internal
const { data: orders, error } = await supabase
  .from('orders')
  .select('id, tenant_id, data->assignedDriverUserId, data->status')
  .eq('tenant_id', 'casabe-xpress')
  .in('id', [SMOKE_001_UUID, SMOKE_002_UUID]);

console.assert(!error, 'HQ query error: ' + (error && error.message));
console.assert(
  Array.isArray(orders) && orders.length === 2,
  '❌ TEST 1 FAIL — HQ does not see both smoke orders. Rows: ' + (orders && orders.length)
);
console.log('TEST 1 row count:', orders.length, orders.length === 2 ? '✅ PASS' : '❌ FAIL');
```

**SQL equivalent (for Supabase SQL Editor "Run as HQ user"):**
```sql
-- Run authenticated as smoke-hq@casabe-test.internal
SELECT
  id,
  tenant_id,
  data->>'status'               AS status,
  data->>'assignedDriverUserId' AS assigned_driver_uuid
FROM public.orders
WHERE tenant_id = 'casabe-xpress'
  AND id IN (
    -- Replace with actual UUIDs
    '<SMOKE-001-UUID>',
    '<SMOKE-002-UUID>'
  );

-- Row count assertion
SELECT
  CASE WHEN COUNT(*) = 2
    THEN '✅ TEST 1 PASS — HQ sees both smoke orders'
    ELSE '❌ TEST 1 FAIL — HQ sees ' || COUNT(*) || ' smoke order(s)'
  END AS test_1_result
FROM public.orders
WHERE tenant_id = 'casabe-xpress'
  AND id IN ('<SMOKE-001-UUID>', '<SMOKE-002-UUID>');
```

**Pass condition:** 2 rows returned, both matching the smoke order UUIDs.  
**Fail condition:** 0 or 1 rows → `orders_hq_office_select` policy or `get_user_role()` broken.

---

### TEST 2 — Office Sees Both Smoke Orders ✅ Expected: PASS

**Run authenticated as:** `smoke-office@casabe-test.internal`  
**RLS path:** `orders_hq_office_select` → `is_member(tenant_id) AND get_user_role() = 'office'`

```javascript
// Authenticated as smoke-office@casabe-test.internal
const { data: orders, error } = await supabase
  .from('orders')
  .select('id, tenant_id')
  .eq('tenant_id', 'casabe-xpress')
  .in('id', [SMOKE_001_UUID, SMOKE_002_UUID]);

console.assert(!error, 'Office query error: ' + (error && error.message));
console.assert(
  Array.isArray(orders) && orders.length === 2,
  '❌ TEST 2 FAIL — Office does not see both smoke orders. Rows: ' + (orders && orders.length)
);
console.log('TEST 2 row count:', orders.length, orders.length === 2 ? '✅ PASS' : '❌ FAIL');
```

**SQL equivalent (Run as smoke-office@casabe-test.internal):**
```sql
SELECT
  CASE WHEN COUNT(*) = 2
    THEN '✅ TEST 2 PASS — Office sees both smoke orders'
    ELSE '❌ TEST 2 FAIL — Office sees ' || COUNT(*) || ' smoke order(s)'
  END AS test_2_result
FROM public.orders
WHERE tenant_id = 'casabe-xpress'
  AND id IN ('<SMOKE-001-UUID>', '<SMOKE-002-UUID>');
```

**Additional: Confirm Office count matches HQ count (same tenant, same SELECT scope):**
```sql
-- Run as Office user; expect same row count as HQ for full tenant
SELECT COUNT(*) AS office_total_orders
FROM public.orders
WHERE tenant_id = 'casabe-xpress';
-- Cross-reference: run same query as HQ and confirm counts match
```

**Pass condition:** 2 rows returned.  
**Fail condition:** 0 or 1 rows → `get_user_role()` returning wrong value for office account, or `app_role` not set to `'office'`.

---

### TEST 3 — Driver A Sees Exactly Their Assigned Orders ✅ Expected: PASS

**Run authenticated as:** `smoke-driver-a@casabe-test.internal`  
**RLS path:** `orders_driver_select` → `is_member(tenant_id) AND get_user_role() = 'driver' AND can_access_order(id)`  
**`can_access_order()` check:** `data->>'assignedDriverUserId' = auth.uid()::text`

```javascript
// Authenticated as smoke-driver-a@casabe-test.internal
const { data: orders, error } = await supabase
  .from('orders')
  .select('id, tenant_id, data->status, data->assignedDriverUserId')
  .eq('tenant_id', 'casabe-xpress');

console.assert(!error, 'Driver A query error: ' + (error && error.message));
console.assert(
  Array.isArray(orders) && orders.length === 2,
  '❌ TEST 3 FAIL — Driver A sees ' + (orders && orders.length) + ' orders (expected 2)'
);

// Confirm both rows are the smoke orders and belong to Driver A
if (orders && orders.length > 0) {
  orders.forEach(o => {
    const driverUuid = o.data && o.data.assignedDriverUserId;
    console.assert(
      driverUuid === DRIVER_A_UUID,
      '❌ TEST 3 FAIL — Driver A sees an order not assigned to them: ' + o.id
    );
  });
}
console.log('TEST 3 row count:', orders.length, orders.length === 2 ? '✅ PASS' : '❌ FAIL');
```

**SQL equivalent (Run as smoke-driver-a@casabe-test.internal):**
```sql
-- Full visibility check for Driver A
SELECT
  id,
  tenant_id,
  data->>'status'               AS status,
  data->>'assignedDriverUserId' AS assigned_driver_uuid
FROM public.orders
WHERE tenant_id = 'casabe-xpress'
ORDER BY created_at;

-- Assertion: expect exactly 2 rows (SMOKE-001 and SMOKE-002)
SELECT
  CASE
    WHEN COUNT(*) = 2 THEN '✅ TEST 3 PASS — Driver A sees exactly 2 orders'
    WHEN COUNT(*) = 0 THEN '❌ TEST 3 FAIL — Driver A sees 0 orders (RLS too restrictive or app_role NULL)'
    ELSE                   '❌ TEST 3 FAIL — Driver A sees ' || COUNT(*) || ' orders (RLS too permissive)'
  END AS test_3_result
FROM public.orders
WHERE tenant_id = 'casabe-xpress';

-- Also confirm both smoke UUIDs are present
SELECT
  CASE WHEN COUNT(*) = 2
    THEN '✅ TEST 3b PASS — Both smoke UUIDs visible to Driver A'
    ELSE '❌ TEST 3b FAIL — Only ' || COUNT(*) || ' of 2 smoke UUIDs visible'
  END AS test_3b_result
FROM public.orders
WHERE tenant_id = 'casabe-xpress'
  AND id IN ('<SMOKE-001-UUID>', '<SMOKE-002-UUID>');
```

**Additional: Confirm Driver view tabs are correct (UI-level, not RLS):**
- SMOKE-001 (`need_box`) → must appear in **My Drop-Offs** tab
- SMOKE-002 (`ready_pickup`) → must appear in **My Pickups** tab

**Pass condition:** Exactly 2 rows returned, both with Driver A's UUID in `assigned_driver_uuid`.  
**Fail condition:**
- 0 rows → `app_role` is NULL or `can_access_order()` broken
- >2 rows → `orders_driver_select` is not properly scoped (should not happen if RLS migration applied correctly)

---

### TEST 4 — Driver B Sees ZERO Rows (Primary Isolation Gate) 🚫 Expected: 0 rows

**Run authenticated as:** `smoke-driver-b@casabe-test.internal`  
**RLS path:** `orders_driver_select` → `can_access_order(id)` returns `false` for all orders (no orders assigned to Driver B)  
**This is the primary R1 hard-failure gate.**

```javascript
// Authenticated as smoke-driver-b@casabe-test.internal
const { data: orders, error } = await supabase
  .from('orders')
  .select('id, tenant_id, data->assignedDriverUserId')
  .eq('tenant_id', 'casabe-xpress');

// error may be null — RLS silently filters, does not throw 403
console.assert(
  Array.isArray(orders) && orders.length === 0,
  '❌❌❌ TEST 4 HARD FAIL — Driver B sees ' + (orders && orders.length) + ' order(s). ' +
  'DEPLOYMENT MUST BE HALTED. Cross-driver visibility is a P0 security regression.'
);

if (orders && orders.length > 0) {
  console.error('HARD FAIL DETAIL — Driver B visible orders:');
  orders.forEach(o => console.error('  order id:', o.id, 'assignedDriverUserId:', o['data->assignedDriverUserId']));
}

console.log('TEST 4 row count:', orders.length, orders.length === 0 ? '✅ PASS' : '❌❌❌ HARD FAIL');
```

**SQL equivalent (Run as smoke-driver-b@casabe-test.internal):**
```sql
-- PRIMARY ISOLATION GATE
-- Run authenticated as smoke-driver-b@casabe-test.internal
-- Driver B has NO orders assigned — must see ZERO rows

SELECT
  id,
  tenant_id,
  data->>'assignedDriverUserId' AS assigned_driver_uuid
FROM public.orders
WHERE tenant_id = 'casabe-xpress';

-- Hard assertion
SELECT
  CASE WHEN COUNT(*) = 0
    THEN '✅ TEST 4 PASS — Driver B sees ZERO orders (isolation confirmed)'
    ELSE '❌❌❌ TEST 4 HARD FAIL — Driver B sees ' || COUNT(*) || ' order(s) — DO NOT RELEASE'
  END AS test_4_isolation_result
FROM public.orders
WHERE tenant_id = 'casabe-xpress';
```

**Also check targeted SMOKE UUIDs directly (confirms specific order isolation):**
```sql
-- Confirm Driver B cannot see SMOKE-001 or SMOKE-002 specifically
SELECT
  CASE WHEN COUNT(*) = 0
    THEN '✅ TEST 4b PASS — Driver B cannot see smoke orders'
    ELSE '❌❌❌ TEST 4b HARD FAIL — Driver B sees smoke orders'
  END AS test_4b_specific_smoke_check
FROM public.orders
WHERE tenant_id = 'casabe-xpress'
  AND id IN ('<SMOKE-001-UUID>', '<SMOKE-002-UUID>');
```

**Pass condition:** Exactly 0 rows returned. `error` may be null (RLS filters silently).  
**HARD FAIL condition:** ANY rows returned → `can_access_order()` is not gating driver SELECT correctly. This is a P0 security regression. **Do not proceed. Do not release. Escalate immediately.**

> **Reminder from DRIVER-SELECTOR-ACCEPTANCE-TEST.md:**  
> "Driver B visibility is a hard failure. If Driver B can see any row that belongs  
> to Driver A's tenant (regardless of whether that specific row was assigned to  
> Driver A), it means the orders RLS policies are not correctly scoped and the  
> deployment must be halted."

---

### TEST 5 — Cross-Tenant Query Returns Zero Rows ✅ Expected: PASS

**Run authenticated as:** `smoke-hq@casabe-test.internal` (or any casabe-xpress user)  
**Purpose:** Confirm that querying a different tenant returns zero rows (tenant isolation is complete)

```javascript
// Authenticated as smoke-hq@casabe-test.internal (casabe-xpress tenant)
// Query a different tenant — is_member() must return false for all rows in another tenant

const { data: crossTenantOrders, error } = await supabase
  .from('orders')
  .select('id')
  .eq('tenant_id', 'casabe-test');  // or any other non-casabe-xpress tenant

console.assert(
  Array.isArray(crossTenantOrders) && crossTenantOrders.length === 0,
  '❌ TEST 5 FAIL — Cross-tenant read returned ' + (crossTenantOrders && crossTenantOrders.length) + ' rows'
);
console.log('TEST 5 cross-tenant row count:', crossTenantOrders.length,
  crossTenantOrders.length === 0 ? '✅ PASS' : '❌ FAIL');
```

**SQL equivalent (Run as smoke-hq@casabe-test.internal):**
```sql
-- Cross-tenant isolation check
-- HQ user from casabe-xpress tenant cannot read orders from any other tenant
SELECT
  CASE WHEN COUNT(*) = 0
    THEN '✅ TEST 5 PASS — Cross-tenant query returns zero rows'
    ELSE '❌ TEST 5 FAIL — Cross-tenant read returned ' || COUNT(*) || ' rows'
  END AS test_5_cross_tenant_result
FROM public.orders
WHERE tenant_id != 'casabe-xpress';  -- any other tenant

-- Specific check for test-tenant (where anon policies exist)
-- Note: test_tenant_anon_* policies were cleaned up (DELTA-TEST-TENANT-CLEANUP-APPLY.md)
-- but authenticated casabe-xpress users must also see zero rows in test-tenant
SELECT
  CASE WHEN COUNT(*) = 0
    THEN '✅ TEST 5b PASS — casabe-xpress HQ cannot read test-tenant orders'
    ELSE '❌ TEST 5b FAIL — casabe-xpress HQ can read test-tenant orders!'
  END AS test_5b_test_tenant_check
FROM public.orders
WHERE tenant_id = 'test-tenant';
```

**Pass condition:** 0 rows returned for any tenant other than `casabe-xpress`.  
**Fail condition:** Any rows → `is_member(tenant_id)` not correctly isolating tenants.

---

## SECTION 3 — DB-LEVEL VERIFICATION (Service Role — Structural Checks)

These queries use the **service role** (bypasses RLS) to verify the structural correctness
of what was written into the DB. They are complementary to the authenticated tests above
and prove the data is what it should be — not just that policies allow/deny correctly.

```sql
-- ═══════════════════════════════════════════════════════════════════
-- DB-LEVEL VERIFICATION BLOCK
-- Run as service role (bypasses RLS — structural checks only)
-- ═══════════════════════════════════════════════════════════════════

-- V1: Confirm SMOKE-001 exists with correct status and UUID dual-write
SELECT
  id,
  tenant_id,
  data->>'status'               AS status,
  data->>'assignedDriver'       AS driver_name,
  data->>'assignedDriverUserId' AS driver_uuid,
  CASE
    WHEN data->>'status' = 'need_box'
      AND data->>'assignedDriverUserId' IS NOT NULL
      AND data->>'assignedDriverUserId' != ''
      THEN '✅ V1 PASS — SMOKE-001 shape correct'
    ELSE '❌ V1 FAIL — SMOKE-001 status or UUID wrong'
  END AS v1_result
FROM public.orders
WHERE tenant_id = 'casabe-xpress'
  AND (
    data->>'fullName' = 'Smoke Customer 001'
    OR data->>'customerName' = 'Smoke Customer 001'
  );

-- V2: Confirm SMOKE-002 exists with correct status and UUID dual-write
SELECT
  id,
  tenant_id,
  data->>'status'               AS status,
  data->>'assignedDriver'       AS driver_name,
  data->>'assignedDriverUserId' AS driver_uuid,
  CASE
    WHEN data->>'status' = 'ready_pickup'
      AND data->>'assignedDriverUserId' IS NOT NULL
      AND data->>'assignedDriverUserId' != ''
      THEN '✅ V2 PASS — SMOKE-002 shape correct'
    ELSE '❌ V2 FAIL — SMOKE-002 status or UUID wrong'
  END AS v2_result
FROM public.orders
WHERE tenant_id = 'casabe-xpress'
  AND (
    data->>'fullName' = 'Smoke Customer 002'
    OR data->>'customerName' = 'Smoke Customer 002'
  );

-- V3: Confirm Driver A's UUID is the same in both orders and in members
SELECT
  m.user_id        AS driver_a_uuid_in_members,
  o.id             AS order_id,
  o.data->>'assignedDriverUserId' AS driver_uuid_in_order,
  CASE
    WHEN m.user_id::text = o.data->>'assignedDriverUserId'
      THEN '✅ V3 PASS — UUID consistent'
    ELSE '❌ V3 FAIL — UUID mismatch between members and order'
  END AS v3_uuid_consistency
FROM auth.users au
JOIN public.members m ON m.user_id = au.id AND m.tenant_id = 'casabe-xpress'
JOIN public.orders o ON o.tenant_id = 'casabe-xpress'
  AND (
    o.data->>'fullName' IN ('Smoke Customer 001', 'Smoke Customer 002')
    OR o.data->>'customerName' IN ('Smoke Customer 001', 'Smoke Customer 002')
  )
WHERE au.email = 'smoke-driver-a@casabe-test.internal';

-- V4: Confirm full policy state on orders table (structural)
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'orders'
ORDER BY policyname;
-- Expected policies:
--   orders_driver_select      | SELECT | is_member(tenant_id) AND get_user_role()='driver' AND can_access_order(id)
--   orders_hq_office_delete   | DELETE | ...
--   orders_hq_office_insert   | INSERT | ...
--   orders_hq_office_select   | SELECT | ...
--   orders_hq_office_update   | UPDATE | ...
-- Must NOT exist: orders_member_all, orders_driver_update

-- V5: Confirm can_access_order() function body references assignedDriverUserId
SELECT routine_definition
FROM information_schema.routines
WHERE routine_name = 'can_access_order'
  AND routine_schema = 'public';
-- Expected body includes: data->>'assignedDriverUserId' = me.user_id::text
-- and app_role IN ('hq', 'office') OR (app_role = 'driver' AND ...)

-- V6: Confirm smoke accounts have app_role populated (not NULL)
SELECT
  au.email,
  m.role,
  m.app_role,
  m.active,
  CASE WHEN m.app_role IS NOT NULL THEN '✅ OK' ELSE '❌ app_role NULL' END AS app_role_status
FROM auth.users au
JOIN public.members m ON m.user_id = au.id AND m.tenant_id = 'casabe-xpress'
WHERE au.email IN (
  'smoke-hq@casabe-test.internal',
  'smoke-office@casabe-test.internal',
  'smoke-driver-a@casabe-test.internal',
  'smoke-driver-b@casabe-test.internal'
)
ORDER BY au.email;
-- Expected: 4 rows, all app_role_status = ✅ OK
```

---

## SECTION 4 — RLS POLICY STRUCTURAL AUDIT

Run as service role. Confirms the policy layer is exactly what was applied by
`orders-driver-rls-migration.sql` (verified 2026-06-10 in DELTA-APPLY-RESULTS.md).

```sql
-- Full policy audit — run before and after any DB changes
-- Expected outcome documented in DELTA-APPLY-RESULTS.md Step 3

-- All orders policies (expected 8 total: 5 new + 3 legacy anon for test-tenant)
SELECT
  policyname,
  cmd,
  roles,
  LEFT(qual, 120) AS qual_excerpt,
  LEFT(with_check, 80) AS with_check_excerpt
FROM pg_policies
WHERE tablename = 'orders'
ORDER BY policyname;

-- Policy count check
SELECT
  COUNT(*) AS total_policies,
  CASE WHEN COUNT(*) >= 5
    THEN '✅ At least 5 policies present'
    ELSE '❌ FAIL — fewer than 5 policies'
  END AS policy_count_check
FROM pg_policies
WHERE tablename = 'orders';

-- Critical: orders_member_all must NOT exist
SELECT
  CASE WHEN COUNT(*) = 0
    THEN '✅ orders_member_all ABSENT — correct'
    ELSE '❌ orders_member_all PRESENT — overly-permissive policy still active!'
  END AS member_all_check
FROM pg_policies
WHERE tablename = 'orders' AND policyname = 'orders_member_all';

-- Critical: orders_driver_update must NOT exist
SELECT
  CASE WHEN COUNT(*) = 0
    THEN '✅ orders_driver_update ABSENT — correct (drivers use RPC only)'
    ELSE '❌ orders_driver_update PRESENT — broad driver UPDATE policy active!'
  END AS driver_update_check
FROM pg_policies
WHERE tablename = 'orders' AND policyname = 'orders_driver_update';
```

---

## SECTION 5 — FORBIDDEN WRITE TESTS (Post-Isolation)

After all five visibility tests pass, run these write-protection checks.
See `smoke-setup/forbidden-write-tests.md` for full details.

**Run authenticated as `smoke-driver-a@casabe-test.internal` (Driver A):**

```javascript
// Test A — Driver cannot write payment field
const { error: errA } = await supabase
  .from('orders')
  .update({ data: { payment: { method: 'HACKED', status: 'paid' } } })
  .eq('id', SMOKE_001_UUID);
console.assert(errA !== null, '❌ TEST A FAIL: Driver A wrote payment field');
console.log('TEST A — Payment write blocked:', errA ? '✅ PASS' : '❌ FAIL');

// Test B — Driver cannot write assignment field
const { error: errB } = await supabase
  .from('orders')
  .update({ assignedDriverUserId: 'fake-uuid-0000-0000' })
  .eq('id', SMOKE_001_UUID);
console.assert(errB !== null, '❌ TEST B FAIL: Driver A wrote assignment field');
console.log('TEST B — Assignment write blocked:', errB ? '✅ PASS' : '❌ FAIL');

// Test C — Driver cannot write customer data
const { error: errC } = await supabase
  .from('orders')
  .update({ customerName: 'HACKED' })
  .eq('id', SMOKE_001_UUID);
console.assert(errC !== null, '❌ TEST C FAIL: Driver A wrote customer data');
console.log('TEST C — Customer write blocked:', errC ? '✅ PASS' : '❌ FAIL');
```

**RPC happy path — Driver A can call `update_driver_status` (SMOKE-002 only):**
```javascript
// SMOKE-002 is in 'ready_pickup' — valid Driver A transition
const { data: rpcResult, error: rpcErr } = await supabase.rpc('update_driver_status', {
  p_order_id:   SMOKE_002_UUID,
  p_new_status: 'in_warehouse'
});
console.assert(!rpcErr, '❌ RPC FAIL: ' + (rpcErr && rpcErr.message));
console.assert(rpcResult && rpcResult.success === true, '❌ RPC shape wrong');
console.log('RPC happy path:', !rpcErr && rpcResult.success ? '✅ PASS' : '❌ FAIL');

// Verify DB was updated
const { data: updated } = await supabase
  .from('orders')
  .select('data')
  .eq('id', SMOKE_002_UUID)
  .single();
console.assert(
  updated && updated.data && updated.data.status === 'in_warehouse',
  '❌ RPC FAIL: DB status not updated. Got: ' + (updated && updated.data && updated.data.status)
);
```

> ⚠️ After the RPC test mutates SMOKE-002 status to `in_warehouse`, reset it back to
> `ready_pickup` via HQ before sign-off, or create fresh smoke orders.
> Log the mutation in the test run notes.

---

## SECTION 6 — TEST RUN NOTES TEMPLATE

Copy this template into your test run record and fill in results.

```
════════════════════════════════════════════════════════
DRIVER A/B ISOLATION TEST RUN
════════════════════════════════════════════════════════
Run Date    : ___________________  (EDT)
Tester      : Delta (QA Lead)
Site        : https://casabe-connect.netlify.app/?debug=1
Project     : exayifxbqduhsxmmsnxr

PREFLIGHT
─────────────────────────────────────────────────────────
  orders_member_all absent         : [ YES / NO ]
  orders_driver_select present     : [ YES / NO ]
  can_access_order() present       : [ YES / NO ]
  get_user_role() present          : [ YES / NO ]
  update_driver_status() present   : [ YES / NO ]
  All 4 smoke accounts exist       : [ YES / NO ]
  All 4 app_role values populated  : [ YES / NO ]
  SMOKE-001 UUID                   : _________________________
  SMOKE-002 UUID                   : _________________________
  Driver A user_id UUID            : _________________________

ISOLATION TESTS
─────────────────────────────────────────────────────────
  TEST 1 — HQ sees both orders          : [ PASS / FAIL ]
    Row count: ___ (expected 2)

  TEST 2 — Office sees both orders      : [ PASS / FAIL ]
    Row count: ___ (expected 2)

  TEST 3 — Driver A sees own orders only: [ PASS / FAIL ]
    Row count: ___ (expected 2)
    SMOKE-001 visible: [ YES / NO ]
    SMOKE-002 visible: [ YES / NO ]
    Both rows have Driver A UUID: [ YES / NO ]

  TEST 4 — Driver B sees ZERO orders    : [ PASS / HARD FAIL ]
    Row count: ___ (MUST be 0)
    ** ANY non-zero result = DO NOT RELEASE **

  TEST 5 — Cross-tenant returns zero    : [ PASS / FAIL ]
    Row count: ___ (expected 0)

DB STRUCTURAL VERIFICATION
─────────────────────────────────────────────────────────
  V1 SMOKE-001 shape correct       : [ PASS / FAIL ]
  V2 SMOKE-002 shape correct       : [ PASS / FAIL ]
  V3 UUID consistency              : [ PASS / FAIL ]
  V4 Policy state confirmed        : [ PASS / FAIL ]
  V5 can_access_order body correct : [ PASS / FAIL ]
  V6 app_role populated            : [ PASS / FAIL ]

FORBIDDEN WRITE TESTS
─────────────────────────────────────────────────────────
  Test A — Payment write blocked   : [ PASS / FAIL ]
  Test B — Assignment write blocked: [ PASS / FAIL ]
  Test C — Customer write blocked  : [ PASS / FAIL ]
  RPC happy path                   : [ PASS / FAIL ]

OVERALL RESULT
─────────────────────────────────────────────────────────
  [ ALL PASS — CLEAR FOR JEFFREY REVIEW AND RELEASE SIGN-OFF ]
  [ FAIL — SEE NOTES ABOVE — DO NOT RELEASE ]

Delta Sign-off: ___________________  Date: _______________
════════════════════════════════════════════════════════
```

---

## SECTION 7 — IMPORTANT CONTEXT AND KNOWN STATE

### What is already applied (do NOT reapply)

| Item | Status |
|------|--------|
| `orders-driver-rls-migration.sql` | ✅ Applied 2026-06-10 |
| `update-driver-status-rpc.sql` | ✅ Applied 2026-06-10 |
| `test-tenant-policy-fix.sql` (anon policy cleanup) | ✅ Applied (DELTA-TEST-TENANT-CLEANUP-APPLY.md) |
| Members index `idx_members_user_id` | ✅ Applied 2026-06-11 |

### What is NOT yet done

| Item | Status |
|------|--------|
| SMOKE-001 creation via HQ UI | ⏳ **Awaiting Jefe** |
| SMOKE-002 creation via HQ UI | ⏳ **Awaiting Jefe** |
| Full live authenticated browser smoke test | ⏳ **This document — ready to run** |
| Final R1 release sign-off | ⏳ Pending above tests passing |

### Supabase project constants (safe to document)

```
Supabase project ref : exayifxbqduhsxmmsnxr
Supabase URL         : https://exayifxbqduhsxmmsnxr.supabase.co
Production tenant    : casabe-xpress
Casabe Xpress NY UUID: 9838c5e1-42cd-4b42-b517-0de237e99712
```

### can_access_order() function behavior (from DELTA-PREFLIGHT-RESULTS.md)

This function is the gating mechanism for Driver RLS. It:
1. Finds the calling user's `tenant_id` and `app_role` from `public.members`
2. For drivers: checks `data->>'assignedDriverUserId' = me.user_id::text`
3. For HQ/office: grants access to all orders in the same tenant
4. Returns `false` if `app_role` is NULL → driver sees zero orders
5. Returns `false` if UUID in order does not match calling user → cross-driver blocked

**This is why `app_role` MUST be populated for all smoke accounts.**

### Debug URL

```
https://casabe-connect.netlify.app/?debug=1
```

Do NOT test against `casabekonnect-app.netlify.app` (the old URL linked to local
`.netlify/state.json`). The correct site is `casabe-connect`.

---

*Document prepared by Delta (QA/Debugger) — 2026-06-14*  
*All preflight items verified against existing reports in ~/casabe-v3/smoke-setup/*  
*Five verification points covered: HQ visibility, Office visibility, Driver A own-orders,*  
*Driver B zero rows (DB-level RLS), cross-tenant zero rows.*  
*Ready to execute the moment SMOKE-001 and SMOKE-002 are created through the HQ UI.*
