# Delta QA Review — test-tenant-policy-fix.sql
**Reviewer:** Delta (QA/Debugger, Casabe Konnect)  
**File reviewed:** `~/casabe-v3/smoke-setup/test-tenant-policy-fix.sql`  
**Date:** 2026-06-10  
**Status:** ✅ APPROVED FOR JEFE SIGN-OFF

---

## Checklist Results

| # | Check | Result | Line(s) |
|---|-------|--------|---------|
| 1 | Migration wrapped in `BEGIN; ... COMMIT;` | ✅ PASS | Lines 1 & 11 |
| 2 | `DROP POLICY IF EXISTS test_tenant_anon_read` inside transaction | ✅ PASS | Line 4 |
| 3 | `CREATE POLICY` specifies `TO anon` (not `TO public`, not unscoped) | ✅ PASS | Line 8 |
| 4 | `USING (tenant_id = 'test-tenant')` — scoped to test-tenant only | ✅ PASS | Line 9 |
| 5 | No other policies touched — single targeted fix | ✅ PASS | Full file |
| 6 | POST-COMMIT VERIFY query present (expects 1 row, `roles = {anon}`) | ✅ PASS | Lines 14–17 |
| 7 | Rollback block present (commented transaction) | ✅ PASS | Lines 19–24 |

---

## Checklist Detail

### ✅ 1. Transaction Wrapper
```sql
BEGIN;   -- Line 1
COMMIT;  -- Line 11
```
All DDL is inside the transaction. Atomic: either both DROP and CREATE succeed, or neither takes effect.

### ✅ 2. DROP POLICY IF EXISTS (inside transaction)
```sql
DROP POLICY IF EXISTS test_tenant_anon_read ON public.orders;  -- Line 4
```
`IF EXISTS` prevents failure if the policy somehow doesn't exist. Correctly placed between `BEGIN` and `COMMIT`.

### ✅ 3. CREATE POLICY with `TO anon`
```sql
CREATE POLICY test_tenant_anon_read ON public.orders
  FOR SELECT
  TO anon                            -- Line 8: correct role target
  USING (tenant_id = 'test-tenant');
```
Role is explicitly `anon`. Not `TO public` (the pre-existing bug). Not unscoped (which would default to all roles). This is the exact fix required.

### ✅ 4. USING clause scoped to `test-tenant` only
```sql
USING (tenant_id = 'test-tenant')   -- Line 9
```
Filter is tight: only rows where `tenant_id = 'test-tenant'` are exposed. Production tenant `casabe-xpress` rows are completely unaffected.

### ✅ 5. No other policies touched
The entire file contains exactly one DROP and one CREATE, both targeting only `test_tenant_anon_read` on `public.orders`. No other tables, policies, roles, or grants appear anywhere in the file.

### ✅ 6. POST-COMMIT VERIFY query
```sql
-- POST-COMMIT VERIFY:
SELECT policyname, roles, cmd
FROM pg_policies
WHERE tablename = 'orders' AND policyname = 'test_tenant_anon_read';
-- Expected: 1 row, roles = {anon}
```
Verification query is present. Expected result is correctly documented. Operator should confirm `roles = {anon}` after running.

### ✅ 7. Rollback block present
```sql
-- ROLLBACK (if needed):
-- BEGIN;
-- DROP POLICY IF EXISTS test_tenant_anon_read ON public.orders;
-- CREATE POLICY test_tenant_anon_read ON public.orders FOR SELECT USING (tenant_id = 'test-tenant');
-- COMMIT;
```
Rollback is properly commented out (won't fire accidentally). Note: the rollback re-creates the policy **without `TO anon`** — this is intentional, restoring the original (unscoped) behavior if needed. No issue here for a rollback scenario.

---

## Impact Assessment: ✅ SAFE

| Party | Before Fix | After Fix |
|-------|-----------|-----------|
| `anon` role (unauthenticated/public API callers) | Could read test-tenant orders | Can read test-tenant orders ✅ (intended) |
| Any authenticated user (via `public` role) | Could read test-tenant orders ⚠️ | **Cannot read test-tenant orders** (policy no longer applies to them) |
| `casabe-xpress` tenant rows | Unaffected (different `tenant_id`) | Unaffected ✅ |
| Smoke accounts (HQ/Office/Driver A/Driver B) | Could read test-tenant orders via `public` role bug | No longer can — **acceptable** (smoke accounts belong to `casabe-xpress`, not `test-tenant`) |

**Net effect:** Closes an unintended privilege elevation. Authenticated users should never have been reading `test-tenant` order data. The fix restores the correct posture.

---

## Regression Risk: ✅ NONE FOUND

**Search performed:** Full review of `~/casabe-v3/index.html` for any code path that:
- Queries orders with `tenant_id = 'test-tenant'`
- Relies on an authenticated session reading test-tenant data
- Uses `test-tenant` as a data source for smoke/preview features

**Finding:** No evidence found in `index.html` that any authenticated app flow intentionally reads `test-tenant` orders. The app queries orders using the authenticated user's tenant context (`casabe-xpress`), not the test tenant. No feature flag, preview mode, or debug screen was found that switches tenant_id to `test-tenant` for authenticated sessions.

All Supabase queries in the app use `_supabase` (initialized with the `anon` key) and rely on RLS + session-based auth. The test-tenant data is not consumed by any production UI flow visible in the codebase.

---

## Summary

The migration is minimal, correct, and safe. It fixes exactly what it says it fixes — nothing more, nothing less. The transaction wrapper, DROP/CREATE sequence, `TO anon` targeting, and `tenant_id` scope are all correct. Post-commit verification and rollback are present. No regression surface found in the app code.

**VERDICT: ✅ APPROVED FOR JEFE SIGN-OFF**

---
*Delta — QA/Debugger subagent | Casabe Konnect*
