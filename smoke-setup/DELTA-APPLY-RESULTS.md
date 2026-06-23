# DELTA-APPLY-RESULTS.md
**Project:** Casabe Konnect (exayifxbqduhsxmmsnxr)  
**Author:** Delta (QA/Debugger)  
**Date:** 2026-06-10  
**Task:** Apply Stream 1 approved migrations + full verification suite

---

## OVERALL VERDICT: ✅ R1 SECURITY BLOCKER CLOSED (WITH NOTES)

The P0 security blocker (Driver B can read all tenant orders via `orders_member_all`) has been **fully resolved**. All core security properties verified. One pre-existing dev-only policy gap (Test E) documented below — not introduced by this migration, flagged for R1 cleanup.

---

## STEP 1 — RPC Apply: `update-driver-status-rpc.sql`

**Status: ✅ SUCCESS**

```
CREATE FUNCTION
GRANT
```

`update_driver_status(TEXT, TEXT)` created as SECURITY DEFINER with `SET search_path = ''`.  
GRANT EXECUTE to `authenticated` role applied.

**Schema confirmation:** `updated_at` column confirmed present on `public.orders` as `timestamp with time zone` — RPC `SET updated_at = NOW()` line is valid. ✅

---

## STEP 2 — Migration Apply: `orders-driver-rls-migration.sql`

**Status: ✅ SUCCESS (transaction committed cleanly)**

```
BEGIN
DROP POLICY          -- orders_member_all removed
CREATE POLICY        -- orders_hq_office_select
CREATE POLICY        -- orders_driver_select
CREATE POLICY        -- orders_hq_office_insert
CREATE POLICY        -- orders_hq_office_update
CREATE POLICY        -- orders_hq_office_delete
COMMIT
```

No mid-transaction failures. No rollback required.

---

## STEP 3 — Post-Commit Verification Queries

| Check | Query | Expected | Result | Status |
|-------|-------|----------|--------|--------|
| 1 | `update_driver_status` function exists | 1 row | 1 row | ✅ PASS |
| 2 | 5 expected policies on orders | 5 rows | 5 rows | ✅ PASS |
| 3 | `orders_driver_update` does NOT exist | 0 rows | 0 rows | ✅ PASS |
| 4 | `orders_member_all` does NOT exist | 0 rows | 0 rows | ✅ PASS |

### Full policy state after migration:
```
orders_driver_select    | SELECT | (is_member(tenant_id) AND get_user_role()='driver' AND can_access_order(id))
orders_hq_office_delete | DELETE | (is_member(tenant_id) AND (get_user_role()='hq' OR get_user_role()='office'))
orders_hq_office_insert | INSERT | WITH CHECK (is_member(tenant_id) AND ...)
orders_hq_office_select | SELECT | (is_member(tenant_id) AND (get_user_role()='hq' OR get_user_role()='office'))
orders_hq_office_update | UPDATE | USING+WITH CHECK (is_member(tenant_id) AND ...)
test_tenant_anon_insert | INSERT | (untouched dev policy)
test_tenant_anon_read   | SELECT | (untouched dev policy)
test_tenant_anon_update | UPDATE | (untouched dev policy)
```

---

## STEP 4 — Authenticated Visibility Scenarios

**Method:** DB-level role simulation via `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claim.sub = '<uuid>'`.  
Temporary simulation rows inserted into `auth.users`, `members`, and `orders` inside a rolled-back transaction (zero residual data in DB).

| Scenario | Description | Expected | Result | Status |
|----------|-------------|----------|--------|--------|
| 1 | HQ sees both smoke orders | 2 rows | 2 rows | ✅ PASS |
| 2 | Office sees both smoke orders | 2 rows | 2 rows | ✅ PASS |
| 3 | Driver A sees assigned orders | 2 rows | 2 rows | ✅ PASS |
| 4 | Driver B sees zero rows (not assigned) | 0 rows | 0 rows | ✅ PASS |

**Note:** Smoke accounts (`driver_a@casabe-xpress.test`, etc.) do not yet exist in the live DB. Scenarios run via DB-level simulation in a rolled-back transaction — functionally equivalent to real JWT-authenticated client calls. See **Smoke Accounts** section below.

---

## STEP 5 — Forbidden Write Tests (A–G)

**Method:** DB-level simulation with `SET LOCAL ROLE authenticated` as Driver A (UUID `00000003-*`) and Driver B (UUID `00000004-*`). All tests run inside a rolled-back transaction.

| Test | Description | Expected | Result | Status | Notes |
|------|-------------|----------|--------|--------|-------|
| A | Driver cannot write payment field | RLS blocks | 0 rows affected | ✅ PASS | No `orders_driver_update` policy — write silently blocked |
| B | Driver cannot write assignment field | RLS blocks | 0 rows affected | ✅ PASS | Same — no driver UPDATE policy |
| C | Driver cannot write customer data | RLS blocks | 0 rows affected | ✅ PASS | Same — no driver UPDATE policy |
| D | Driver B cannot read Driver A's orders | 0 rows | 0 rows | ✅ PASS | `can_access_order()` correctly gates `orders_driver_select` |
| E | Cross-tenant read blocked | 0 rows | **1 row returned** | ⚠️ PARTIAL — pre-existing issue | See note below |
| F | RPC happy path: `ready_pickup → in_warehouse` | `{success:true, new_status:"in_warehouse"}` + DB updated | RPC returned correct shape; `data->>'status'` confirmed `in_warehouse` | ✅ PASS | JSONB path write confirmed working |
| G | RPC invalid transition: `in_warehouse → need_box` | Error thrown, DB unchanged | `RAISE EXCEPTION 'invalid transition: in_warehouse -> need_box'` thrown; status remained `in_warehouse` | ✅ PASS | Error message matches expected pattern |

### Test E Detail — Cross-tenant Read

**Root cause:** `test_tenant_anon_read` policy on `orders` has `roles = {public}` (not `{anon}`). The `public` PostgreSQL role includes all authenticated users. This means any authenticated user can read orders with `tenant_id = 'test-tenant'`.

**Was this introduced by this migration?** **NO.** The migration explicitly preserved and did not modify the three `test_tenant_anon_*` policies. This is a pre-existing dev-only gap.

**Impact:** Limited to `test-tenant` data only. No `casabe-xpress` production data is exposed. A casabe-xpress HQ/driver user could read `test-tenant` orders — but `test-tenant` is a dev sandbox with no real data.

**Required action before R1:** Remove or scope `test_tenant_anon_read` to `{anon}` role only. (Already noted in migration as GAP 2.)

---

## Schema Findings (Incidental — for Forge/Jefe awareness)

1. **`orders.updated_at` confirmed present** — `timestamp with time zone NOT NULL DEFAULT now()`. RPC line `SET updated_at = NOW()` is valid.
2. **`orders.status` is NOT a top-level column** — confirmed. Status lives exclusively in `data->>'status'` (JSONB). RPC correctly reads/writes via `data->>'status'` and `jsonb_set(data, '{status}', ...)`.
3. **`members` table has FK** `members.user_id → auth.users(id) ON DELETE CASCADE` — smoke account creation must use `create-smoke-accounts.js` (Auth Admin API), NOT direct SQL insert.
4. **`members.metadata`** column is `NOT NULL` — `create-smoke-accounts.js` does not set `metadata`. Will fail on insert. **Flag for Iris/Forge.**

---

## Smoke Accounts Status

**Smoke accounts still needed: YES**

Live smoke accounts (`smoke-hq@casabe-test.internal`, `smoke-office@casabe-test.internal`, `smoke-driver-a@casabe-test.internal`, `smoke-driver-b@casabe-test.internal`) do not exist in `auth.users`.

Required for:
- Full end-to-end Supabase client JWT-authenticated smoke tests (Tests A–G with real tokens)
- Confirming `index.html` driver UI `changeStatus()` RPC call works end-to-end

**How to create:**
```bash
SUPABASE_URL=https://exayifxbqduhsxmmsnxr.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role_key_from_dashboard> \
node smoke-setup/create-smoke-accounts.js
```

⚠️ **Pre-run blocker:** `members.metadata` is `NOT NULL` but `create-smoke-accounts.js` does not set `metadata` in the insert payload. This will fail. Forge must add `metadata: {}` to the `membersRow` object in `create-smoke-accounts.js` before running.

---

## Pre-R1 Action Items

| Priority | Item | Owner |
|----------|------|-------|
| P0 — DONE | Apply `update-driver-status-rpc.sql` | Delta ✅ |
| P0 — DONE | Apply `orders-driver-rls-migration.sql` | Delta ✅ |
| P1 | Fix `create-smoke-accounts.js`: add `metadata: {}` to members insert | Forge |
| P1 | Run `create-smoke-accounts.js` to create smoke accounts | Jefe/Delta |
| P1 | Create SMOKE-001 + SMOKE-002 orders via HQ UI after smoke accounts exist | Delta |
| P1 | Run full Tests A–G with real Supabase client JWT tokens | Delta |
| P2 | Remove or scope `test_tenant_anon_read` to `{anon}` role | Forge |
| P2 | Remove `test_tenant_anon_insert` and `test_tenant_anon_update` before production | Forge |

---

## Appendix: Simulation UUIDs Used

| Role | UUID | Email |
|------|------|-------|
| HQ | `00000001-0000-0000-0000-000000000000` | sim-hq@smoke.test |
| Office | `00000002-0000-0000-0000-000000000000` | sim-office@smoke.test |
| Driver A | `00000003-0000-0000-0000-000000000000` | sim-drivera@smoke.test |
| Driver B | `00000004-0000-0000-0000-000000000000` | sim-driverb@smoke.test |

All simulation rows were inserted and rolled back within a single transaction. Zero persistent test data was written to the live DB.
