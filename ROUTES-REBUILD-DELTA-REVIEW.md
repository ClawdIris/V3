# Delta QA Review — Routes & Optimization Rebuild Plan
**Reviewer:** Delta (QA / Schema Approval)  
**Document reviewed:** `~/casabe-v3/ROUTES-REBUILD-PLAN.md`  
**Spec reviewed:** `~/casabe-v3/routes-optimization-rebuild.md`  
**Date:** 2026-06-10  
**Verdict:** ⚠️ **NEEDS REVISION** — see required fixes below before Jeffrey review

---

## Quick Scorecard

| Category | Status |
|---|---|
| RLS | ⚠️ ISSUES FOUND |
| API Key Security | ⚠️ ISSUES FOUND |
| Migration Safety | ⚠️ ISSUES FOUND |
| Route Sync | ✅ PASS |
| Acceptance Test Coverage | ⚠️ GAPS FOUND |
| Address Book | ✅ BACKLOG ONLY CONFIRMED |
| Messaging | ✅ DISABLED CONFIRMED |
| **Final Verdict** | **NEEDS REVISION** |

---

## 1. RLS Review — ⚠️ ISSUES FOUND

### ✅ What passes

- `routes` table has `ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;` (Migration 04, line 420).
- No `USING (true)` anywhere in any policy.
- HQ sees all routes in tenant (SELECT + INSERT + UPDATE policies present).
- Office sees all routes in tenant (SELECT + INSERT + UPDATE policies present).
- Driver sees **only their own assigned routes**: `driver_user_id = auth.uid() AND optimization_status = 'assigned' AND archived_at IS NULL`.
- anon is blocked by default (RLS enabled, no anon policy = denied). ✅
- `tenant_id TEXT NOT NULL` present on the `routes` table. ✅
- Archive/`archived_at` pattern used — no hard deletes. ✅
- No DELETE policies defined for any role on `routes` — RLS blocks all hard deletes by default. ✅
- Driver has NO INSERT, UPDATE, or DELETE on `routes`. ✅
- `confirm_order_address` RPC: role check rejects driver with `RAISE EXCEPTION`. ✅
- `assign_order_to_route` RPC: role check rejects driver with `RAISE EXCEPTION`. ✅

---

### 🔴 ISSUE RLS-1 — CRITICAL: `confirm_order_address` and `assign_order_to_route` do not verify the caller belongs to the order's tenant

**Location:** Migration 05, `confirm_order_address` function (lines 552–606) and `assign_order_to_route` (lines 612–656).

**Problem:** Both SECURITY DEFINER RPCs resolve `v_tenant_id` by querying the `orders` table for the given `p_order_id`, then use that tenant ID in the UPDATE WHERE clause. However, they **never verify that the calling user's tenant matches `v_tenant_id`**. An HQ or Office user from **Tenant B** who knows a valid `order_id` from **Tenant A** can call `confirm_order_address(tenant_a_order_id, ...)` and successfully modify it, because:

1. The role check passes (they are `hq` or `office`).
2. `v_tenant_id` is set to **Tenant A's** tenant ID (fetched from the order).
3. The UPDATE runs against `orders WHERE id = p_order_id AND tenant_id = v_tenant_id` — which is Tenant A's order. Write succeeds.

This is a cross-tenant write vulnerability in both SECURITY DEFINER RPCs.

**Required fix:** Add a caller-tenant check before the UPDATE:

```sql
-- After resolving v_tenant_id from the order:
DECLARE
  v_caller_tenant TEXT;
BEGIN
  -- Resolve caller's tenant
  SELECT tenant_id INTO v_caller_tenant
  FROM public.members WHERE user_id = auth.uid() LIMIT 1;

  -- Cross-tenant guard
  IF v_caller_tenant IS DISTINCT FROM v_tenant_id THEN
    RAISE EXCEPTION 'unauthorized: order belongs to a different tenant';
  END IF;

  -- ... rest of function ...
```

This fix is required in **both** `confirm_order_address` and `assign_order_to_route`.

---

### 🟡 ISSUE RLS-2 — MINOR: `orders` table RLS for new columns not explicitly addressed

**Location:** Migration 05 note (line 542–547).

**Observation:** The plan notes that the `orders` table has existing RLS policies and that new geocoding/route columns will be protected via SECURITY DEFINER RPCs. This is an acceptable pattern **only if** the existing orders UPDATE policy blocks drivers from writing directly to `geocoded_lat`, `geocoded_lng`, `address_confidence`, `route_id`, and `route_sequence`. The plan does not reference or confirm the scope of existing `orders` UPDATE policies.

**Required clarification:** Forge must confirm (with Delta) that the existing `orders` table UPDATE policy either:
- (a) Blocks driver updates to these columns explicitly, OR
- (b) Does not grant drivers any UPDATE on `orders` at all (UPDATE goes only through `update_driver_status` RPC)

If drivers have a broad UPDATE on `orders` (even for status changes), the new columns would be writable. The plan must explicitly state the existing orders RLS posture and confirm the new columns are covered.

---

### 🟡 ISSUE RLS-3 — MINOR: `routes` RLS tenant check uses a subquery pattern without caching risk awareness

**Location:** Migration 04, all policies (lines 418–535).

**Observation:** Every policy resolves the caller's `tenant_id` via:
```sql
(SELECT tenant_id FROM public.members WHERE user_id = auth.uid() LIMIT 1)
```
This pattern is correct but executes a subquery for every row evaluated. For Supabase, this is standard and acceptable, but Forge should ensure there is an index on `members(user_id)` — the plan does not mention this. If `members` already has that index (from prior phases), no action needed. Forge should confirm.

---

## 2. API Key Security — ⚠️ ISSUES FOUND

### ✅ What passes

- Three-key inventory defined: `GOOGLE_MAPS_BROWSER_KEY` (browser-facing, intentional), `GOOGLE_GEOCODING_KEY` (Edge Function secret), `GOOGLE_ROUTES_KEY` (Edge Function secret). ✅
- Geocoding and Routes keys stored as Supabase Edge Function secrets, **never sent to browser**. ✅
- HTTP referrer restrictions documented for the browser key (casabekonnect.com domains). ✅
- API allowlist for browser key: Maps JS API + Places only (Geocoding and Routes excluded). ✅
- Graceful degradation: empty/unsubstituted key renders a clear banner — no silent blank. ✅
- Edge Functions validate caller JWT role before any external API call. ✅
- Edge Functions return generic error messages (no key leakage in error body). ✅
- No API key visible in any hardcoded source string (`grep AIza` returns nothing). ✅

---

### 🔴 ISSUE KEY-1 — CRITICAL: Server.js template injection pattern does not apply to Netlify static deployment

**Location:** Section 2.1, lines 152–156; Section 5.4, line 911; Slice 1 plan, line 680.

**Problem:** The plan states the `GOOGLE_MAPS_BROWSER_KEY` will be injected into `index.html` at serve time by `backend/server.js` using template substitution (`%%GOOGLE_MAPS_KEY%%`), citing this as "similar to how `SUPABASE_URL` and `SUPABASE_ANON_KEY` are currently set."

This is **architecturally incorrect** for this project:
- `backend/server.js` is an API-only Express server. It does **not** serve `index.html`. There is no `sendFile`, `express.static`, or template `readFile` in `server.js`.
- `index.html` is served by **Netlify** as a static file (`.netlify/state.json` confirms Netlify deployment, site ID `49b9a95d-59a3-463f-9d49-48795b8ac6ee`).
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` are currently **hardcoded** in `index.html` (lines 49–50), not injected — the premise is wrong.
- There is no `netlify.toml` build step or `netlify/functions/` inject mechanism currently defined.

**Impact:** As written, `%%GOOGLE_MAPS_KEY%%` would be delivered as a literal string to every browser, triggering the "un-substituted" degradation banner. The map would never load in production.

**Required fix — choose one and confirm with Jeffrey:**

**Option A (Recommended for simplicity):** Since `SUPABASE_URL` and `SUPABASE_ANON_KEY` are already hardcoded in `index.html` (both are public/publishable-safe values), follow the same pattern for `GOOGLE_MAPS_BROWSER_KEY`. Hardcode it in `index.html` alongside the other public keys. Restrict by HTTP referrer in GCP Console. This is the correct model for a Netlify-deployed single-page app.

**Option B (More secure, requires build infrastructure):** Add a `netlify.toml` with a build command that substitutes the key from Netlify environment variables at build time (e.g., `sed` or a build script). Requires adding Netlify CI/CD configuration.

**Do not proceed with the `server.js` injection approach as described.** It will not work.

---

### 🟡 ISSUE KEY-2 — MINOR: Plan should explicitly confirm browser key is visible in served HTML and document accepted risk

**Location:** Section 5.1, Section 5.2.

**Observation:** The browser key will be visible in the page source of the served HTML (as it is with SUPABASE_ANON_KEY today). The plan acknowledges this is intentional but does not explicitly warn Forge that this is expected and not a security finding. Add a sentence: *"The browser key will be readable in page source; this is expected and safe because the key is restricted by HTTP referrer in GCP Console."* This prevents a future Forge instance from flagging it as a vulnerability mid-build.

---

## 3. Migration Safety — ⚠️ ISSUES FOUND

### ✅ What passes

- All 5 migrations wrapped in `BEGIN;` / `COMMIT;` transactions. Count verified: 5 BEGIN, 5 COMMIT, 5 ROLLBACK blocks. ✅
- Rollback SQL present for every migration (all commented-out DROP/ALTER blocks). ✅
- Rollback uses `IF EXISTS` guards — safe to run even if partially applied. ✅
- No forward migration drops an existing policy without replacing it. ✅
- `ADD COLUMN IF NOT EXISTS` used throughout Migration 01 — idempotent. ✅
- `CREATE TABLE IF NOT EXISTS` used in Migration 02 — idempotent. ✅
- `CREATE OR REPLACE FUNCTION` used for RPCs — idempotent. ✅
- No `DROP TABLE`, `DROP COLUMN`, or `TRUNCATE` in any forward migration. ✅
- FK from `orders.route_id` to `routes(id)` is `DEFERRABLE INITIALLY DEFERRED` — safe for bulk inserts. ✅
- Comments on all new columns and tables. ✅

---

### 🔴 ISSUE MIG-1 — Required: No post-migration verification queries

**Location:** All 5 migrations.

**Problem:** The spec requirement (Delta's checklist) requires *"Verification queries present after each migration."* None of the 5 migrations include a post-`COMMIT` verification block.

**Required fix:** Add a verification block after each `COMMIT;` as a comment with `-- VERIFY:` queries so the operator can confirm the migration applied correctly. Example for Migration 01:

```sql
-- VERIFY (run after COMMIT to confirm):
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders'
--   AND column_name IN ('geocoded_lat','geocoded_lng','address_confidence',
--                       'address_confirmed_at','address_confirmed_by',
--                       'route_id','route_sequence');
-- Expected: 7 rows returned.
```

This is required for Migrations 01–05 before Delta can approve application.

---

### 🟡 ISSUE MIG-2 — MINOR: Migration 01 adds `address_confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL` without explicit schema prefix

**Location:** Migration 01, line 252.

**Observation:** The reference is `auth.users(id)` — this is correct for Supabase, but the FK is added in the same `ADD COLUMN IF NOT EXISTS` block. If the migration is run in a context where `auth.users` is not visible (e.g., a local Postgres test environment without the auth schema), it will fail. This is a documentation note for Forge: confirm this migration is tested against the actual Supabase project, not a vanilla Postgres instance.

---

### 🟡 ISSUE MIG-3 — MINOR: `updated_at` column referenced in RPCs but not added in Migration 01

**Location:** `confirm_order_address` RPC body (line 598), `assign_order_to_route` RPC body (line 643).

**Observation:** Both RPCs set `updated_at = NOW()` on the `orders` table. Migration 01 does **not** add an `updated_at` column to `orders`. If `orders` already has `updated_at`, this is fine. If it does not, the RPC will fail at runtime.

**Required clarification:** Forge must confirm `orders` already has an `updated_at` column, or add it to Migration 01.

---

## 4. Route Synchronization — ✅ PASS

### Summary
- Route data persists in the new `routes` table with `route_id` + `route_sequence` on `orders`. ✅
- HQ (MapViewPage), Office (ow_route), and Driver portal all read from `routes` + `orders` — same source of truth. ✅
- Supabase Realtime subscription pattern described for all three surfaces. ✅
- Driver sees only `routes WHERE driver_user_id = auth.uid() AND optimization_status = 'assigned'` — not all routes, not all stops. ✅
- Assignment write goes through `assign-route` Edge Function → `routes` table → `assign_order_to_route` RPC (bulk) in one transaction. ✅

### 🟡 NOTE: Concurrent update conflicts not addressed

**Location:** Section 2.3.

**Observation:** The spec requires *"Concurrent update conflicts addressed (optimistic locking or last-write-wins documented)."* The plan does not address this. For example: if two dispatchers in HQ and Office simultaneously attempt to assign/re-optimize the same route, the plan has no stated conflict resolution strategy.

**Required:** Forge must add a brief statement in Section 2.3 documenting the conflict resolution approach — e.g., last-write-wins (acceptable for V1 with the current user base) or optimistic locking via a `version` column. Jeffrey should confirm which is acceptable. This does not block the migration review but must be in the plan before Slice 4 begins.

---

## 5. Acceptance Test Coverage — ⚠️ GAPS FOUND

### ✅ What's covered in the plan's final acceptance criteria (Slice 5)

Plan AT items 1–14 map to spec AT items 1–14 with the following coverage. Most items are present.

---

### 🔴 GAP AT-1 — Spec AT#9 partially missing: driver cannot read another driver's **orders**

**Spec AT#9:** *"Driver cannot read another driver's route **or orders**."*  
**Plan AT#9:** *"Driver cannot read another driver's `routes` row (RLS test)."*

The plan's acceptance test covers `routes` isolation but **omits the orders isolation test**. The spec explicitly requires verifying that a driver cannot see another driver's order stops. The existing `can_access_order()` / `assignedDriverUserId` RLS on `orders` should cover this, but the acceptance test in Slice 5 must explicitly assert it.

**Required addition to Slice 5 acceptance criteria:**
> *"Driver A cannot query orders where `assigned_driver_user_id = Driver B's UUID` (orders RLS test)."*

---

### 🔴 GAP AT-2 — Spec acceptance test: cross-tenant isolation not in plan

**Spec (Delta's checklist requirement):** *"Cross-tenant isolation verified."*  
**Plan:** No acceptance test item for cross-tenant isolation in any slice.

This must be explicitly added to Slice 5 acceptance criteria:
> *"An authenticated user from Tenant A cannot read or modify routes or orders belonging to Tenant B (cross-tenant isolation test)."*

---

### 🔴 GAP AT-3 — Spec AT#10 missing "payment" fields explicitly

**Spec AT#10:** *"Driver cannot modify customer, **payment**, address, or assignment data."*  
**Plan AT#10:** *"Driver cannot modify `delivery_address`, `geocoded_lat`, `geocoded_lng`, `address_confidence`, `route_id`, or `route_sequence`."*

The plan omits payment fields from the driver-write rejection test. Payment field protection is listed in the original spec and Delta's checklist.

**Required addition to Slice 5 acceptance criteria:**
> *"Driver cannot modify payment-related fields (e.g., `payment_status`, `payment_amount`, or equivalent) via direct Supabase write or RPC."*

---

### 🔴 GAP AT-4 — Spec acceptance test: Google API key not in any browser-accessible response

**Spec (Delta's checklist requirement):** *"Google API key not present in any browser-accessible response."*  
**Plan:** The key security plan (Section 5) covers this architecturally, but no acceptance test item verifies it.

**Required addition to Slice 5 acceptance criteria:**
> *"No request to the `geocode-address`, `optimize-route`, or `assign-route` Edge Functions returns a response body containing `GOOGLE_GEOCODING_KEY` or `GOOGLE_ROUTES_KEY` values. Verified by inspecting response payloads in DevTools."*

> *Note: The `GOOGLE_MAPS_BROWSER_KEY` **will** appear in the served HTML page source — this is expected and acceptable; it is restricted by HTTP referrer.*

---

### 🟡 GAP AT-5 — Address-confirmation dispatch gate: "unconfirmed address blocks dispatch" vs "blocks optimization"

**Spec (Delta's checklist):** *"Address-confirmation gate: unconfirmed address blocks dispatch."*  
**Plan AT#6:** *"Optimization blocked by unresolved addresses."* (covers the gate at optimize time)

The plan's AT#6 covers blocking at optimization. However, the **Assign to driver** button also has a second gate (Section 2.4, line 222: `optimization_status = 'optimized'/'custom' AND all address_confidence = 'high' AND address_confirmed_at IS NOT NULL`). Neither Slice 4 nor Slice 5 acceptance criteria explicitly test that **dispatch is blocked** (not just optimization) when an unconfirmed address exists.

**Required addition to Slice 4 acceptance criteria:**
> *"Assign to driver button remains disabled if any selected stop has `address_confidence != 'high'` or `address_confirmed_at IS NULL`, even if optimization has run."*

---

## 6. Address Book — ✅ BACKLOG ONLY CONFIRMED

Address Book appears in Section 7 (Backlog) as "Release 2" only (lines 978–981). It is explicitly excluded from the schema and all implementation slices. **Confirmed: backlog only.**

---

## 7. Messaging — ✅ DISABLED CONFIRMED

Messaging is correctly gated:
- Assignment banner shows "Notification sending unavailable — messaging not yet approved" (Slice 4, line 791). ✅
- `TWILIO_ENABLED=true` flag required before any send. ✅
- Backlog section (lines 983–986) defers full Twilio/WhatsApp integration to a future slice pending provider approval and consent requirements. ✅
- No SMS/WA send is wired into any route flow in Slices 1–5. ✅

**Confirmed: messaging disabled and properly gated.**

---

## 8. Summary of Required Changes Before Approval

### 🔴 BLOCKING — Must be fixed before Jeffrey review

| ID | Category | Issue |
|---|---|---|
| RLS-1 | RLS | `confirm_order_address` and `assign_order_to_route` SECURITY DEFINER RPCs do not verify the caller belongs to the order's tenant — cross-tenant write vulnerability |
| KEY-1 | API Key | `server.js` template injection pattern is architecturally wrong for Netlify static deployment — key will never be substituted; plan must be corrected with the right approach |
| MIG-1 | Migration Safety | No post-migration verification queries in any of the 5 migrations |
| AT-1 | Acceptance Tests | Missing: driver cannot read another driver's orders (only routes is tested) |
| AT-2 | Acceptance Tests | Missing: cross-tenant isolation acceptance test |
| AT-3 | Acceptance Tests | Missing: driver cannot modify payment fields (only geocoding/route fields tested) |
| AT-4 | Acceptance Tests | Missing: Google server-side API key not present in any browser-accessible Edge Function response |

### 🟡 NON-BLOCKING — Must be addressed before slice gate sign-off (not for Jeffrey review)

| ID | Category | Issue |
|---|---|---|
| RLS-2 | RLS | Existing `orders` UPDATE policy scope not confirmed — Forge must document that new columns are not driver-writable via existing policy |
| RLS-3 | RLS | `members(user_id)` index existence not confirmed (minor performance) |
| KEY-2 | API Key | Plan should explicitly document that browser key in page source is expected and accepted |
| MIG-2 | Migration Safety | `auth.users` FK in Migration 01 should be tested against actual Supabase project only |
| MIG-3 | Migration Safety | `updated_at` column on `orders` existence not confirmed — RPCs set it; must not fail |
| Route Sync | Route Sync | Concurrent update conflict resolution not documented (required by spec) |
| AT-5 | Acceptance Tests | Dispatch gate (Assign button blocked on unconfirmed address) not explicitly tested in Slice 4 |

---

## 9. What Is Excellent in This Plan

This is a strong, detailed plan. The following aspects are well-executed and do not need changes:

- **Current state audit (Section 1)** is thorough and accurate — line-number references, dual Leaflet instances found, Nominatim queue identified, geoCache state documented.
- **Schema proposal** is clean, properly typed, indexed, and commented. The `routes` table design is correct.
- **RLS policies** use the correct `get_user_role()` pattern consistent with the rest of the app, with no `USING (true)` shortcuts.
- **Deferred FK with `DEFERRABLE INITIALLY DEFERRED`** is the right choice for batch route assignment.
- **SECURITY DEFINER + narrow RPCs** for address confirmation and route assignment is the right pattern to prevent broad-column driver writes.
- **Key inventory table (Section 5.1)** clearly separates browser-safe vs server-only keys.
- **Graceful degradation** for missing key is explicit and user-facing — not a silent failure.
- **Backlog section** correctly contains both Address Book and Messaging without leaking them into implementation slices.
- **Open Questions** are well-formed and correctly identified as blocking — Jeffrey must answer all four before Slice 1 begins.
- **Phase sequencing** is correct — no slice can start before the previous slice's acceptance criteria pass.

---

## Final Verdict

**⚠️ NEEDS REVISION**

Seven blocking items must be addressed. The most critical are RLS-1 (cross-tenant write in SECURITY DEFINER RPCs) and KEY-1 (architecturally invalid key injection method for Netlify deployment). These are not cosmetic — they represent a real cross-tenant security vulnerability and a deployment mechanism that will silently fail to load the map in production.

Once Forge revises the plan with the fixes above, Delta will re-review. Jeffrey should **not** review the plan or approve implementation until the revised plan clears Delta's second review.

**Do NOT approve for deployment. Do NOT begin implementation. Jeffrey reviews after Delta approves the revised plan.**

---

*Delta review complete. — 2026-06-10*
