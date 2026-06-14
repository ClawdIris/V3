# Slice 1 — Preparation Notes
## Routes Tab: Read-Only HQ View
**Project:** Casabe Konnect R4  
**Stream:** Route Optimizer  
**Prepared by:** Forge + Delta  
**Date:** 2026-06-14  
**Status:** Pre-implementation gate — NOT YET STARTED

---

## What Slice 1 Is

Slice 1 is the smallest deployable increment of the Routes feature: a read-only **Routes tab** in the HQ navigation that renders existing route records from the database. No optimization, no geocoding, no map rendering, no Google API calls of any kind.

**Goal:** Prove the data layer and nav wiring work end-to-end before any Google-dependent code is written.

---

## Scope

### ✅ In Slice 1 (can be built now, zero Google dependency)

| Item | Detail |
|---|---|
| **Routes tab in HQ nav** | Add "Routes" entry to the HQ-role navigation bar/sidebar. Route: `/routes` or equivalent. Visible to HQ role only (or HQ + Office if Jeffrey confirms). |
| **Route list view** | Table or card list rendering rows from the `routes` table. Columns: route ID (short), office name, status badge, driver name (if driver_user_id set), stop count (COUNT from route_stops), created_at, dispatched_at. |
| **Empty state UI** | When `routes` table has no rows, show a designed empty state: "No routes yet. Routes will appear here once created." |
| **Status badge component** | Visual chip/badge per lifecycle status: `draft` (grey) | `optimized` (blue) | `dispatched` (orange) | `in_progress` (yellow) | `completed` (green) | `cancelled` (red). |
| **DB query layer** | Supabase client query: `select * from routes order by created_at desc`. RLS handles scoping — HQ sees all, Office sees their office's routes. No custom logic needed. |
| **Route detail stub** | Clicking a route row navigates to `/routes/:id`. For Slice 1, the detail page is a stub: shows the route record fields (no map, no stop list rendered yet). A "Route detail coming in Slice 2" placeholder is acceptable. |
| **Loading + error states** | Skeleton loader while fetching. Error boundary if query fails. |
| **Nav guard** | Route is inaccessible to Driver and anon roles (redirect to home or 403). |

### 🚫 Blocked Until Google API Keys (NOT in Slice 1)

| Item | Blocked By |
|---|---|
| Geocoding order delivery addresses | Geocoding API key |
| "Optimize Route" button / Routes API call | Routes API key + billing enabled |
| Map rendering (route path on a map) | Maps JavaScript API key |
| Address autocomplete (new route creation) | Places API key |
| Displaying distance/duration estimates | Routes API response |
| Any lat/lng coordinate calculation | Geocoding API key |

**These items must not be stubbed with placeholder calls.** Do not import the Google Maps SDK, load the Maps script tag, or call any Google endpoint until keys are provided and confirmed by Jeffrey.

### 🔜 Not in Slice 1, Not Blocked (Slice 2+)

| Item | Reason deferred |
|---|---|
| Route creation form | Depends on address input (Places) or manual entry UX decision |
| Stop list in route detail | Stop sequencing UX needs optimizer design decision |
| Driver dispatch UI | Depends on dispatched_at flow and push notification design |
| Driver mobile view | Separate driver app slice |
| Stop status updates | Depends on update_driver_status RPC integration |

---

## Pre-Implementation Gate Checklist

**All items must be TRUE before any Slice 1 code is written.**

### Database Gates

- [ ] **Migration 01 v2 applied** — `routes` and `route_stops` tables exist in the target environment (staging/dev). Jeffrey has approved and applied `01-routes-schema-v2.sql`.
- [ ] **RLS verified post-apply** — POST-COMMIT VERIFY block from the migration has been run. All 8 policies present, both tables have RLS enabled.
- [ ] **`get_user_office_ids()` confirmed live** — Function exists and returns `UUID[]`. Tested as an Office-role user; `office_id = ANY(get_user_office_ids())` returns correct rows.
- [ ] **`can_access_order()` confirmed live** — Function exists and accepts `TEXT`. Driver-scoped test passes (Driver A from 2026-06-14 verification).
- [ ] **HQ query returns expected shape** — Running `SELECT * FROM routes` as an HQ-role user returns all rows (or 0 rows if table is empty — empty is fine, error is not).
- [ ] **Route-to-office join confirmed** — `routes JOIN offices ON routes.office_id = offices.id` returns `offices.name` correctly (needed for route list display).

### Design/Product Gates

- [ ] **Jeffrey approves tab placement** — Where does "Routes" appear in the HQ nav? After "Orders"? Separate section? Confirm before building nav component.
- [ ] **Jeffrey approves Slice 1 scope** — Read-only list + stub detail is sufficient for Slice 1. No write UI required.
- [ ] **Route list columns confirmed** — Are the proposed columns (office, status, driver, stop count, created/dispatched) correct, or does Jeffrey want a different default view?
- [ ] **Role visibility confirmed** — Is the Routes tab HQ-only, or can Office-role users also access it (scoped to their office)?

### Code/Environment Gates

- [ ] **Dev environment runs against the correct Supabase project** — `.env.local` points to the environment where Migration 01 v2 has been applied.
- [ ] **No Google Maps SDK in the codebase** — Confirm no existing import or script tag for Google Maps JS API is present (prevent accidental use).
- [ ] **Routing/navigation framework understood** — Confirm how new top-level routes are added in this codebase (Next.js app router, pages router, React Router, etc.) before writing nav wiring.
- [ ] **Component library baseline confirmed** — What component library (if any) is in use for tables, badges, and loading states? (Avoids building duplicates.)

---

## What Gets Built (Ordered)

When all gate items are checked, build in this order:

1. **Nav entry** — Add "Routes" to HQ nav. Guard with role check. Confirm it renders without error (even to an empty page).
2. **Route list query** — Write the Supabase query. Test it returns data (or empty array). No UI yet.
3. **Empty state component** — Simplest version: text + icon.
4. **Status badge component** — Standalone chip for the 6 lifecycle states.
5. **Route list table/cards** — Wire query result into the list. Integrate empty state + badge.
6. **Loading + error states** — Skeleton and error boundary.
7. **Route detail stub** — `/routes/:id` page with raw field display and placeholder for future content.
8. **Nav guard** — Redirect non-HQ (and non-Office if applicable) users away from `/routes`.

Each item is independently shippable and reviewable. Do not batch them.

---

## Key Constraints & Contracts (Carry Into Slice 1 Code)

### Tape Direct Is Never a Stop
`routes.start_address` defaults to `'3801 White Plains Rd, Bronx, NY 10467'`. This address must never appear in `route_stops`. The UI must not allow it to be entered as a stop. The DB trigger `trg_route_stops_no_tape_direct` provides the backstop (fully active after Migration 02).

### `orders.id` Is TEXT
When joining `route_stops` to `orders`, do not cast or coerce `order_id`. It is already `TEXT`. Any Supabase query or ORM join must treat `order_id` as a string, not a number or UUID.

### RLS Is the Access Gate
Do not add application-layer role filters to route queries. RLS handles HQ/Office/Driver scoping. A query like `SELECT * FROM routes` issued by an authenticated Office user will automatically return only that office's routes. Adding a manual `WHERE office_id = X` is redundant and may break multi-office users.

### Status Transitions Are Application-Enforced
The DB only validates that a status value is in the allowed set. The application must enforce that status moves forward (draft → optimized → dispatched → in_progress → completed) and that only authorized roles can trigger each transition. Slice 1 does not write status — this is a Slice 2+ concern.

### No Google, No Exceptions
If a code reviewer sees any of the following in a Slice 1 PR, it is an automatic rejection:
- `import { Loader } from '@googlemaps/js-api-loader'`
- Any `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` reference
- Any call to `geocode`, `routes`, or `places` endpoints
- Any lat/lng field populated from an external source

---

## Open Questions (Resolve Before Gate)

1. **Who dispatches a route?** HQ only, or can Office-role users dispatch? Affects write policy design in Slice 2.
2. **Multi-driver routes:** Is a single `routes.driver_user_id` sufficient, or will there be routes where stops are split across multiple drivers? (Impacts Slice 2 creation UX.)
3. **Route creation entry point:** Will routes be created from the Orders tab (select orders → create route) or from the Routes tab (start blank → add orders)? Slice 1 doesn't build creation, but Slice 2 depends on this decision.
4. **Pagination:** How many routes are expected per tenant? Does the list need server-side pagination from day one, or is client-side acceptable for the near term?

---

*Forge + Delta — Casabe Konnect Route Optimizer*  
*Document prepared: 2026-06-14*
