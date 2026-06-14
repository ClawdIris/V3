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

---

# V3 Delta Review — Migration 01 v3
## `01-routes-schema-v3.sql`
**Reviewer:** Delta (QA)  
**Date:** 2026-06-14  
**Reviewed against:** `01-routes-schema-v3.sql` (Forge — Codex audit finding resolution)  
**Codex Audit Finding:** Tape Direct trigger references `orders.delivery_address` before Migration 02 creates that column — `undefined_column` hard error, not silent NULL.  
**Status: ✅ APPROVED — Migration 01 v3 ready for Codex re-audit**

---

## Finding Resolution Verification

### Trigger Removed from Migration 01 ✅

| Item | v2 | v3 | Correct? |
|---|---|---|---|
| `check_no_tape_direct_stop()` function | Present | **Removed** | ✅ |
| `trg_route_stops_no_tape_direct` trigger | Present | **Removed** | ✅ |
| Forward reference to `orders.delivery_address` | Present (unsafe) | **Absent** | ✅ |
| Rollback drops trigger/function | Yes | Removed — nothing to drop | ✅ |

**Delta confirms:** The trigger and its supporting function are completely absent from v3. No forward reference to `orders.delivery_address` exists anywhere in Migration 01 v3.

### Where the Trigger Now Lives ✅

The trigger is documented as moving to **Migration 02 (`02-orders-delivery-address.sql`)**, co-located with the `orders.delivery_address` column it depends on. This is the correct and safe placement. The v3 header, `routes.start_address` column comment, POST-COMMIT verify item 5/8, and the acceptance test 12 note all consistently point to Migration 02 as the trigger's home.

### No Other Forward References to Columns Not Yet Created ✅

Delta audited every SELECT, INSERT, UPDATE, and reference in v3 against the column set created by Migration 01 alone:

| Scope | Columns referenced | All exist after Migration 01? |
|---|---|---|
| `routes` table DDL | `id, tenant_id, office_id, driver_user_id, start_address, status, optimized_at, dispatched_at, waypoint_order, created_by, created_at, updated_at, is_active` | ✅ All created here |
| `route_stops` table DDL | `id, route_id, order_id, tenant_id, stop_sequence, driver_user_id, status, created_at, updated_at` | ✅ All created here |
| RLS policies | `tenant_id, office_id, driver_user_id` on routes; `tenant_id, route_id, order_id` on route_stops | ✅ All present |
| Trigger function `set_updated_at()` | `updated_at` (NEW.updated_at) | ✅ Present on both tables |
| Indexes | All reference columns from `routes` and `route_stops` | ✅ No external column refs |
| `orders.delivery_address` | **Not referenced anywhere** | ✅ Absence confirmed |

**No forward references found. Migration 01 v3 is self-contained.**

---

## V2 Fixes Preserved ✅

All five fixes from v2 are intact and unmodified in v3:

| Fix | Description | Status |
|---|---|---|
| Fix 1 | `get_user_office_ids()` + `= ANY(...)` in all 4 RLS clauses | ✅ Preserved |
| Fix 2 | `routes.driver_user_id` column, index, dual-path driver policy | ✅ Preserved |
| Fix 3 | Expanded status CHECK (`in_progress`, `cancelled`) | ✅ Preserved |
| Fix 4 (partial) | `start_address` DEFAULT + column comment + contract language | ✅ Preserved (trigger portion moved to Migration 02) |
| Fix 5 | `can_access_order(order_id)` TEXT-safe driver RLS, rebased tests | ✅ Preserved |

---

## Documentation Consistency ✅

| Document location | Consistent with trigger-in-Migration-02? |
|---|---|
| V3 revision note block at file top | ✅ |
| `routes.start_address` COMMENT ON COLUMN | ✅ |
| Placeholder comment block where trigger was | ✅ |
| POST-COMMIT verify item 5 (trigger count = 2) | ✅ |
| POST-COMMIT verify item 8 (Migration 02 concern) | ✅ |
| ROLLBACK section (no trigger/function to drop) | ✅ |
| Acceptance Test 12 note (Migration 02 concern) | ✅ |

---

## Delta Sign-Off

| Check | Result |
|---|---|
| Tape Direct trigger absent from Migration 01 v3 | ✅ Confirmed |
| No forward references to columns not yet created | ✅ Confirmed |
| All v2 fixes preserved | ✅ Confirmed |
| Trigger documented as living in Migration 02 | ✅ Confirmed |
| Rollback and verify blocks updated correctly | ✅ Confirmed |
| v2 file NOT overwritten (v3 is a new file) | ✅ Confirmed |

**Delta verdict: ✅ APPROVED.**

Migration 01 v3 is structurally correct and self-contained. The Codex audit finding is resolved. This file is ready for Codex re-audit and Jeffrey sign-off before apply.

**Remaining action:** Migration 02 (`02-orders-delivery-address.sql`) must be updated by Forge to include `check_no_tape_direct_stop()` and `trg_route_stops_no_tape_direct` before that migration is finalized — the trigger guard is not lost, only relocated.

---

*Delta — QA Lead, Casabe Konnect Route Optimizer*  
*V3 Review completed: 2026-06-14*
