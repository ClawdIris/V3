# DELTA Migration 01 — Final Review Report (V3)
**Reviewer:** Delta — QA/Debugger, Casabe Konnect  
**File reviewed:** `migrations/01-routes-schema.sql`  
**Review date:** 2026-06-10  
**Round:** V3 (post Forge fixes including Jeffrey's office route_stops scoping requirement)

---

## Actual Policy Count: **8**

### Policy names (all 8):

| # | Table | Policy Name |
|---|-------|-------------|
| 1 | routes | `routes: anon blocked` |
| 2 | routes | `routes: hq full access` |
| 3 | routes | `routes: office scoped by office_id` |
| 4 | routes | `routes: driver select assigned` |
| 5 | route_stops | `route_stops: anon blocked` |
| 6 | route_stops | `route_stops: hq full access` |
| 7 | route_stops | `route_stops: office scoped via route` |
| 8 | route_stops | `route_stops: driver select own` |

**Breakdown:** routes (4) + route_stops (4) = 8 total  
*(Note: The task brief listed routes(3)/route_stops(5) as the expected breakdown, but that was incorrect. The `routes` table correctly has a driver SELECT policy to allow drivers to read their parent route record. 4/4=8 is correct and internally consistent. The POST-COMMIT VERIFY block in the file correctly reflects 8 total.)*

---

## Section A — Office route_stops policy scoping (Jeffrey's requirement)

✅ **ALL PASS**

| Check | Result | Evidence |
|-------|--------|----------|
| `route_stops_office_scoped` uses `EXISTS (SELECT 1 FROM public.routes r WHERE r.id = route_id AND r.office_id = get_user_office_id())` | ✅ | Lines 218–222, 227–231 |
| Both `USING` AND `WITH CHECK` clauses present with matching EXISTS subquery | ✅ | USING: lines 215–223; WITH CHECK: lines 224–232 |
| No forbidden broad `is_member(tenant_id) AND get_user_role() = 'office'` without EXISTS on route_stops | ✅ | route_stops office policy always gates through EXISTS — never uses bare office check |

**Policy text confirmed (lines 211–232):**
```sql
CREATE POLICY "route_stops: office scoped via route"
    ON public.route_stops
    FOR ALL
    TO authenticated
    USING (
        is_member(tenant_id)
        AND get_user_role() = 'office'
        AND EXISTS (
            SELECT 1 FROM public.routes r
            WHERE r.id = route_id
              AND r.office_id = get_user_office_id()
        )
    )
    WITH CHECK (
        is_member(tenant_id)
        AND get_user_role() = 'office'
        AND EXISTS (
            SELECT 1 FROM public.routes r
            WHERE r.id = route_id
              AND r.office_id = get_user_office_id()
        )
    );
```

---

## Section B — All policies use platform helpers (no raw JWT)

✅ **ALL PASS**

| Check | Result | Evidence |
|-------|--------|----------|
| Zero occurrences of `auth.jwt() ->> 'role'` | ✅ | `grep auth.jwt()` → NONE FOUND |
| All role checks use `get_user_role()` | ✅ | Lines 191, 192, 198, 199, 206, 207, 217, 226, 242, 256 |
| All tenant checks use `is_member(tenant_id)` | ✅ | Lines 191, 198, 206, 216, 225, 241, 255 |
| Office checks use `get_user_office_id()` for office_id scoping | ✅ | Lines 206, 207, 221, 230 |

**Note on `auth.uid()` at line 246:** This appears inside the `routes` table's `driver select assigned` policy, within a correlated EXISTS subquery: `rs.driver_user_id = auth.uid()`. This is **not** a raw JWT role pattern — it is a standard Supabase identity lookup used to determine which routes a driver has stops on. It does **not** appear anywhere in any `route_stops` policy. This usage is correct and acceptable.

---

## Section C — Driver policies

✅ **ALL PASS**

| Check | Result | Evidence |
|-------|--------|----------|
| Driver SELECT on `route_stops` uses `is_member(tenant_id) AND get_user_role() = 'driver' AND can_access_order(order_id)` | ✅ | Lines 250–259 |
| No `driver_user_id = auth.uid()` as direct route_stops gate | ✅ | Only occurrence (line 246) is inside `routes` policy EXISTS subquery — not on route_stops |
| Zero driver INSERT policies on route_stops | ✅ | No such policy exists in file |
| Zero driver UPDATE policies on route_stops | ✅ | No such policy exists in file |
| Zero driver DELETE policies on route_stops | ✅ | No such policy exists in file |
| Comment explaining drivers use `update_driver_status` RPC exclusively | ✅ | Lines 261–263: "Driver status updates are handled exclusively via the update_driver_status RPC (SECURITY DEFINER). The RPC writes to orders.data->>'status' and updates route_stops indirectly. No client-side UPDATE path exists for drivers." |

**Driver route_stops policy confirmed (lines 250–259):**
```sql
CREATE POLICY "route_stops: driver select own"
    ON public.route_stops
    FOR SELECT
    TO authenticated
    USING (
        is_member(tenant_id)
        AND get_user_role() = 'driver'
        AND can_access_order(order_id)
    );
```

---

## Section D — Policy count

✅ **ALL PASS**

| Check | Result | Evidence |
|-------|--------|----------|
| Actual `CREATE POLICY` count | ✅ **8** | `grep -c "CREATE POLICY"` → 8 |
| POST-COMMIT VERIFY block says `EXPECTED: 8 policies` | ✅ | Line 289: `--    EXPECTED: 8 policies total` |
| Actual count matches 8 | ✅ | Confirmed |

**Brief breakdown clarification:** The task brief stated routes(3)/route_stops(5) but the correct split is routes(4)/route_stops(4). The `routes` table has a driver policy (`routes: driver select assigned`) which is necessary and correct — drivers need to read the parent route to display route metadata. The total of 8 is correct in both the file and actual count.

---

## Section E — Acceptance tests (9 required)

✅ **ALL PASS — 9/9 tests present**

| Test | Description | Line | Status |
|------|-------------|------|--------|
| Test 1 | HQ sees all tenant routes | 339 | ✅ |
| Test 2 | Office A sees only Office A routes | 342 | ✅ |
| Test 3 | Office B sees only Office B routes (cannot see Office A) | 346 | ✅ |
| Test 4 | Driver A sees only assigned route_stops (SMOKE-001 + SMOKE-002) | 351 | ✅ |
| Test 5 | Driver B sees zero route_stops | 356 | ✅ |
| Test 6 | Cross-tenant user sees zero rows on both tables | 360 | ✅ |
| Test 7 | Driver cannot INSERT into route_stops | 365 | ✅ |
| Test 8 | Driver cannot UPDATE route_stops directly | 369 | ✅ |
| Test 9 | Office A cannot read Office B route_stops | 373 | ✅ |

---

## Section F — Structure and safety

✅ **ALL PASS**

| Check | Result | Evidence |
|-------|--------|----------|
| RLS enabled on `routes` | ✅ | Line 170: `ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;` |
| RLS enabled on `route_stops` | ✅ | Line 171: `ALTER TABLE public.route_stops ENABLE ROW LEVEL SECURITY;` |
| Anon blocked on both tables | ✅ | Lines 174–183: `routes: anon blocked` and `route_stops: anon blocked` (FOR ALL, USING false) |
| `start_address TEXT NOT NULL` on routes | ✅ | Line 33: `start_address TEXT NOT NULL` |
| Composite FK `(order_id, tenant_id) REFERENCES public.orders(id, tenant_id)` on route_stops | ✅ | Lines 86–88: `FOREIGN KEY (order_id, tenant_id) REFERENCES public.orders(id, tenant_id)` |
| `driver_user_id` FK → `auth.users(id)` DEFERRABLE INITIALLY DEFERRED | ✅ | Line 94: `driver_user_id UUID REFERENCES auth.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `updated_at` trigger on `routes` | ✅ | Lines 129–132: `trg_routes_updated_at` |
| `updated_at` trigger on `route_stops` | ✅ | Lines 134–136: `trg_route_stops_updated_at` |
| Migration wrapped in `BEGIN; ... COMMIT;` | ✅ | Line 19: `BEGIN;` / Line 266: `COMMIT;` |
| POST-COMMIT VERIFY block present (pg_policies, columns, counts) | ✅ | Lines 270–312: queries for tables, RLS, policies, indexes, triggers, constraint |
| Rollback block present (commented transaction form) | ✅ | Lines 316–330: `-- BEGIN; ... -- COMMIT;` with DROP statements |
| `is_active BOOLEAN NOT NULL DEFAULT TRUE` on routes | ✅ | Line 54: `is_active BOOLEAN NOT NULL DEFAULT TRUE` |

---

## Summary

| Section | Result |
|---------|--------|
| A — Office route_stops policy scoping (Jeffrey's requirement) | ✅ ALL PASS |
| B — All policies use platform helpers (no raw JWT) | ✅ ALL PASS |
| C — Driver policies | ✅ ALL PASS |
| D — Policy count | ✅ ALL PASS (8 actual, 8 expected) |
| E — Acceptance tests (9 required) | ✅ ALL PASS (9/9) |
| F — Structure and safety | ✅ ALL PASS |

---

## ✅ FINAL VERDICT: APPROVED FOR JEFFREY SIGN-OFF

All 6 sections pass. All 8 policies are correctly scoped. Jeffrey's office route_stops EXISTS requirement is fully implemented with both USING and WITH CHECK. No raw JWT usage. Driver write isolation is airtight. All 9 acceptance tests are present. Structure is complete and safe.

**This migration is ready for apply after the Google Cloud gate clears.**

---

*Report generated by Delta (QA/Debugger) — V3 final review*
