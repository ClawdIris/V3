# DELTA — Migration 01 Review V2
**File:** `migrations/01-routes-schema.sql`
**Reviewer:** Delta (QA/Debugger)
**Date:** 2026-06-10
**Scope:** Post-fix re-review confirming all 4 Forge fixes

---

## Fix 1 — POST-COMMIT VERIFY policy count

**Expected count: 8**

- [ ] ✅ CONFIRMED — POST-COMMIT VERIFY comment (line ~272) lists exactly 8 policies:
  - routes (4): `routes: anon blocked`, `routes: hq full access`, `routes: office scoped by office_id`, `routes: driver select assigned`
  - route_stops (4): `route_stops: anon blocked`, `route_stops: hq full access`, `route_stops: office scoped via route`, `route_stops: driver select own`
- [ ] ✅ CONFIRMED — Actual `CREATE POLICY` statements: **8 total** (lines 174, 180, 187, 194, 202, 209, 218, 232)

**Fix 1: ✅ CONFIRMED**

---

## Fix 2 — RLS platform helpers (no raw `auth.jwt()`)

| Policy | Check | Result |
|---|---|---|
| `routes: hq full access` (line 187) | `is_member(tenant_id) AND get_user_role() = 'hq'` | ✅ CONFIRMED |
| `route_stops: hq full access` (line 194) | `is_member(tenant_id) AND get_user_role() = 'hq'` | ✅ CONFIRMED |
| `routes: office scoped by office_id` (line 202) | `is_member(tenant_id) AND get_user_role() = 'office' AND get_user_office_id() = office_id` | ✅ CONFIRMED |
| `route_stops: office scoped via route` (line 209) | `is_member(tenant_id) AND get_user_role() = 'office'` | ✅ CONFIRMED |
| `auth.jwt()` occurrences in entire file | `grep -n "auth.jwt()"` → **0 matches** | ✅ CONFIRMED |

**Fix 2: ✅ CONFIRMED**

---

## Fix 3 — Driver route_stops SELECT

- [ ] ✅ CONFIRMED — `route_stops: driver select own` (line 232) uses:
  ```sql
  is_member(tenant_id)
  AND get_user_role() = 'driver'
  AND can_access_order(order_id)
  ```
- [ ] ✅ CONFIRMED — No `driver_user_id = auth.uid()` pattern anywhere in `route_stops` policies.

**Note:** `auth.uid()` does appear at line 228 inside the `routes: driver select assigned` policy's EXISTS subquery (`rs.driver_user_id = auth.uid()`). This is in the `routes` table policy — not `route_stops` — and is used as a join key to check route assignment. This is correct and expected behavior for the routes-level driver scope; it is **not** the banned pattern.

**Fix 3: ✅ CONFIRMED**

---

## Fix 4 — Driver UPDATE removed

- [ ] ✅ CONFIRMED — `grep "FOR UPDATE"` → 0 `CREATE POLICY` statements for driver UPDATE on `route_stops`. No such policy exists.
- [ ] ✅ CONFIRMED — Explanatory comment present at lines 241–245:
  > "Drivers do not have a direct UPDATE policy on route_stops. Driver status updates are handled exclusively via the `update_driver_status` RPC (SECURITY DEFINER). The RPC writes to `orders.data->>'status'` and updates route_stops indirectly. No client-side UPDATE path exists for drivers."

**Fix 4: ✅ CONFIRMED**

---

## Carry-Forward Checks

| Check | Detail | Result |
|---|---|---|
| `BEGIN; ... COMMIT;` transaction | Lines 19 and 248 | ✅ |
| RLS enabled on `routes` | `ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY` (line ~170) | ✅ |
| RLS enabled on `route_stops` | `ALTER TABLE public.route_stops ENABLE ROW LEVEL SECURITY` (line ~171) | ✅ |
| `start_address TEXT NOT NULL` on routes | Line 33: `start_address TEXT NOT NULL` | ✅ |
| Composite FK `(order_id, tenant_id) REFERENCES public.orders(id, tenant_id)` | Lines 86–88 | ✅ |
| `updated_at` trigger on `routes` | `trg_routes_updated_at` — line 130 | ✅ |
| `updated_at` trigger on `route_stops` | `trg_route_stops_updated_at` — line 135 | ✅ |
| Rollback block present (commented transaction form) | Lines 301–312 | ✅ |
| Anon blocked on `routes` | `routes: anon blocked` — line 174 | ✅ |
| Anon blocked on `route_stops` | `route_stops: anon blocked` — line 180 | ✅ |

**All carry-forward checks: ✅ PASS**

---

## Final Verdict

> **✅ APPROVED FOR JEFFREY SIGN-OFF**

All 4 fixes correctly implemented. All carry-forward checks pass. Migration 01 is clean, consistent, and ready for production review.

### Summary
- **8 policies** — count matches, names match, no extras, no missing
- **Zero raw `auth.jwt()` calls** — all role/membership checks via platform helpers
- **Driver route_stops SELECT** — correctly uses `can_access_order(order_id)`, no direct UID comparison on route_stops
- **Driver UPDATE removed** — no UPDATE policy on route_stops, RPC-only path documented
- **Schema integrity** — transaction, RLS, composite FK, triggers, rollback block all present and correct
