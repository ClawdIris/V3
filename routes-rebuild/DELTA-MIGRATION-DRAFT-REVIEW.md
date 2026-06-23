# DELTA — Migration Draft Review
**Project:** Casabe Konnect R4 — Routes Rebuild  
**Reviewer:** Delta (QA/Debugger)  
**Date:** 2026-06-10  
**Scope:** Files reviewed only — nothing applied to Supabase  
**Files reviewed:**
- `migrations/01-routes-schema.sql`
- `migrations/02-orders-delivery-address.sql`
- `migrations/03-members-index.sql`

---

## Migration 01 — Routes Schema

### Structure

| Check | Result | Notes |
|-------|--------|-------|
| `routes` table: all required columns present (id, tenant_id, office_id, start_address NOT NULL, status, optimized_at, dispatched_at, waypoint_order JSONB, created_by, created_at, updated_at, is_active) | ✅ PASS | All columns present with correct types. Lines 26–57. |
| `status` CHECK constraint limiting to: draft \| optimized \| dispatched \| completed | ✅ PASS | `CONSTRAINT routes_status_check` at line 57–60. All four values present. |
| `office_id` FK → `public.offices(id)` present | ✅ PASS | Line 30: `REFERENCES public.offices(id)` |
| `created_by` FK → `auth.users(id)` DEFERRABLE INITIALLY DEFERRED | ✅ PASS | Line 47: `REFERENCES auth.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `route_stops` table: all required columns present (id, route_id, order_id, tenant_id, stop_sequence, driver_user_id, status, timestamps) | ✅ PASS | All required columns present. Lines 74–103. |
| Composite FK: `(order_id, tenant_id) REFERENCES public.orders(id, tenant_id)` | ✅ PASS | Lines 81–83: `FOREIGN KEY (order_id, tenant_id) REFERENCES public.orders(id, tenant_id)` |
| `driver_user_id` FK → `auth.users(id)` DEFERRABLE INITIALLY DEFERRED | ✅ PASS | Line 87: `REFERENCES auth.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `stop_sequence` is INT NOT NULL | ✅ PASS | Line 85: `stop_sequence INT NOT NULL` |
| `status` on route_stops CHECK constraint: pending \| delivered \| no_answer \| address_issue \| skipped | ✅ PASS | Lines 91–93: all five values present. |
| No hard deletes: `is_active BOOLEAN NOT NULL DEFAULT TRUE` on routes | ✅ PASS | Line 54: `is_active BOOLEAN NOT NULL DEFAULT TRUE` |

**Structure verdict: ALL PASS ✅**

---

### RLS

| Check | Result | Notes |
|-------|--------|-------|
| RLS enabled on BOTH `routes` and `route_stops` | ✅ PASS | Lines 142–143: `ENABLE ROW LEVEL SECURITY` on both tables. |
| Anon blocked on both | ✅ PASS | Lines 146–155: `USING (false)` on anon for both tables. |
| HQ: full access (SELECT/INSERT/UPDATE/DELETE) on routes — scoped by `is_member(tenant_id)` | ⚠️ WARNING | HQ policy uses `auth.jwt() ->> 'role' IN ('hq', 'owner')` but does NOT call `is_member(tenant_id)`. The checklist specifies `is_member()` scoping. JWT role check alone may allow HQ to access routes for tenants they don't belong to. Line 158–170. See note below. |
| Office: scoped by `is_member(tenant_id) AND get_user_office_id() = office_id` on routes — own office only | ⚠️ WARNING | Office policy uses `auth.jwt() ->> 'office_id'` cast instead of `get_user_office_id()` helper. `is_member(tenant_id)` also absent. Functionally similar if JWT is well-formed, but deviates from the platform's established helper convention. Lines 178–186. See note below. |
| Driver: SELECT only on `route_stops` via `can_access_order(order_id)` — NOT on `routes` table directly | ⚠️ WARNING | Driver gets SELECT on `routes` via a separate policy ("routes: driver select assigned", lines 218–226) — which is reasonable so drivers can see their route envelope. However, the driver `route_stops` SELECT policy (lines 228–233) uses `driver_user_id = auth.uid()` rather than `can_access_order(order_id)`. The checklist asks for `can_access_order` as the gate. Deviation may be intentional (tighter: only rows driver is directly assigned to) but differs from spec. |
| No `USING (true)` anywhere | ✅ PASS | Searched full file — no `USING (true)` present. |
| Policy count matches reported 8 policies across both tables | ✅ PASS | Counting from file: routes has 5 (anon, hq, office, driver-select, driver-update-stops). Wait — driver-update is on `route_stops`. Let me recount: **routes** = 4 policies (anon, hq, office, driver-select-assigned). **route_stops** = 5 policies (anon, hq, office-via-route, driver-select-own, driver-update-own). **Total: 9 policies.** Forge reported 8. **One extra policy exists.** See note below. |
| Office INSERT/UPDATE on routes: also validates office_id matches caller's office | ✅ PASS | `WITH CHECK` on office policy enforces `office_id = (auth.jwt() ->> 'office_id')::UUID` — both USING and WITH CHECK are present. Lines 184–186. |

#### ⚠️ WARNING 01-RLS-A — `is_member()` helper absent from HQ and Office policies

The platform conventions (as referenced in the checklist) call for `is_member(tenant_id)` to scope both HQ and Office access. The current policies use raw JWT role checks only:
- **HQ**: can access routes for ANY tenant where their JWT role is `hq` or `owner`. If a user has one of these roles but belongs to only one tenant, this is an over-broad grant.
- **Office**: uses `auth.jwt() ->> 'office_id'` rather than `get_user_office_id()`. This works only if office_id is always embedded in the JWT. If it's ever read from the DB (via the helper), these will diverge.

**Forge should confirm:** Are these intentional deviations from the platform helper pattern, or oversights? If the platform's existing policies use `is_member()` / `get_user_office_id()`, these should match for consistency and to prevent cross-tenant access bugs.

**Severity: WARNING (not BLOCK)** — policies are internally consistent and functional, but deviate from the stated platform convention. Recommend Forge documents the rationale or aligns to helpers.

#### ❌ BLOCK 01-RLS-B — Policy count mismatch: file has 9, Forge reported 8

Actual count from file:
- `routes`: "routes: anon blocked", "routes: hq full access", "routes: office scoped by office_id", "routes: driver select assigned" = **4 policies**
- `route_stops`: "route_stops: anon blocked", "route_stops: hq full access", "route_stops: office scoped via route", "route_stops: driver select own", "route_stops: driver update own status" = **5 policies**
- **Total: 9**

The POST-COMMIT VERIFY block at the bottom says `EXPECTED: 8 policies total (4 per table: anon blocked, hq, office, driver)`. This is wrong — there are 5 on `route_stops` due to the driver UPDATE policy being separate from the driver SELECT policy. The verify comment will mislead anyone running it.

**Action required:** Forge must update the POST-COMMIT VERIFY expected count to 9, OR consolidate the driver SELECT + UPDATE on route_stops into one policy if that's valid. Do not leave misleading verification instructions.

---

### Indexes

| Check | Result | Notes |
|-------|--------|-------|
| `idx_routes_tenant_id` present | ✅ PASS | Line 130 |
| `idx_routes_office_id` present | ✅ PASS | Line 133 |
| `idx_route_stops_route_id` present | ✅ PASS | Line 140 |
| `idx_route_stops_driver_user_id` present | ✅ PASS | Line 143 |
| Additional indexes: correct and not redundant | ✅ PASS | `idx_routes_tenant_status` (composite + partial on `is_active=TRUE`) — useful for "active routes by tenant" queries. `idx_route_stops_driver_status` (composite driver+status) — useful for "all stops for a driver by status". Neither redundant with single-column indexes. |

**Indexes verdict: ALL PASS ✅**

---

### Safety

| Check | Result | Notes |
|-------|--------|-------|
| Wrapped in `BEGIN; ... COMMIT;` | ✅ PASS | Lines 13 and 237. |
| POST-COMMIT VERIFY block present with pg_policies, information_schema.columns, COUNT checks | ✅ PASS | Present. Includes table check, RLS check, policy count, indexes, trigger check, and constraint smoke test. Lines 242–279. |
| Commented rollback block (BEGIN/COMMIT form) | ✅ PASS | Lines 284–298. Drops both tables and triggers. Note about shared function is appropriate. |
| `updated_at` trigger: fires on UPDATE, sets `updated_at = NOW()` on both tables | ✅ PASS | `trg_routes_updated_at` and `trg_route_stops_updated_at` both `BEFORE UPDATE FOR EACH ROW`. Lines 118–126. |

**Safety verdict: PASS with one BLOCK (verify comment count must be corrected) ✅/❌**

---

### Cross-checks against platform decisions

| Check | Result | Notes |
|-------|--------|-------|
| `start_address TEXT NOT NULL` — Tape Direct is fixed start, not nullable | ✅ PASS | Line 33: `start_address TEXT NOT NULL` |
| `waypoint_order JSONB` — Google Routes API response stored here | ✅ PASS | Line 42: `waypoint_order JSONB`. Column comment documents expected shape. |
| Driver has NO route-level INSERT/UPDATE/DELETE — status updates via RPC only | ⚠️ WARNING | Driver has no INSERT/UPDATE/DELETE on `routes` ✅. However, driver DOES have an UPDATE policy on `route_stops` directly ("route_stops: driver update own status", lines 235–245). The checklist says status updates go through `update_driver_status` RPC only. This row-level UPDATE policy is explicitly called out as a "narrow RPC is preferred, but row-level gate" in the comment — so Forge is aware of the tension. Recommend clarifying in spec: is direct row UPDATE allowed as fallback, or should it be removed entirely to force RPC-only path? |

---

### Migration 01 — Issue Summary

| ID | Severity | Description |
|----|----------|-------------|
| 01-RLS-A | ⚠️ WARNING | HQ/Office policies missing `is_member()`/`get_user_office_id()` helpers — deviates from platform convention |
| 01-RLS-B | ❌ BLOCK | POST-COMMIT VERIFY says "EXPECTED: 8 policies" but file has 9 — misleading verification |
| 01-RLS-C | ⚠️ WARNING | Driver `route_stops` SELECT uses `driver_user_id = auth.uid()` instead of `can_access_order()` — spec deviation, may be intentional |
| 01-RLS-D | ⚠️ WARNING | Driver UPDATE on `route_stops` exists at row level — conflicts with "RPC-only" platform decision; comment acknowledges tension but decision not finalized |

**Migration 01 Verdict: NEEDS REVISION**
> One BLOCK (01-RLS-B: verify comment count is wrong) must be fixed before sign-off. Three warnings are non-blocking but should be explicitly acknowledged/resolved by Forge and Jeffrey.

---

## Migration 02 — delivery_address Column

| Check | Result | Notes |
|-------|--------|-------|
| `ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_address TEXT` | ✅ PASS | Lines 22–23. Correct syntax. |
| `IF NOT EXISTS` guard present | ✅ PASS | Present — safe to re-run. |
| Wrapped in `BEGIN; ... COMMIT;` | ✅ PASS | Lines 20 and 36. |
| POST-COMMIT VERIFY: `information_schema.columns` confirms column | ✅ PASS | Present. Includes type check (`text`), nullability check (`YES`), column comment check, and read/write smoke test. Lines 43–60. |
| Rollback: `ALTER TABLE public.orders DROP COLUMN IF EXISTS delivery_address` | ✅ PASS | Present at lines 65–67. Includes appropriate data-loss warning. |
| No data type mismatch (TEXT) | ✅ PASS | TEXT is appropriate for address storage. Matches `start_address TEXT` in routes table. |
| Backfill note present | ✅ PASS | Lines 28–35 contain a thorough backfill strategy note. Documents that existing orders won't have column populated, suggests candidate columns to consider, and defers backfill to a separate migration. |

**Migration 02 — Issue Summary**

No issues found.

**Migration 02 Verdict: APPROVED ✅**

---

## Migration 03 — Members Indexes

| Check | Result | Notes |
|-------|--------|-------|
| `CREATE INDEX IF NOT EXISTS idx_members_user_id ON public.members(user_id)` | ✅ PASS | Line 17. Correct. |
| `CREATE INDEX IF NOT EXISTS idx_members_tenant_user ON public.members(tenant_id, user_id)` | ✅ PASS | Lines 22–23. Composite ordering is correct (tenant_id first for tenant-scoped queries). |
| `IF NOT EXISTS` guards on both | ✅ PASS | Both present. |
| Note about `CREATE INDEX CONCURRENTLY` incompatibility with transactions | ✅ PASS | Lines 10–15: explicitly calls out the incompatibility and advises applying during low-traffic window or using CONCURRENTLY outside a transaction. |
| POST-COMMIT VERIFY present | ✅ PASS | Present. Includes existence check, `indisvalid` check, and EXPLAIN plan guidance. Lines 29–51. |
| No functional change to RLS or data | ✅ PASS | Index-only migration. No DDL changes to columns, constraints, or policies. |
| No transaction wrapper (intentional for CONCURRENTLY compatibility) | ✅ PASS | No BEGIN/COMMIT — correctly explains this is intentional in the header comment. Rollback block shows how to wrap if using non-concurrent form. |

**Additional observation:** The two indexes are not redundant with each other. `idx_members_user_id` covers single-column `WHERE user_id = ?` lookups. `idx_members_tenant_user` covers the composite `WHERE tenant_id = ? AND user_id = ?` pattern. The composite cannot substitute for the single-column case efficiently when no tenant_id is provided; both are warranted.

**Migration 03 — Issue Summary**

No issues found.

**Migration 03 Verdict: APPROVED ✅**

---

## Overall Verdict

| Migration | Verdict |
|-----------|---------|
| 01 — Routes Schema | ❌ NEEDS REVISION |
| 02 — delivery_address | ✅ APPROVED |
| 03 — Members Indexes | ✅ APPROVED |

**Overall: BLOCKED — Migration 01 must be revised before Jeffrey sign-off.**

---

## Action Items for Forge

### MUST FIX (BLOCK)
1. **[01-RLS-B]** Update the POST-COMMIT VERIFY comment in `01-routes-schema.sql` — change `EXPECTED: 8 policies total (4 per table)` to `EXPECTED: 9 policies total (4 on routes, 5 on route_stops)`. The file actually creates 9 policies.

### SHOULD RESOLVE (WARNING — requires explicit decision before Jeffrey sign-off)
2. **[01-RLS-A]** Confirm whether HQ and Office policies should use `is_member(tenant_id)` and `get_user_office_id()` helpers per platform convention, or document why JWT-direct approach is intentionally different for routes.
3. **[01-RLS-C]** Confirm whether `driver_user_id = auth.uid()` is the preferred gate for driver stop access, or if `can_access_order(order_id)` should be used as specified. Annotate the chosen approach.
4. **[01-RLS-D]** Decide: is the direct `route_stops` UPDATE policy for drivers a permitted fallback, or should it be removed to strictly enforce RPC-only status updates? Update comment to reflect the final decision.

### NO ACTION NEEDED
- Migrations 02 and 03 are clean — ready for Jeffrey sign-off independently if 01 is held.

---

*Review complete. Files only — nothing applied to Supabase.*  
*Delta out.*
