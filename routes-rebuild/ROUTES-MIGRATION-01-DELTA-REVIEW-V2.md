# Delta Review — Migration 01 v2
## `01-routes-schema-v2.sql`
**Reviewer:** Delta (QA)  
**Date:** 2026-06-14  
**Reviewed against:** `01-routes-schema-v2.sql` (Forge draft, same date)  
**Status: ✅ APPROVED — Ready for Jeffrey sign-off before apply**

---

## Executive Summary

All five requested fixes are correctly applied. No regressions against v1 intent. Four items noted for Jeffrey's awareness (none are blockers). Migration is structurally sound and safe to apply once Jeffrey approves.

---

## Fix-by-Fix Verification

### Fix 1 — `get_user_office_id()` → `get_user_office_ids()` ✅

**Checked:** Every occurrence of the function name in v2.

| Location | v1 | v2 | Correct? |
|---|---|---|---|
| `routes: office scoped by office_id` USING | `= get_user_office_id()` | `= ANY(get_user_office_ids())` | ✅ |
| `routes: office scoped by office_id` WITH CHECK | `= get_user_office_id()` | `= ANY(get_user_office_ids())` | ✅ |
| `route_stops: office scoped via route` USING | `= get_user_office_id()` | `= ANY(get_user_office_ids())` | ✅ |
| `route_stops: office scoped via route` WITH CHECK | `= get_user_office_id()` | `= ANY(get_user_office_ids())` | ✅ |

**Correctness:** `get_user_office_ids()` returns `UUID[]`. The operator `= ANY(UUID[])` is the correct Postgres idiom for "value is in array." The column `routes.office_id` is `UUID`. The expression `office_id = ANY(get_user_office_ids())` is type-safe with no cast required.

**Delta verdict:** ✅ Fix applied correctly in all four RLS clauses. No residual singular references found.

---

### Fix 2 — `routes.driver_user_id` column added ✅

**Checked:** Column definition, comment, index, and policy usage.

| Item | Status |
|---|---|
| Column present: `driver_user_id UUID REFERENCES auth.users(id) DEFERRABLE INITIALLY DEFERRED` | ✅ |
| Nullable (no `NOT NULL`) | ✅ |
| Column comment explains nullable + relationship to route_stops.driver_user_id | ✅ |
| `idx_routes_driver_user_id` index added | ✅ |
| Driver route SELECT policy uses `driver_user_id = auth.uid()` as fast path | ✅ |
| Existing route_stops join path retained as fallback (OR clause) | ✅ |
| POST-COMMIT verify item 7 confirms column metadata | ✅ |

**Delta notes:**
- Nullable is correct — a route may be created by HQ before driver assignment. ✅
- The dual-path driver policy (`driver_user_id = auth.uid() OR EXISTS (route_stops join)`) handles both "route-level assignment" and "stop-level assignment" correctly. Multi-driver routes where `driver_user_id` is NULL but individual stops are assigned remain visible. ✅
- DEFERRABLE INITIALLY DEFERRED on the FK is consistent with `created_by` FK pattern already in this migration. ✅

**Delta verdict:** ✅ Fix applied correctly.

---

### Fix 3 — Lifecycle status CHECK constraint expanded ✅

**Checked:** CHECK constraint definition, column comment, POST-COMMIT verify items.

| Item | v1 | v2 | Status |
|---|---|---|---|
| CHECK values | `draft, optimized, dispatched, completed` | `draft, optimized, dispatched, in_progress, completed, cancelled` | ✅ |
| Column comment updated | mentioned "dispatched \| completed" | documents full transition path including `in_progress` and `cancelled` | ✅ |
| POST-COMMIT test 6 updated | tested `invalid_status` only | tests `invalid_status`, `in_progress`, and `cancelled` | ✅ |
| Acceptance Test 13 added | absent | confirms `in_progress` and `cancelled` INSERT/UPDATE succeed | ✅ |

**Delta verdict:** ✅ Fix applied correctly. Approved status set: `draft | optimized | dispatched | in_progress | completed | cancelled`.

---

### Fix 4 — Tape Direct warehouse contract hardened ✅

**Checked:** DEFAULT value, column comment, trigger function, trigger registration, rollback section.

| Item | v1 | v2 | Status |
|---|---|---|---|
| `start_address NOT NULL DEFAULT '3801 White Plains Rd, Bronx, NY 10467'` | ✅ present | ✅ preserved | ✅ |
| Column comment with authoritative warehouse note | generic note | full contract language as specified | ✅ |
| `check_no_tape_direct_stop()` trigger function | absent | present | ✅ |
| `trg_route_stops_no_tape_direct` trigger (BEFORE INSERT OR UPDATE) | absent | present | ✅ |
| Trigger COMMENT documented | — | ✅ | ✅ |
| POST-COMMIT verify item 8 tests trigger | absent | present | ✅ |
| Rollback drops trigger + function | absent | ✅ | ✅ |
| Acceptance Test 12 | absent | present (gated on Migration 02) | ✅ |

**Delta notes — trigger design:**
- The trigger correctly pulls `delivery_address` from `orders` via the composite key `(order_id, tenant_id)`. ✅
- The trigger uses `lower(trim(...))` comparison — normalizes whitespace and case, avoids false negatives from cosmetic differences. ✅
- The trigger is explicitly documented as contingent on Migration 02 adding `delivery_address` to `orders`. When `delivery_address` is NULL (pre-Migration-02), the trigger silently passes — this is the correct behavior since the guard can only fire against a known column. ✅
- Primary enforcement is application-layer; this is correctly labeled as belt-and-suspenders. ✅

**Delta verdict:** ✅ Fix applied correctly. Contract is clear, trigger is sound, contingency on Migration 02 is documented.

---

### Fix 5 — Route stop driver RLS rebased against live orders policies ✅

**Checked:** `route_stops: driver select own` policy, acceptance test commentary, type analysis.

| Item | v1 | v2 | Status |
|---|---|---|---|
| Policy USING clause | `can_access_order(order_id)` | `can_access_order(order_id)` | ✅ |
| `order_id` type | `TEXT` | `TEXT` (explicitly documented) | ✅ |
| `orders.id` type | undocumented | explicitly noted as `TEXT` in comments | ✅ |
| Cast required? | not addressed | explicitly confirmed: no cast needed | ✅ |
| Acceptance tests | referenced "can_access_order" generically | rebased against live 5-policy structure, Driver A verified | ✅ |
| Live RLS context block added | absent | present at top of acceptance test section | ✅ |
| Test 4 confirms TEXT→TEXT pass | absent | present | ✅ |
| Test 5 confirms Driver B zero rows | present | updated with live policy context | ✅ |

**Type-safety analysis:**
```
can_access_order(order_id TEXT)   -- function signature
route_stops.order_id TEXT         -- column type
orders.id TEXT                    -- PK type
```
All TEXT. No implicit cast. No risk of index-defeating cast in the RLS predicate. ✅

**Delta verdict:** ✅ Fix applied correctly. `can_access_order(order_id)` is type-safe as-is. Live policy alignment confirmed.

---

## Structural Checks

| Check | Result |
|---|---|
| `BEGIN` / `COMMIT` block wraps all DDL | ✅ |
| `CREATE TABLE IF NOT EXISTS` used | ✅ |
| `DROP TRIGGER IF EXISTS` before each `CREATE TRIGGER` | ✅ |
| `CREATE INDEX IF NOT EXISTS` used | ✅ |
| All new items (trigger, index, column) included in ROLLBACK block | ✅ |
| POST-COMMIT VERIFY block covers all v2 additions | ✅ |
| No `DROP FUNCTION IF EXISTS set_updated_at()` in rollback (correctly shared) | ✅ |
| `check_no_tape_direct_stop()` in rollback (correctly isolated to this migration) | ✅ |
| Acceptance test count increased from 9 → 13 | ✅ |

---

## Items for Jeffrey's Awareness (Non-Blockers)

### 1. Tape Direct trigger is dormant until Migration 02
The `trg_route_stops_no_tape_direct` trigger reads `orders.delivery_address`. That column doesn't exist until Migration 02 (`02-orders-delivery-address.sql`) is applied. Until then the trigger silently passes on all inserts. This is documented in the trigger function body and in POST-COMMIT verify item 8. **No action needed — behavior is intentional and documented.**

### 2. `routes.driver_user_id` vs `route_stops.driver_user_id` — which is authoritative?
The migration documents that `route_stops.driver_user_id` is the per-stop authority and `routes.driver_user_id` is a convenience column. There is no sync trigger between them. Application layer must maintain consistency. Delta recommends a comment or future migration add an explicit note about the sync strategy (e.g., "set routes.driver_user_id = primary driver on dispatch"). **Low priority — document in Slice 1 prep or a follow-up ADR.**

### 3. `route_stops: driver select own` uses `can_access_order()` — not `driver_user_id`
This is the intentional live policy alignment, but it means a driver can see a route stop via `can_access_order()` even if `route_stops.driver_user_id` is NULL or assigned to a different driver. The orders-level permission is the gate. If Jeffrey wants tighter stop-level access, a future revision could AND with `driver_user_id = auth.uid()`. **For Jeffrey to decide — current behavior is correct per the live policy structure.**

### 4. Status transition enforcement is not in the DB
The CHECK constraint validates allowed values but does not enforce allowed transitions (e.g., `completed → draft` would not be rejected). Transition enforcement is application-layer. This is consistent with v1 intent and is acceptable for this stage. **Document in Slice 1 or a future ADR if stricter enforcement is desired.**

---

## Delta Sign-Off

| | |
|---|---|
| **Fix 1** (function name + ANY) | ✅ Approved |
| **Fix 2** (driver_user_id column) | ✅ Approved |
| **Fix 3** (status lifecycle) | ✅ Approved |
| **Fix 4** (Tape Direct contract) | ✅ Approved |
| **Fix 5** (RLS/tests rebased) | ✅ Approved |
| **Structural integrity** | ✅ Approved |
| **Rollback completeness** | ✅ Approved |
| **Regression risk** | Low — all changes are additive (new column, new trigger, new index, expanded CHECK, updated policies) |

**Delta verdict: ✅ APPROVED. Migration 01 v2 is ready for Jeffrey Gonzalez's approval to apply.**

No blockers. The four awareness items above are noted for design continuity but do not require changes before apply.

---

*Delta — QA Lead, Casabe Konnect Route Optimizer*  
*Review completed: 2026-06-14*
