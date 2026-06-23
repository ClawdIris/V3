# DELTA — Routes Rebuild Plan Re-Review V2
**Reviewer:** Delta (QA/Debugger)  
**Date:** 2026-06-10  
**File reviewed:** `~/casabe-v3/ROUTES-REBUILD-PLAN.md`  
**Basis:** Jeffrey's Final Platform Decisions (Q1–Q4, locked in)  
**Prior review:** `~/casabe-v3/ROUTES-REBUILD-DELTA-REVIEW.md`  
**Status:** V2 re-review — checking resolution of 7 blockers + platform decisions

---

## Section A — Jeffrey's Platform Decisions: Incorporated?

### Q1 — Hard Block on Routes API Failure (no nearest-neighbor fallback)

- [x] **Hard block on Routes API failure; last persisted route unchanged; no fallback**  
  ⚠️ **PARTIAL PASS / RESIDUAL RISK** — The plan's Slice 4 acceptance criteria states:  
  > *"Optimize Route calls optimize-route Edge Function (no nearest-neighbor fallback unless Routes API fails — see Open Question #1)."*  
  
  Section 5 (Graceful Degradation) states:  
  > *"Nearest-neighbor fallback is available only if Jeffrey explicitly approves it (see Open Question #1)."*  
  
  Jeffrey has now explicitly **rejected** the fallback (Q1 decision: hard block + require retry, no nearest-neighbor fallback ever). However, the plan text in both Slice 4 and Section 5 still contains the qualifying phrase *"unless Routes API fails — see Open Question #1"* and *"only if Jeffrey explicitly approves it"* — framing that is now stale.
  
  **The correct behavior is documented implicitly via the graceful degradation table** (error toast shown, route NOT marked assigned, dispatcher can retry). The substance is correct; the Q1 language wording has not been updated to say "hard block, no fallback, never."
  
  ❌ **BLOCK (MINOR):** Slice 4 acceptance criteria and Section 5.5 graceful degradation table must be updated to remove the nearest-neighbor fallback language and explicitly state Jeffrey's decision: "Routes API failure = hard block + retry. No fallback. Last persisted route unchanged."

---

### Q2 — Office RLS Scoped to office_id; HQ Sees All; Drivers Read-Only

- [x] **Drivers read-only on routes**  
  ✅ PASS — Migration 04 `routes_driver_select` policy limits drivers to `driver_user_id = auth.uid() AND optimization_status = 'assigned' AND archived_at IS NULL`. No INSERT, UPDATE, or DELETE policy for drivers. Comment confirms: *"Drivers use update_driver_status RPC for order status changes only."*

- [x] **HQ sees all routes in tenant**  
  ✅ PASS — `routes_hq_select`, `routes_hq_insert`, `routes_hq_update` policies are present and scoped to tenant only.

- [x] **Office scoped to office_id**  
  ❌ **BLOCK** — Jeffrey's Q2 decision is: *"Office builds/optimizes/assigns routes for its own office only (scoped by office_id)."* The current `routes_office_select`, `routes_office_insert`, and `routes_office_update` policies in Migration 04 scope Office to **tenant only** — the same as HQ. There is NO `office_id` filter anywhere in the `routes` RLS policies.  
  
  The `routes` table schema does not include an `office_id` column. There is no mechanism in the current plan to restrict an Office user from seeing or modifying another office's routes within the same tenant.  
  
  **Resolution required:** Add `office_id` to the `routes` table schema. Update the three Office RLS policies to add a filter: `office_id = (SELECT office_id FROM members WHERE user_id = auth.uid() LIMIT 1)`. Update Migration 02 table definition. The HQ policies remain unscoped (HQ sees all). This is a material schema + RLS change.

---

### Q3 — Nav label "Routes & Optimization"; internal key `map_view` preserved

- [x] **Nav label is "Routes & Optimization"**  
  ✅ PASS — Plan document title is "Routes & Optimization Rebuild Plan". Slice 3 files-changed specifies: *"Update nav label: `map_view` → 'Routes & Optimization'"*. Section 1.2 replacement table lists the `Map Preview` label as item to replace. The internal key `map_view` is explicitly preserved (*"key can remain `map_view` for now to avoid breaking `validPages` array"*).

- [x] **Internal key `map_view` preserved**  
  ✅ PASS — Slice 3 explicitly states: *"key can remain `map_view` for now."* This is consistent with Jeffrey's decision.

---

### Q4 — Two separate restricted keys (browser key in index.html; server keys in Edge Function secrets only)

- [x] **Browser key: Maps JS + Places only; HTTP referrer restricted; goes in `index.html`**  
  ✅ PASS — Section 5.1 key inventory identifies `GOOGLE_MAPS_BROWSER_KEY` for Maps JS + Places Autocomplete only. Section 5.2 specifies HTTP referrer restrictions (casabekonnect.com/* variants). Section 2.1 specifies injection via `%%GOOGLE_MAPS_KEY%%` placeholder in `index.html`, server-filled at serve time. Browser key API allowlist explicitly prohibits Geocoding API and Routes API.

- [x] **Server key: Geocoding + Routes only; Edge Function secrets only; never in HTML/JS/logs/responses**  
  ✅ PASS — Section 5.1 identifies `GOOGLE_GEOCODING_KEY` and `GOOGLE_ROUTES_KEY` as Edge Function secrets only. Section 5.3 states: *"Never written to `index.html`, `server.js`, git history, or any client-readable config."* Edge Functions return generic error messages (no key leakage in error bodies).

- [x] **Pre-implementation gate documented**  
  ⚠️ **PARTIAL** — Section 8 Q4 flags this as a blocking prerequisite (*"Forge cannot start Slice 1 without a confirmed, working API key"*). However, with Q4 now answered by Jeffrey, the Open Questions section must be updated to reflect the decision is locked. The gate remains correct as a process step but the *question* framing should become a *checklist item*.  
  This is a documentation tidiness issue, not a blocker.

---

### Tape Direct — Fixed Start Point (not a reorderable stop)

- [x] **Tape Direct as fixed non-reorderable start in route schema**  
  ⚠️ **PARTIAL** — The `routes` table schema uses `start_address` with a default of `3801 White Plains Rd, Bronx, NY 10467` and hardcoded `start_lat`/`start_lng` defaults. This correctly encodes Tape Direct as the route origin.  
  
  However, the plan does **not** explicitly specify that Tape Direct is a **non-reorderable** stop — it is never listed as a stop in the stop pool at all (it's the `start_address` endpoint, not a `route_sequence` stop). The drag-to-reorder UI in Slice 4 describes reordering the stop list but does not explicitly state that `start_address` is excluded from the draggable pool.
  
  **Acceptance criteria gap:** No acceptance criterion in any slice explicitly states: *"Tape Direct start point cannot be reordered or moved to a mid-route position."*
  
  ❌ **BLOCK (MINOR):** Add explicit acceptance criterion to Slice 3 and/or Slice 4: *"Tape Direct (`start_address`) is a fixed route origin, not a draggable stop. The reorder UI does not include it in the draggable stop pool."*

---

## Section B — 7 Blockers from Prior Review: Resolved?

### RLS-1: Caller-tenant check in both SECURITY DEFINER RPCs before any UPDATE

- [x] **`confirm_order_address` RPC: caller-tenant check present and correct**  
  ✅ PASS — Migration 05, `confirm_order_address` function, lines ~587–601:  
  ```sql
  SELECT tenant_id INTO v_caller_tenant
    FROM public.members WHERE user_id = auth.uid() LIMIT 1;
  IF v_caller_tenant IS DISTINCT FROM v_tenant_id THEN
    RAISE EXCEPTION 'unauthorized: order belongs to a different tenant';
  END IF;
  ```  
  Comment: *"(Delta blocker RLS-1 resolution — 2026-06-10)"*. Check appears before the UPDATE. ✅

- [x] **`assign_order_to_route` RPC: caller-tenant check present and correct**  
  ✅ PASS — Migration 05, `assign_order_to_route` function, lines ~653–663:  
  ```sql
  SELECT tenant_id INTO v_caller_tenant
    FROM public.members WHERE user_id = auth.uid() LIMIT 1;
  IF v_caller_tenant IS DISTINCT FROM v_tenant_id THEN
    RAISE EXCEPTION 'unauthorized: caller is not a member of this tenant';
  END IF;
  ```  
  Comment: *"(Delta blocker RLS-1 resolution — 2026-06-10)"*. Check appears before the UPDATE. ✅

---

### KEY-1: `server.js` injection removed; Q4 two-key spec in place

- [x] **`server.js` injection removed; browser key only goes via template placeholder**  
  ✅ PASS — The plan no longer injects raw API keys from `server.js` into the HTML body. Instead, `server.js` fills `%%GOOGLE_MAPS_KEY%%` from `process.env.GOOGLE_MAPS_BROWSER_KEY`. Section 5.3 explicitly states server-side keys are never in `server.js`.

  ⚠️ **NOTE:** The plan's Section 2.1 still says: *"The server (`backend/server.js`) serves `index.html` and already injects variables at page render."* This implies the current `server.js` pattern is the pre-fix state being re-used. The plan needs to be explicit that the PRIOR KEY INJECTION (where the raw geocoding/routes key was embedded) has been removed and replaced with the two-key architecture. This is a documentation ambiguity, not a new blocker — the substance of KEY-1 is resolved.

---

### MIG-1: POST-COMMIT VERIFY blocks in all 5 migrations

- [x] **POST-COMMIT VERIFY blocks in all 5 migrations**  
  ❌ **BLOCK** — None of the 5 migration blocks (Section 3.1–3.5) contain POST-COMMIT VERIFY blocks. The only verification queries in the plan are in `orders-driver-rls-migration.sql` (Stream 1). Migrations 01–05 in ROUTES-REBUILD-PLAN.md have rollback blocks but **no explicit verification queries** that Forge or Delta should run after applying each migration to confirm it succeeded.  
  
  **Resolution required:** Add a `-- POST-COMMIT VERIFY` block to each of the 5 migrations with SQL queries that confirm the expected columns/tables/policies/functions exist and are correct. Example for Migration 01: verify `geocoded_lat`, `geocoded_lng`, `address_confidence`, `route_id`, `route_sequence` appear in `information_schema.columns`. Example for Migration 04: verify RLS policy names exist on `routes` table.

---

### AT-1: Driver B reads zero rows test

- [x] **AT-1: Test confirming Driver B reads zero rows from `routes`**  
  ❌ **BLOCK** — No such test exists in the acceptance criteria or test suite plans. Slice 4 acceptance criteria contains: *"Driver cannot read another driver's route (RLS enforced)"* — but this is a statement, not a defined test. There is no dedicated AT-1 acceptance test case with:
  - Login as Driver B
  - Query `routes` table
  - Assert 0 rows returned  
  
  **Resolution required:** Add explicit AT-1 test case to Slice 4 acceptance criteria (or Slice 5 test suite additions).

---

### AT-2: Cross-tenant reads zero rows test

- [x] **AT-2: Cross-tenant `routes` read returns zero rows**  
  ❌ **BLOCK** — Not present. The plan has no acceptance criterion or test case specifying: *"A user from Tenant B queries `routes` and gets 0 rows."* The RLS policies filter by `tenant_id` from `members` but no explicit cross-tenant read test is documented.  
  
  **Resolution required:** Add AT-2 to Slice 4 or Slice 5 acceptance criteria.

---

### AT-3: Driver payment-field write rejected test

- [x] **AT-3: Driver cannot write geocoding/route fields via direct Supabase update**  
  ❌ **BLOCK** — Not present. Slice 4 acceptance criteria states: *"Driver cannot modify `delivery_address`, `geocoded_lat`, `geocoded_lng`, `address_confidence`, `route_id`, or `route_sequence` (RPC scope test)"* — but this is a statement without a defined test with login/attempt/assert structure. No test case is written out.  
  
  **Resolution required:** Add AT-3 as a defined test case: Driver A attempts `supabase.from('orders').update({ geocoded_lat: 99.0 }).eq('id', 'SMOKE-001')` → assert error returned (no driver UPDATE policy).

---

### AT-4: Server API keys not in browser response test

- [x] **AT-4: Server API keys never appear in browser responses**  
  ❌ **BLOCK** — Not present. No acceptance criterion or test specifies: *"Inspect the Edge Function response body and confirm it contains no `GOOGLE_GEOCODING_KEY` or `GOOGLE_ROUTES_KEY` values."* Section 5.3 states this is a design requirement but no test case enforces it.  
  
  **Resolution required:** Add AT-4 to Slice 1 or Slice 5 acceptance criteria: *"`geocode-address` and `optimize-route` Edge Function responses do not contain any Google API key strings. Verify with a manual DevTools inspection and/or a response-body key-leak assertion."*

---

## Section C — Non-Blocker Checks from Prior Review

### `office_id` scoping on orders UPDATE policy for new columns

- ❌ **NOT ADDRESSED** — As noted in Q2 above, office_id scoping is entirely absent from the routes table and policies. Additionally, the `orders_hq_office_update` policy in Migration 05 (the narrow RPCs aside) does not scope by office_id. Since Jeffrey's Q2 decision explicitly requires office_id scoping, this is now a **blocker** (escalated from non-blocker).

---

### `members(user_id)` index present

- ❌ **NOT ADDRESSED** — The plan references `members.user_id` in RLS policy subqueries and in both SECURITY DEFINER RPCs (to resolve caller tenant). No migration or schema section creates a `CREATE INDEX ... ON public.members(user_id)` index. Without this index, every RLS policy evaluation and every RPC call that does `SELECT tenant_id FROM public.members WHERE user_id = auth.uid()` is a sequential scan.  
  
  **Status:** Still missing. Add `CREATE INDEX IF NOT EXISTS idx_members_user_id ON public.members(user_id)` to Migration 04 (RLS migration) or as a standalone migration.

---

### Concurrent update conflict approach documented

- ❌ **NOT ADDRESSED** — The plan does not document what happens when two dispatchers build/optimize routes for the same set of orders simultaneously. No `SELECT ... FOR UPDATE`, no optimistic locking, no `updated_at` version check is mentioned for `routes` or `orders.route_id` / `orders.route_sequence`. This remains an undocumented gap.  
  
  **Status:** Not a hard blocker for the plan (it's a risk/edge case), but should be documented. Add a brief note to Section 6 (Risks) or Slice 4.

---

### Dispatch gate explicit test in Slice 4

- ❌ **PARTIALLY ADDRESSED** — Slice 4 acceptance criteria states: *"Assign to driver button [is] disabled unless `optimization_status = 'optimized'` or `'custom'` AND all selected orders have `address_confidence = 'high'` AND `address_confirmed_at IS NOT NULL`."* This is a functional requirement, but no explicit test case is written (no login/action/assert structure). There is no standalone test: *"Click Assign to driver with one order having `address_confidence = 'low'` → button remains disabled."*  
  
  **Status:** Functional requirement is stated; test is not written. Add explicit test to Slice 4 acceptance criteria.

---

## Stream 2 Verdict

**Blockers found: 6**

| # | Blocker | Location |
|---|---|---|
| B1 | Q1 stale language: nearest-neighbor fallback phrase still present in Slice 4 AC + Section 5.5; must explicitly state hard block, no fallback | Slice 4, Section 5.5 |
| B2 | Q2: office_id column missing from `routes` table; Office RLS policies not scoped to office_id | Migration 02 schema + Migration 04 Office policies |
| B3 | Tape Direct: no explicit acceptance criterion stating it is a fixed, non-reorderable start point excluded from the draggable stop pool | Slice 3 / Slice 4 AC |
| B4 | MIG-1: No POST-COMMIT VERIFY blocks in any of the 5 migrations | Migrations 01–05 |
| B5 | AT-1/AT-2/AT-3/AT-4: All four acceptance tests are missing (Driver B zero rows; cross-tenant zero rows; driver payment-field write rejected; server key not in response) | Slice 4 / Slice 5 AC |
| B6 | `members(user_id)` index still missing from plan | Schema / Migration 04 |

**Non-blockers (noted for completeness):**
- Q4 Open Questions section still frames answered questions as open; update to closed/decided
- Concurrent update conflict approach undocumented (add to Risks)
- Dispatch gate test not written out (add to Slice 4 AC)
- KEY-1 server.js injection ambiguity (documentation clarity only)

---

> ## ❌ NEEDS REVISION
>
> The plan cannot proceed to Jeffrey review in its current state. 6 blockers require Forge revision before re-review.
>
> **Do not apply any migrations or begin implementation until a V3 plan clears Delta.**

---

*Delta — QA/Debugger, Casabe Konnect*  
*Jeffrey reviews and signs off before anything is applied.*
