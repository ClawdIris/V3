# Casabe Konnect - Routes & Optimization Page Rebuild

**Owner:** Jeffrey  
**Implementation:** Forge  
**QA and schema approval:** Delta  
**Status:** Approved product specification, implementation not started  
**Reference images:** Owner-provided Routes & Optimization desktop mockups

## Objective

Fully replace the existing **Map Preview** page and the **Route Optimization Preview** section at the bottom of that page with a production-ready **Routes & Optimization** workflow.

The rebuilt page must use Google Maps, live order data, persistent verified addresses, and one canonical route state shared by:

- The map
- Route stop list
- Orders Queue
- Bottom statistics bar
- Driver portal
- Driver assignment notification

No component may keep an independent copy of route state. Manual addresses are allowed only for route endpoints. Route stops must always come from live orders.

## Existing Surfaces Replaced

Forge must remove or replace the following current implementation:

- Leaflet and OpenStreetMap imports and rendering
- Nominatim geocoding
- Existing `Map Preview` page
- Existing `Route Optimization Preview`
- Low-confidence coordinate workflow and debug fixtures
- Leaflet/Nominatim-specific tests

Do not remove existing coordinate columns until the new Google-backed fields are deployed, backfilled, verified, and no longer read by production code.

## Required Architecture

### Single Source of Truth

Orders remain the canonical source for stop eligibility and stop details. A persisted route assignment record is the canonical source for route-level state.

Recommended canonical model:

- `orders`
  - Stop eligibility, customer details, address, service type, assigned driver
  - Verified coordinates and confidence
  - Assigned route ID and optimized sequence
- `routes`
  - Driver, start point, end point, optimization status, Google Maps URL
  - Estimated distance and drive time
  - Created/assigned timestamps

All page surfaces must derive from these records. React state may hold the currently loaded snapshot, selection state, and open modal state, but must not become a second source of truth.

### Security Gates

- Google Maps browser key must be restricted by allowed domain and enabled APIs.
- Routes API and privileged geocoding writes should use a server-side function or protected RPC where practical.
- Route assignment, address correction, and optimized-sequence writes require tenant-scoped HQ/Office authorization.
- Drivers may read only their assigned routes and orders.
- Drivers must not be able to modify customer addresses, assignment, payment, or route ownership through whole-order upserts.

## Status and Field Mapping

The current app uses internal status keys. Forge must use these canonical mappings:

| Owner terminology | Existing internal status | Service type |
|---|---|---|
| Ready pickup | `ready_pickup` | `pickup` |
| Drop box | `need_box` | `drop_box` |

Do not introduce `"drop box"` as a third order status unless Delta approves a separate migration.

Required stop fields:

- `customer_name`
- `delivery_address`
- `tracking_number`
- `box_type`
- `service_type`: `pickup` or `drop_box`
- `assigned_driver`
- `assigned_driver_user_id`
- `geocoded_lat`
- `geocoded_lng`
- `address_confidence`
- `address_confirmed_at`
- `route_id`
- `route_sequence`

Existing order JSON aliases may be supported during migration, but every route surface must render the same normalized stop object.

## Google Maps Integration

### APIs

Use the connected Google Maps project after confirming the key and enabled services:

- Maps JavaScript API
- Geocoding API
- Places API / Place Autocomplete
- Routes API

Remove all Leaflet/OpenStreetMap dependencies after Google Maps parity is verified.

### Google Maps Deep Link

The **Open in Google Maps** action must generate:

```text
https://www.google.com/maps/dir/?api=1&origin=ORIGIN&destination=DESTINATION&waypoints=WP1|WP2|WP3&travelmode=driving
```

URL-encode every component. Respect Google Maps waypoint limits and show a clear warning if the route exceeds the supported deep-link capacity.

## Live Stop Pool

On page load and whenever the existing sync layer reports an order change:

1. Query tenant orders with status `ready_pickup` or `need_box`.
2. Normalize each qualifying order into a stop candidate.
3. Filter by selected driver when a specific driver is selected.
4. Show all qualifying orders when **All Drivers** is selected.
5. Remove a stop automatically when its status no longer qualifies.

Stops cannot be manually created by dispatchers. Removing a stop from the current route removes only its route selection; it does not change the order status.

Tracking numbers must be orange links that open the existing order-detail panel.

## Address Verification Gate

Optimization must not run until every selected stop has a verified address.

### Geocoding Evaluation

When **Optimize Route** is clicked:

- Reuse saved coordinates only when the stored address still matches and `address_confidence` is confirmed/high.
- Otherwise geocode `delivery_address` with Google.

Classification:

| Google location type/result | CK classification | Action |
|---|---|---|
| `ROOFTOP` | High confidence | Auto-approve |
| `RANGE_INTERPOLATED` | High confidence | Auto-approve |
| `GEOMETRIC_CENTER` | Low confidence | Manual confirmation |
| `APPROXIMATE` | Low confidence | Manual confirmation |
| No result or ambiguous result | Unresolvable | Correction required |

### Confirmation Modal

If any selected stop is low-confidence or unresolvable, block optimization and open a full-screen modal titled:

> Confirm addresses before optimizing

Each flagged stop card must show:

- Customer name
- Tracking number link
- Box type badge
- Pickup or Drop box badge
- Original address labeled **From order**
- Google result labeled **Google suggestion**
- Map-pin preview thumbnail
- **Use suggestion**
- **Edit address**
- **Remove from route**

**Edit address** uses Places Autocomplete:

- Start after 3 characters
- 300ms debounce
- `componentRestrictions: { country: "us" }`
- Styled two-line suggestions

The modal footer shows **X addresses remaining**. **Continue to optimize** remains disabled until every flagged stop is resolved or removed.

### Persisted Address Corrections

Using or correcting an address must immediately persist:

- `delivery_address`
- `geocoded_lat`
- `geocoded_lng`
- `address_confidence`
- `address_confirmed_at`

The corrected address must also appear in HQ Operations and the Office order view.

## Page Layout

Desktop:

- Fixed 300px left sidebar
- Fluid right main panel
- Both fill the available viewport height

Mobile:

- Map fills the screen
- Sidebar becomes a bottom drawer
- Floating action opens the drawer
- Bottom action bar remains reachable above mobile navigation

## Left Sidebar

### Driver Selector

- **All Drivers** plus active drivers from the live drivers table
- Display name plus route label, for example `Carlos M. - Bronx Route`
- Driver changes immediately filter the stop pool and map
- No hardcoded driver list

### Route Endpoints

Start options:

- Tape Direct warehouse, default
- Current location
- Enter address manually

End options:

- Anywhere, default
- Tape Direct warehouse
- Current location
- Enter address manually

Tape Direct is the only permitted hardcoded address:

```text
3801 White Plains Rd, Bronx, NY 10467
```

Current location must use browser geolocation, reverse-geocode through Google, display the resolved street address, and show a green **GPS** badge.

Manual endpoint entry uses the same Places Autocomplete behavior as address correction.

### Stops in Route

Each card displays:

- Numbered route-position circle
- Customer name
- Full delivery address
- Orange tracking-number link
- Box-type badge
- Pickup amber badge or Drop box blue badge
- Address-confidence icon

Cards become draggable after optimization. Manual reorder sets route state to **Custom order - not optimized** and displays **Re-optimize**.

Empty state:

> No orders ready for pickup or drop box assigned to this driver

Include a link to the Orders table.

## Right Main Panel

### Header

- Map icon and **Routes & Optimization**
- Current date
- **Reset**
- **Optimize Route**

Reset clears endpoint overrides, selections, and manual ordering, then reloads fresh route/order state. Optimize is disabled with zero selected stops.

### Map View

Google Maps fills the main panel and renders:

- Green home icon: start
- Numbered amber pin: pickup
- Numbered blue pin: drop box
- Yellow warning pin: unconfirmed address
- Red flag: fixed endpoint
- Route polyline with visible direction
- Driver and stop-count overlay
- Google Maps API badge
- Complete color legend

### Orders Queue

Live qualifying-order table with:

- Checkbox
- Tracking-number link
- Customer name
- Full address
- Box type
- Service type
- Address confidence
- Assigned driver

Selecting rows reveals **Add selected to route**.

### Driver Assignments

Live driver cards showing:

- Driver name
- Stops assigned today
- Route status: active, unassigned, or completed
- **View route** action

### Bottom Action Bar

Always visible on Map view:

- Stop count
- Estimated distance
- Estimated drive time
- Start label
- End label
- **Open in Google Maps**
- **Assign to driver**

Assign is disabled until every address is confirmed and optimization has completed successfully.

## Optimization and Assignment

After the address gate passes:

1. Optimize using Google Routes API.
2. Use nearest-neighbor only as an explicit degraded fallback.
3. Start at Tape Direct by default.
4. Respect the selected endpoint behavior.
5. Persist route order and estimates.
6. Re-render map, list, stats, and driver portal from the persisted result.

Tape Direct is the default start, not an order stop. It must not be persisted as a customer order or manually reordered among customer stops.

When **Assign to driver** is clicked:

- Persist driver and route assignment
- Persist optimized sequence
- Update the driver portal in real time
- Persist the Google Maps route URL
- Trigger the approved messaging path only when Twilio/WhatsApp approval and consent requirements are satisfied

Assignment message:

- Driver name
- Stop count
- Pickup/drop-box summary
- Google Maps URL
- Required opt-out footer

Until messaging approval is complete, assignment must still persist and the UI must clearly report that notification sending is unavailable.

## Driver Portal

The assigned driver route must show:

- Google Maps route link
- Persisted optimized sequence
- Customer name
- Full address
- Tracking number
- Box type
- Pickup or Drop box service type

Completed or no-longer-eligible orders disappear through the existing sync layer.

## Schema and Migration Work

Delta must review the final schema before application.

At minimum, persist:

- Google geocoding fields on orders
- Route assignment and sequence
- Route-level endpoint, estimate, status, and deep-link data

Migration requirements:

- Transactional
- Tenant-scoped RLS
- Explicit HQ/Office write policies
- Assigned-driver read access only
- Rollback plan
- Backfill strategy
- No destructive removal of `coordinate_status` until production no longer reads it

## Implementation Sequence

### Phase 1 - Foundation

- Confirm Google API project/key and restrictions
- Define normalized stop adapter
- Add reviewed schema/migrations
- Add route and geocoding service layer
- Add authorization tests

### Phase 2 - Address Verification

- Google Geocoding integration
- Places Autocomplete
- Confirmation modal
- Persist corrections
- Remove Nominatim usage

### Phase 3 - Page Rebuild

- Desktop/mobile layouts
- Live stop pool
- Map, queue, and assignments tabs
- Bottom action bar
- Tracking links and order detail panel

### Phase 4 - Optimization and Driver Sync

- Google Routes integration
- Persisted optimized route
- Manual reorder and re-optimize behavior
- Driver portal connection
- Google Maps deep link

### Phase 5 - Messaging and Removal

- Gate assignment notifications behind provider approval and consent
- Remove old Map Preview and Route Optimization Preview
- Remove Leaflet/OpenStreetMap dependencies
- Remove obsolete tests only after replacement coverage passes

## Acceptance Tests

Delta must verify:

1. No Leaflet, OpenStreetMap, or Nominatim network calls remain.
2. Debug and production render the rebuilt Routes & Optimization page.
3. Only `ready_pickup` and `need_box` orders enter the live stop pool.
4. Driver filter uses authoritative driver UUID.
5. Status changes elsewhere remove stops in real time.
6. Optimization is blocked by unresolved addresses.
7. Suggested and corrected addresses persist and appear in HQ and Office views.
8. Map, list, stats, persisted route, and driver portal show the same route sequence.
9. Driver cannot read another driver's route or orders.
10. Driver cannot modify customer, payment, address, or assignment data.
11. Google Maps link opens with correct origin, destination, and waypoint order.
12. Mobile bottom drawer and action bar are usable.
13. Messaging does not send before provider approval/consent.
14. Existing order and driver workflows remain functional.

## Definition of Done

This rebuild is complete only when:

- The old Map Preview and preview optimizer are removed.
- Google-backed address verification and routing work in production.
- Routes are persisted and shared across HQ/Office and Driver views.
- Server-side authorization tests pass.
- Delta completes live authenticated QA.
- Jeffrey approves the production UI against the reference images.
