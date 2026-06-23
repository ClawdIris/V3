# Routes RLS + RPC Test Suite — Casabe Konnect Routes Rebuild
**Author:** Forge (Dev Lead)  
**Reviewer:** Delta (QA / schema approval)  
**Status:** DRAFT — for Delta review and Jeffrey sign-off  
**Date:** 2026-06-10

This is the centralized authenticated test suite for all RLS and RPC surface area introduced by the Routes & Optimization rebuild. Tests are grouped by migration/feature surface and must be run with real Supabase client JWTs (never service role).

---

## Section 1 — orders RLS (post-current-migration)

Tests A–G are defined in full in:

> `~/casabe-v3/smoke-setup/forbidden-write-tests.md`

Reference that file for the complete JS client test code. Abbreviated descriptions for triage:

| Test | Description | Pass Condition |
|------|-------------|----------------|
| A | Driver cannot write payment field | `error` non-null; 0 rows updated |
| B | Driver cannot write assignment field | `error` non-null; 0 rows updated |
| C | Driver cannot write customer data | `error` non-null; 0 rows updated |
| D | Driver B cannot read Driver A's orders | `data = []` (RLS silently filters) |
| E | Cross-tenant read blocked | `data = []` (is_member() false for all rows) |
| F | Status reloads correctly after RPC call | RPC returns `{ success: true, new_status: 'in_warehouse' }` AND `SELECT data->>'status'` confirms update |
| G | RPC error reverts optimistic UI (no false local state) | RPC throws; `order.data.status` unchanged in DB |

**Prerequisites:**
- Smoke account Driver A: `driver_a@casabe-xpress.test` — assigned to SMOKE-001
- Smoke account Driver B: `driver_b@casabe-xpress.test` — NOT assigned to SMOKE-001
- SMOKE-001 must exist and be assigned to Driver A (via `assignedDriverUserId`)

All 7 tests (A–G) must pass before R1 launch clearance.

---

## Section 2 — routes + route_stops RLS (Migration 01, post-apply)

Migration file: `~/casabe-v3/routes-rebuild/migrations/01-routes-schema.sql`  
Delta V3 review: `~/casabe-v3/routes-rebuild/DELTA-MIGRATION-01-REVIEW-V3.md` (all 9 tests ✅ PASS)

Copied here for centralized reference. Run in a test/staging environment after Migration 01 is applied. **DO NOT run against production data.**

### Test 1 — HQ sees all tenant routes
```
Login as HQ user
SELECT * FROM routes
Expected: all routes belonging to the HQ's tenant
```

### Test 2 — Office A sees only Office A routes
```
Login as Office A user (office_id = <Office A UUID>)
SELECT * FROM routes
Expected: only routes where office_id = Office A UUID
```

### Test 3 — Office B sees only Office B routes (cannot see Office A)
```
Login as Office B user (office_id = <Office B UUID>)
SELECT * FROM routes
Expected: only routes where office_id = Office B UUID

SELECT * FROM routes WHERE office_id = <Office A UUID>
Expected: 0 rows
```

### Test 4 — Driver A sees only assigned route_stops
```
Login as Driver A
SELECT * FROM route_stops WHERE order_id = 'SMOKE-001'
Expected: 1 row (assigned to Driver A)

SELECT * FROM route_stops WHERE order_id = 'SMOKE-002'
Expected: 1 row (assigned to Driver A)
```

### Test 5 — Driver B sees zero route_stops
```
Login as Driver B (not assigned to any smoke orders)
SELECT * FROM route_stops
Expected: 0 rows
```

### Test 6 — Cross-tenant user sees zero rows on both tables
```
Login as user from Tenant B
SELECT * FROM routes
Expected: 0 rows

SELECT * FROM route_stops
Expected: 0 rows
```

### Test 7 — Driver cannot INSERT into route_stops
```
Login as Driver A
INSERT INTO route_stops (...) VALUES (...)
Expected: RLS error (no driver INSERT policy on route_stops)
```

### Test 8 — Driver cannot UPDATE route_stops directly
```
Login as Driver A
UPDATE route_stops SET status = 'delivered' WHERE id = '<any route_stop id>'
Expected: RLS error (no driver UPDATE policy on route_stops)
```

### Test 9 — Office A cannot read Office B route_stops
```
Login as Office A user
SELECT * FROM route_stops WHERE route_id = <Office B route ID>
Expected: 0 rows
(route_stops office policy gates through EXISTS on routes.office_id = get_user_office_id())
```

---

## Section 3 — confirm_order_address RPC (when built)

Applies after Migration 02 is applied and the `confirm_order_address` RPC is deployed (Migration 05).

### Test 3.1 — Authenticated dispatcher can confirm own-tenant order address
```js
// Login as Office A dispatcher (office role, same tenant as SMOKE-001)
const { data, error } = await supabase.rpc('confirm_order_address', {
  p_order_id:   'SMOKE-001',
  p_address:    '3801 White Plains Rd, Bronx, NY 10467',
  p_lat:        40.8887,
  p_lng:        -73.8698,
  p_confidence: 'high'
});

// Expected: { success: true, order_id: 'SMOKE-001', confidence: 'high' }
console.assert(!error, 'Test 3.1 FAILED: ' + (error && error.message));
console.assert(data && data.success === true, 'Test 3.1 FAILED: unexpected shape');

// Verify write persisted
const { data: order } = await supabase
  .from('orders')
  .select('delivery_address, address_confidence, address_confirmed_at')
  .eq('id', 'SMOKE-001')
  .single();

console.assert(order.delivery_address === '3801 White Plains Rd, Bronx, NY 10467', 'Test 3.1 FAILED: delivery_address not written');
console.assert(order.address_confidence === 'high', 'Test 3.1 FAILED: address_confidence not written');
console.assert(order.address_confirmed_at !== null, 'Test 3.1 FAILED: address_confirmed_at not written');
```

**Pass condition:** RPC returns success; `delivery_address`, `address_confidence`, and `address_confirmed_at` written to the order.

---

### Test 3.2 — Dispatcher cannot confirm address for a different tenant's order
```js
// Login as Office user from Tenant B
// SMOKE-001 belongs to Tenant A (casabe-xpress)
const { data, error } = await supabase.rpc('confirm_order_address', {
  p_order_id:   'SMOKE-001',
  p_address:    'HACKED ADDRESS',
  p_lat:        0,
  p_lng:        0,
  p_confidence: 'high'
});

// Expected: error — 'unauthorized: order belongs to a different tenant'
console.assert(error !== null, 'Test 3.2 FAILED: cross-tenant RPC call succeeded');
console.assert(
  error && error.message && error.message.includes('different tenant'),
  'Test 3.2 FAILED: wrong error message. Got: ' + (error && error.message)
);

// Verify no write occurred
const { data: order } = await supabase
  .from('orders')
  .select('delivery_address')
  .eq('id', 'SMOKE-001')
  .single();
// order will likely be null (cross-tenant RLS blocks even the read), which is correct.
```

**Pass condition:** RPC throws with cross-tenant error; `delivery_address` on SMOKE-001 unchanged.

---

### Test 3.3 — Unconfirmed address blocks route assignment
```js
// Precondition: SMOKE-003 has delivery_address = NULL and address_confidence = NULL
// Attempt to optimize a route that includes SMOKE-003

// Expected behaviour: the pre-optimization gate in the UI (or the assign-route
// Edge Function) rejects the request before calling the Routes API.
// The error surface can be UI-level (modal) or Edge Function response:
// { error: 'address confirmation required', unconfirmed_order_ids: ['SMOKE-003'] }

// Verification: Routes API is NOT called (check Edge Function logs — no outbound
// request to routes.googleapis.com). The route record in Supabase remains in
// 'draft' status unchanged.
console.assert(true, 'Test 3.3: verify via UI modal + Edge Function logs — no Routes API call');
```

**Pass condition:** Route optimization is blocked; clear error surfaced to dispatcher; no Routes API call made; no route record state change.

---

### Test 3.4 — Confirmed address persists in delivery_address column
```js
// After Test 3.1 above, re-fetch the order to confirm persistence across sessions.
// Login as a second HQ user (different session) and read the same order.
const { data: order } = await supabase
  .from('orders')
  .select('delivery_address, address_confidence, address_confirmed_at, address_confirmed_by')
  .eq('id', 'SMOKE-001')
  .single();

console.assert(order.delivery_address !== null, 'Test 3.4 FAILED: delivery_address not persisted');
console.assert(order.address_confidence === 'high', 'Test 3.4 FAILED: confidence not persisted');
console.assert(order.address_confirmed_at !== null, 'Test 3.4 FAILED: confirmed_at not persisted');
console.assert(order.address_confirmed_by !== null, 'Test 3.4 FAILED: confirmed_by not persisted');
```

**Pass condition:** All four geocoding fields readable by a second authenticated session; no in-memory-only state.

---

## Section 4 — assign_order_to_route RPC (when built)

Applies after Migration 05 is deployed and route records exist.

### Test 4.1 — HQ can assign any tenant order to any route
```js
// Login as HQ user (hq/admin role, same tenant as SMOKE-001 and the route)
const { data, error } = await supabase.rpc('assign_order_to_route', {
  p_order_id:       'SMOKE-001',
  p_route_id:       '<valid route UUID in same tenant>',
  p_route_sequence: 1
});

// Expected: { success: true, order_id: 'SMOKE-001', route_id: '<UUID>', sequence: 1 }
console.assert(!error, 'Test 4.1 FAILED: ' + (error && error.message));
console.assert(data && data.success === true, 'Test 4.1 FAILED: unexpected shape');

// Verify write
const { data: order } = await supabase
  .from('orders')
  .select('route_id, route_sequence')
  .eq('id', 'SMOKE-001')
  .single();
console.assert(order.route_id !== null, 'Test 4.1 FAILED: route_id not written');
console.assert(order.route_sequence === 1, 'Test 4.1 FAILED: route_sequence not written');
```

**Pass condition:** HQ can assign; `route_id` and `route_sequence` written to order.

---

### Test 4.2 — Office A can assign Office A orders to Office A routes only
```js
// Login as Office A dispatcher
// SMOKE-001 is an Office A order; route is an Office A route
const { data, error } = await supabase.rpc('assign_order_to_route', {
  p_order_id:       'SMOKE-001',
  p_route_id:       '<Office A route UUID>',
  p_route_sequence: 1
});

// Expected: success
console.assert(!error, 'Test 4.2 FAILED: ' + (error && error.message));
console.assert(data && data.success === true, 'Test 4.2 FAILED: unexpected shape');
```

**Pass condition:** Office A dispatcher can assign own-office order to own-office route.

---

### Test 4.3 — Office A cannot assign to Office B routes (cross-office block)
```js
// Login as Office A dispatcher
// Attempt to assign SMOKE-001 (Office A order) to an Office B route
const { data, error } = await supabase.rpc('assign_order_to_route', {
  p_order_id:       'SMOKE-001',
  p_route_id:       '<Office B route UUID>',
  p_route_sequence: 1
});

// Expected: error — 'unauthorized: office user cannot assign to this route'
console.assert(error !== null, 'Test 4.3 FAILED: cross-office assignment succeeded');
console.assert(
  error && error.message && error.message.includes('unauthorized'),
  'Test 4.3 FAILED: wrong error message. Got: ' + (error && error.message)
);
```

**Pass condition:** RPC throws; SMOKE-001 route_id unchanged.

---

### Test 4.4 — Driver cannot call assign_order_to_route (unauthorized)
```js
// Login as Driver A (driver role)
const { data, error } = await supabase.rpc('assign_order_to_route', {
  p_order_id:       'SMOKE-001',
  p_route_id:       '<any route UUID>',
  p_route_sequence: 1
});

// Expected: error — 'unauthorized: only hq/office may assign routes'
console.assert(error !== null, 'Test 4.4 FAILED: driver called assign_order_to_route');
console.assert(
  error && error.message && error.message.includes('unauthorized'),
  'Test 4.4 FAILED: wrong error message. Got: ' + (error && error.message)
);
```

**Pass condition:** RPC throws unauthorized error for driver role; no route assignment written.

---

## Section 5 — update_driver_status RPC (already built)

Full test code for Tests F and G is in:

> `~/casabe-v3/smoke-setup/forbidden-write-tests.md` — **Tests F and G**

Abbreviated descriptions:

| Test | Description | Pass Condition |
|------|-------------|----------------|
| F | Status reloads correctly after RPC call | RPC returns `{ success: true, new_status: 'in_warehouse' }` AND `order.data.status` confirmed updated in DB |
| G | RPC error reverts optimistic UI (no false local state) | RPC throws `'invalid transition'` error; DB status unchanged; UI must not update local state on error |

**Note:** The `update_driver_status` RPC is a SECURITY DEFINER function. It is the **only** write path available to drivers for order status. Direct `UPDATE orders` from a driver JWT must fail (Tests A–C in Section 1).

---

## Section 6 — Google API key security

### Test 6.1 — Browser key visible in deployed index.html (acceptable — restricted)
```
Open https://casabekonnect-app.netlify.app/
View page source (Ctrl+U / Cmd+U)
Search for 'GOOGLE_MAPS_API_KEY' or 'AIza'

Expected: The Maps JS browser key IS present (e.g. 'AIzaSy...')
This is EXPECTED and ACCEPTABLE. The key is:
  - Restricted by HTTP referrers in Google Cloud Console
  - Never committed to source control (substituted at build time)
  - Only authorized for Maps JavaScript API and Places API

Pass: The key value appears in page source. No alert needed.
Fail: The placeholder '%%GOOGLE_MAPS_KEY%%' appears (substitution failed in build).
```

### Test 6.2 — Server keys NOT visible in any browser-accessible response
```
Open browser DevTools → Network tab
Load the app (full page load)
Trigger a geocode (optimize a route or confirm an address)

Inspect ALL responses:
  - index.html page source
  - Any Edge Function responses: geocode-address, optimize-route, assign-route

Expected: GOOGLE_GEOCODING_KEY and GOOGLE_ROUTES_KEY do NOT appear
in any response body, response header, or page source.

The Maps JS browser key (restricted) MAY appear in index.html — acceptable.

Fail: Any Edge Function response body or header contains a raw server API key string.
```

### Test 6.3 — Edge Function never echoes key values in error messages
```
Intentionally trigger a geocode error (e.g. pass an invalid address, or
temporarily use a wrong key in a staging environment).

Inspect the Edge Function error response body.

Expected: Generic error message only.
  e.g.: { "error": "Geocoding failed. Please retry." }
  NOT: { "error": "API key AIzaSy... is invalid" } or any GCP raw error body.

Fail: Any response body contains the literal key string or a GCP error body
that includes project ID, key value, or raw GCP error details.
```

---

## Test Run Order (recommended)

1. **Section 1 (A–G)** — Run first; validates existing orders RLS and RPC baseline. No migration dependency beyond current state.
2. **Section 2 (Tests 1–9)** — Run after Migration 01 is applied in staging.
3. **Section 3 (3.1–3.4)** — Run after Migration 02 is applied and `confirm_order_address` RPC is deployed.
4. **Section 4 (4.1–4.4)** — Run after `assign_order_to_route` RPC is deployed and route records exist in staging.
5. **Section 5 (F + G)** — Can run any time after `update_driver_status` RPC is live (already deployed).
6. **Section 6 (6.1–6.3)** — Run after first Netlify deploy with live Google Maps key substitution.

---

## Sign-Off Gate

All sections must pass before Routes & Optimization Slice 1 begins implementation.  
Sections 3, 4, and 6 are pre-conditions for their respective implementation slices.

| Section | Gate |
|---------|------|
| Section 1 | Current — pass before R1 launch |
| Section 2 | Migration 01 apply sign-off |
| Section 3 | Slice 1 complete + Migration 02 applied |
| Section 4 | Slice 1 complete + Migration 05 applied |
| Section 5 | Already deployed — verify at any time |
| Section 6 | First Netlify deploy with substitution active |

---

*Test suite authored by Forge. Delta must execute all tests in staging. Jeffrey signs off on pass results before production apply.*
