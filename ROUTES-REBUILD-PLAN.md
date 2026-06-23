# Casabe Konnect — Routes & Optimization Rebuild Plan
**Document type:** Technical plan and schema proposal  
**Author:** Forge (Dev Lead)  
**Reviewer:** Delta (QA / schema approval)  
**Final approval:** Jeffrey  
**Status:** DRAFT V3 — B1–B6 blockers resolved; awaiting Delta V3 review then Jeffrey sign-off  
**Spec source:** `~/casabe-v3/routes-optimization-rebuild.md`  
**Date:** 2026-06-10

---

## Document Map

| Section | Content |
|---|---|
| 1 | Current State Audit |
| 2 | Architecture Decision |
| 3 | Schema Proposal (SQL — DO NOT APPLY without Delta approval) |
| 4 | Phased Implementation Plan |
| 5 | Google API Key Security Plan |
| 6 | Implementation Estimate |
| 7 | Backlog (deferred items) |
| 8 | Platform Decisions — Final (all locked) |

---

## Section 1 — Current State Audit

### 1.1 What Currently Exists

#### Map Provider: Leaflet / OpenStreetMap

- **CDN imports** at `index.html` lines 31–32: Leaflet 1.9.4 CSS + JS loaded unconditionally from `unpkg.com`.
- **Global CSS overrides** at lines 35–43: dark-tile override, popup styles, zoom/attribution colors — all Leaflet-specific.
- **Two separate Leaflet instances** exist in the codebase:
  1. `MapViewPage` (HQ — `map_view` page): initialised at ~line 26079–26101. Uses `L.tileLayer` with OSM tiles. Renders `#leaflet-map-container`.
  2. `DriverRoutePage` (Driver — `driver_route` page): initialised at ~line 6046–6061. Uses `L.tileLayer` with OSM tiles. Renders `#driver-route-leaflet-map`.

#### Geocoding: Nominatim / OpenStreetMap

- **Throttled queue** at ~line 25893–25921: `_geoQueue`, `_geoRunning`, `drainGeoQueue` — single-threaded 1.1 s throttle respecting Nominatim ToS.
- **URL pattern**: `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=<address>`.
- **Confidence model**: uses Nominatim `importance` score (≥ 0.4 = `geocoded`, < 0.4 = `low_confidence`). This is Nominatim-specific and must be replaced with the Google `location_type` classification defined in the spec.
- **`geoCache`**: client-side React state (`useState`) seeded from debug fixtures. Not persisted to Supabase; lost on page reload.
- **`COORD_STATUSES`** constants (`missing`, `geocoded`, `low_confidence`, `manual_override`) are defined twice (line ~25083 and ~30225) as module-level vars.
- **`_onCoordOverride`** callback writes back to Supabase via `_db.upsert("orders", ...)` with `coordinate_status`, `coordinate_updated_at`, `coordinate_updated_by`.

#### Current Route "Optimization"

- **Nearest-neighbor TSP, client-side only, zero DB writes** (comment at line 26265).
- `routeResult` is pure React state — resets on every page load.
- No persisted route ID, no shared route state across views.
- Distance estimation: Euclidean from cached lat/lon only.
- No Google Routes API call of any kind.

#### Current Data Model (relevant to routes)

**`orders` table** — stores everything in a `data` JSONB column with top-level relational columns extracted:
- `id` (TEXT, composite PK with `tenant_id`)
- `tenant_id` (TEXT)
- `status` (TEXT) — uses `ready_pickup` / `need_box` for live route-eligible orders
- `data` JSONB — contains `address`, `city`, `state`, `assignedDriver`, `assignedDriverUserId`, and any `coordinate_status`, `lat`, `lon` fields embedded in the blob

> **Note:** The production `orders` schema stores geographic and driver assignment info inside the JSONB `data` column. There are no standalone `geocoded_lat`, `geocoded_lng`, `address_confidence`, `address_confirmed_at`, `route_id`, or `route_sequence` relational columns today. The rebuild must add these as proper relational columns via migration.

**`drivers` table** (from `PHASE6-SUPABASE-EXTENSIONS.sql`):
- `id` UUID, `user_id` UUID (FK to `auth.users`), `office_id` UUID, `name`, `phone`, `vehicle_type`, `status`
- RLS policies exist for HQ, Office, and driver-self reads

**`route_optimizations` table** (from `PHASE6-SUPABASE-EXTENSIONS.sql`):
- Audit-only table; stores algorithm type, distance, estimated time.
- **Does not** store the actual optimized stop sequence or route assignment. This is what the spec means by "no persisted route source of truth" today.

**`members` table**:
- Contains `user_id` UUID, `tenant_id`, `role`, `display_name`
- `assignedDriverUserId` is the authoritative identity used by `can_access_order()` RLS
- Name-string fallback still exists in code (`assignedDriver` text) — must be eliminated from route assignment

#### Current Route Pages

| Page key | Role | Renderer |
|---|---|---|
| `map_view` | HQ | `MapViewPage` — shows all active orders, Leaflet map, Nominatim geocoding, nearest-neighbor preview |
| `ow_route` | Office | Route Builder tab within Office page — auto-assign only, no map, no geocoding |
| `driver_route` | Driver | `DriverRoutePage` — shows assigned orders from `ready_pickup`/`need_box`, Leaflet map with GPS |

#### Debug Fixtures (to be removed)

Lines 25975–25978: hardcoded `DBG-001` through `DBG-004` fixtures with Miami addresses. Must be removed when Google geocoding is live. They currently seed `geoCache` so Leaflet renders pins even without real geocoded data.

---

### 1.2 What Must Be Removed or Replaced

| Item | Location | Action |
|---|---|---|
| Leaflet CSS import | line 31 | Remove |
| Leaflet JS import | line 32 | Remove |
| Leaflet CSS overrides | lines 35–43 | Remove |
| `L.tileLayer` OSM tiles in `MapViewPage` | ~line 26097 | Replace with Google Maps |
| `L.tileLayer` OSM tiles in `DriverRoutePage` | ~line 6060 | Replace with Google Maps |
| `_leafletMapRef`, `_leafletInstRef` | ~line 26079 | Replace with Google Maps instance ref |
| Nominatim queue (`_geoQueue`, `drainGeoQueue`) | ~line 25893–25921 | Replace with Google Geocoding API (Edge Function) |
| Client-only `geoCache` state | ~line 25995 | Replace with Supabase-persisted coordinates |
| Nominatim `importance` confidence scoring | ~line 25911 | Replace with Google `location_type` classification |
| Nearest-neighbor client-side route preview | ~line 26265 | Replace with Google Routes API (Edge Function) |
| `routeResult` React state as route source | ~line 26023 | Replace with Supabase `routes` table read |
| Debug fixtures `DBG-001` – `DBG-004` | ~line 25975 | Remove after geocoding live |
| `COORD_STATUSES` duplicate definition | ~line 30225 | Consolidate into single definition |
| `#leaflet-map-container` DOM node | ~line 26475 | Replace with Google Maps div |
| `#driver-route-leaflet-map` DOM node | ~line 6848 | Replace with Google Maps div |
| `Map Preview` nav label / page key `map_view` | ~line 22314 | Rename to `routes_optimization` (or retain key, update label) |
| Existing `route_optimizations` table (audit-only) | DB | Keep for audit history; new `routes` table is the live source |
| P4 test suite assertions referencing Leaflet | ~line 30390–30412 | Replace with Google Maps equivalents after parity |
| `window.L` Leaflet check in test suite | ~line 30396 | Replace with Google Maps check |

---

### 1.3 What Can Be Preserved

| Item | Notes |
|---|---|
| Status filter logic (`ready_pickup` / `need_box`) | Already correct; lines 5984–5987, 25357–25360 |
| `assignedDriverUserId` UUID identity | Already dual-written; must be made mandatory for route assignment |
| `_db` data layer / `supaFetch` helpers | Keep as-is |
| Order detail panel / tracking number links | Keep; spec requires orange tracking-number links opening this panel |
| `DriverRoutePage` stop-card UI shell | Keep structure; replace Leaflet map portion only |
| `COORD_STATUSES` constants (minus Leaflet comment) | Keep keys; update confidence classification logic |
| `coordStatusColor`, `coordStatusLabel`, `coordStatusIcon` helpers | Keep; update colors/icons for Google confidence tiers |
| `update_driver_status` RPC | Must not be modified; route rebuild must route through it |
| `members` table / `can_access_order()` / `get_user_role()` RPCs | Keep entirely |
| Existing `drivers` table and its RLS policies | Keep; add `display_name_override` concern below (see Open Questions) |
| Existing `route_optimizations` audit table | Keep for history; new `routes` table is live source |
| i18n translation dictionary | Keep; add new keys for Routes & Optimization UI |
| Tape Direct warehouse address constant | Keep: `3801 White Plains Rd, Bronx, NY 10467` |
| Office (`ow_route`) tab structure | UI shell preserved; replace auto-assign with full routes view |

---

## Section 2 — Architecture Decision

### 2.1 Google Maps JS API Loading

**Pattern:** Async dynamic script tag with callback, **not** a static `<script src>` in `<head>`.

```html
<!-- Injected at runtime by initGoogleMaps() helper — NOT in static <head> -->
<!-- Key comes from a JS variable defined in index.html (see Key Delivery note below) -->
```

**Implementation:**
- A single `initGoogleMaps(callback)` helper checks `window.google?.maps`, returns immediately if already loaded, otherwise appends a `<script>` tag with `loading=async` and the API key + `libraries=places`.
- Both `MapViewPage` (HQ/Office) and `DriverRoutePage` call `initGoogleMaps()` in their `useEffect` mount hook before rendering the map div.
- **Graceful degradation:** If `GOOGLE_MAPS_KEY` is empty string or `"%%GOOGLE_MAPS_KEY%%"` (un-substituted), `initGoogleMaps()` logs a console warning and renders a styled fallback banner: `⚠️ Map unavailable — Google Maps API key not configured`. No silent failure.

**Key Delivery — ✅ FINAL DECISION: Netlify build-time environment substitution (Jeffrey, 2026-06-10)**

> `backend/server.js` is an API-only Express server — it does **not** serve `index.html`. This project is deployed as a **Netlify static site**. The `server.js` template-substitution approach is invalid for this deployment and is removed entirely. The Maps JS browser key is delivered via Netlify build-time environment substitution. See Section 5 for full implementation spec.

**Browser Key Delivery — Final Decision**

The Maps JavaScript API browser key is delivered via Netlify build-time environment substitution.

**Implementation:**
1. In `index.html`, use the placeholder: `const GOOGLE_MAPS_API_KEY = '%%GOOGLE_MAPS_KEY%%';`
2. In `netlify.toml`, add a build step:
   ```toml
   [build]
     command = "sed -i 's/%%GOOGLE_MAPS_KEY%%/$GOOGLE_MAPS_API_KEY/g' index.html"
   ```
3. Set `GOOGLE_MAPS_API_KEY` in Netlify environment variables (dashboard → Site settings → Environment variables)
4. Key is still public by nature (delivered to browsers) but never committed to source control
5. Restrict in Google Cloud Console: HTTP referrers → `casabekonnect-app.netlify.app/*` + any approved preview domains

**Server keys (Geocoding + Routes):** Edge Function secrets only. Never in `index.html` or any client-accessible file. Never echoed in Edge Function responses.

**Pre-implementation gate:** Both keys must be created, restricted, and verified before any Google API slice begins.

### 2.2 Route Data in Supabase

**Decision:** New `routes` table — separate from `orders`.

**Rationale:**
- A route is a session-level entity that spans multiple orders. Embedding route-level data (start point, end point, Google Maps URL, optimization status) directly on each `orders` row would denormalize it severely.
- Orders retain their stop-level fields (sequence, confidence, confirmed coordinates) as relational columns, with `route_id` as a FK back to `routes`.
- `routes` is the single source of truth for route-level state; `orders.route_id` + `orders.route_sequence` is the single source of truth for stop-level assignment within a route.

**`orders` table additions** (relational columns, not in JSONB):
```
geocoded_lat           DECIMAL(10,8)
geocoded_lng           DECIMAL(11,8)
address_confidence     TEXT   -- 'high' | 'low' | 'unresolvable' | null
address_confirmed_at   TIMESTAMPTZ
address_confirmed_by   UUID   -- auth.uid() of confirming HQ/Office user
route_id               UUID   -- FK → routes(id), nullable
route_sequence         SMALLINT  -- stop position within route, nullable
```

**New `routes` table:**
```
id                     UUID PK
tenant_id              TEXT
office_id              UUID NOT NULL REFERENCES offices(id)   -- Jeffrey Q2: office scoping
driver_user_id         UUID   -- members.user_id (authoritative)
driver_display_name    TEXT   -- denormalized display label at assignment time
start_address          TEXT
start_lat              DECIMAL(10,8)
start_lng              DECIMAL(11,8)
end_address            TEXT
end_lat                DECIMAL(10,8)
end_lng                DECIMAL(11,8)
optimization_status    TEXT   -- 'draft' | 'optimized' | 'custom' | 'assigned' | 'archived'
google_routes_request  JSONB  -- stored request for audit/replay
estimated_distance_km  DECIMAL(8,2)
estimated_duration_min INTEGER
google_maps_url        TEXT   -- deep link
assigned_at            TIMESTAMPTZ
created_at             TIMESTAMPTZ
updated_at             TIMESTAMPTZ
archived_at            TIMESTAMPTZ  -- NULL until archived (no hard deletes)
created_by             UUID   -- auth.uid()
```

### 2.3 Route State Sync Across Views

**Mechanism:** Supabase Realtime + on-demand query.

- `MapViewPage` (HQ) subscribes to `routes` table changes via Supabase Realtime channel filtered by `tenant_id`.
- `OwRoutePage` (Office) uses the same subscription pattern.
- `DriverRoutePage` queries `routes WHERE driver_user_id = auth.uid() AND optimization_status = 'assigned'` on mount and subscribes for updates.
- All views derive their displayed state from the same `routes` + `orders` read; no view may store a modified copy.
- When a dispatcher clicks **Assign to driver**, the Edge Function `assign-route` writes to `routes` and bulk-updates `orders.route_id` + `orders.route_sequence` in one transaction. All subscribed views see the change within Supabase Realtime latency (~200 ms).

### 2.3.1 Concurrent Update Conflict Approach

**Last-write-wins with optimistic concurrency.** Routes include an `updated_at` timestamp. If two dispatchers attempt to save a route simultaneously, the later write wins. A future version may add version/etag locking.

> **Note:** This is a documented known edge case. The risk is low in the typical Casabe dispatch workflow (one dispatcher per office at a time). No `SELECT ... FOR UPDATE` locking is used in this release. Tracking issue for etag/version locking is deferred to a post-Release 1 backlog item.

### 2.4 Address-Confirmation Gate

**Mechanism:** `address_confidence` relational column on `orders` + pre-optimization check.

**Flow:**
1. When **Optimize Route** is clicked, the UI queries all selected orders' `address_confidence` values.
2. Any order with `address_confidence IS NULL`, `'low'`, or `'unresolvable'` is flagged.
3. If any flags exist → block optimization, open the **Confirm addresses before optimizing** full-screen modal.
4. The modal only closes (enabling **Continue to optimize**) when every flagged stop is resolved: either confirmed via **Use suggestion**, corrected via **Edit address** + Places Autocomplete, or **Remove from route**.
5. Confirming or correcting an address immediately calls the `confirm-address` Edge Function which writes `delivery_address`, `geocoded_lat`, `geocoded_lng`, `address_confidence = 'high'`, `address_confirmed_at`, `address_confirmed_by` to `orders`.
6. **Assign to driver** button has a second guard: disabled unless `optimization_status = 'optimized'` or `'custom'` AND all selected orders have `address_confidence = 'high'` AND `address_confirmed_at IS NOT NULL`.

**Why Edge Function for writes (not direct Supabase from browser):**
- Geocoding/Routes API secrets must never reach the browser.
- Address confirmation writes need server-side validation that the confirmation is for a genuinely geocoded result, not a client-injected value.
- HQ/Office role check is enforced inside the Edge Function before any write.

---

## Section 3 — Schema Proposal

> **⚠️ DELTA APPROVAL REQUIRED — DO NOT APPLY until Delta reviews and Jeffrey approves.**
> This is a proposal document. The SQL below must pass Delta's schema review gate before being applied.

### 3.1 Migration 01 — Add geocoding and route fields to `orders`

```sql
-- Migration: routes-rebuild-01-orders-geocoding-fields
-- Purpose: Add Google geocoding and route assignment columns to orders
-- Prereq: orders table with (id TEXT, tenant_id TEXT) composite PK exists
-- Rollback: See rollback block at end

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS geocoded_lat          DECIMAL(10,8),
  ADD COLUMN IF NOT EXISTS geocoded_lng          DECIMAL(11,8),
  ADD COLUMN IF NOT EXISTS address_confidence    TEXT
    CHECK (address_confidence IN ('high', 'low', 'unresolvable') OR address_confidence IS NULL),
  ADD COLUMN IF NOT EXISTS address_confirmed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS address_confirmed_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS route_id              UUID,  -- FK added after routes table created
  ADD COLUMN IF NOT EXISTS route_sequence        SMALLINT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_orders_address_confidence
  ON public.orders(tenant_id, address_confidence)
  WHERE address_confidence IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_route_id
  ON public.orders(route_id)
  WHERE route_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_geocoded_coords
  ON public.orders(geocoded_lat, geocoded_lng)
  WHERE geocoded_lat IS NOT NULL AND geocoded_lng IS NOT NULL;

COMMENT ON COLUMN public.orders.geocoded_lat IS
  'Google Geocoding API result latitude. NULL = not yet geocoded.';
COMMENT ON COLUMN public.orders.geocoded_lng IS
  'Google Geocoding API result longitude. NULL = not yet geocoded.';
COMMENT ON COLUMN public.orders.address_confidence IS
  'Google location_type classification: high (ROOFTOP/RANGE_INTERPOLATED), low (GEOMETRIC_CENTER/APPROXIMATE), unresolvable (no result).';
COMMENT ON COLUMN public.orders.address_confirmed_at IS
  'Timestamp of dispatcher confirmation. NULL = unconfirmed.';
COMMENT ON COLUMN public.orders.route_id IS
  'FK to routes(id). NULL = not assigned to any route.';
COMMENT ON COLUMN public.orders.route_sequence IS
  'Optimized stop position within the assigned route (1-based). NULL = not sequenced.';

-- NOTE: route_id FK constraint is added in Migration 03 after routes table exists.

COMMIT;

-- POST-COMMIT VERIFY:
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'orders'
  ORDER BY ordinal_position;
-- Expected: lists all new columns including geocoded_lat, geocoded_lng, address_confidence,
--           address_confirmed_at, address_confirmed_by, route_id, route_sequence

SELECT policyname, cmd FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'orders';
-- Expected: lists all policies added in this migration (none added here; pre-existing policies listed)

SELECT COUNT(*) FROM public.orders;
-- Expected: unchanged row count (ADD COLUMN does not affect existing rows)

-- ROLLBACK:
-- ALTER TABLE public.orders
--   DROP COLUMN IF EXISTS geocoded_lat,
--   DROP COLUMN IF EXISTS geocoded_lng,
--   DROP COLUMN IF EXISTS address_confidence,
--   DROP COLUMN IF EXISTS address_confirmed_at,
--   DROP COLUMN IF EXISTS address_confirmed_by,
--   DROP COLUMN IF EXISTS route_id,
--   DROP COLUMN IF EXISTS route_sequence;
```

### 3.2 Migration 02 — Create `routes` table

```sql
-- Migration: routes-rebuild-02-routes-table
-- Purpose: Canonical route assignment and optimization state
-- Prereq: Migration 01 applied; drivers table exists; members table exists

BEGIN;

CREATE TABLE IF NOT EXISTS public.routes (
  -- Identity
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               TEXT NOT NULL,

  -- Office scoping (Jeffrey Q2 decision: Office users manage only their own office's routes)
  -- Set when a route is created by an Office user; HQ may set this to any office.
  office_id               UUID NOT NULL REFERENCES public.offices(id),

  -- Driver assignment (authoritative UUID — no name-string fallback)
  driver_user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  driver_display_name     TEXT NOT NULL,   -- denormalized at assignment time; for display only

  -- Route endpoints
  start_address           TEXT NOT NULL DEFAULT '3801 White Plains Rd, Bronx, NY 10467',
  start_lat               DECIMAL(10,8) NOT NULL DEFAULT 40.8887,   -- Tape Direct default
  start_lng               DECIMAL(11,8) NOT NULL DEFAULT -73.8698,  -- Tape Direct default
  end_address             TEXT NOT NULL DEFAULT 'anywhere',
  end_lat                 DECIMAL(10,8),   -- NULL when end = 'anywhere'
  end_lng                 DECIMAL(11,8),   -- NULL when end = 'anywhere'

  -- Optimization
  optimization_status     TEXT NOT NULL DEFAULT 'draft'
    CHECK (optimization_status IN ('draft', 'optimized', 'custom', 'assigned', 'archived')),
  stop_count              SMALLINT NOT NULL DEFAULT 0,
  google_routes_request   JSONB,           -- full request sent to Routes API (audit)
  google_routes_response  JSONB,           -- full response from Routes API (audit)
  estimated_distance_km   DECIMAL(8,2),
  estimated_duration_min  INTEGER,
  google_maps_url         TEXT,            -- deep link built from stops

  -- Assignment
  assigned_at             TIMESTAMPTZ,

  -- Archive pattern (no hard deletes)
  archived_at             TIMESTAMPTZ,     -- NULL = active

  -- Audit
  created_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_routes_tenant_id
  ON public.routes(tenant_id);

CREATE INDEX IF NOT EXISTS idx_routes_driver_user_id
  ON public.routes(driver_user_id, tenant_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_routes_status
  ON public.routes(tenant_id, optimization_status)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_routes_assigned_at
  ON public.routes(tenant_id, assigned_at DESC)
  WHERE assigned_at IS NOT NULL;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.set_routes_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER routes_updated_at
  BEFORE UPDATE ON public.routes
  FOR EACH ROW EXECUTE FUNCTION public.set_routes_updated_at();

COMMENT ON TABLE public.routes IS
  'Canonical route assignments. One row per dispatched or in-progress route. Archive with archived_at; never delete.';
COMMENT ON COLUMN public.routes.driver_user_id IS
  'Authoritative driver identity — must match members.user_id. Never use name string as identity.';
COMMENT ON COLUMN public.routes.optimization_status IS
  'draft=building, optimized=Routes API returned, custom=manually reordered, assigned=sent to driver, archived=retired.';

COMMIT;

-- POST-COMMIT VERIFY:
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'routes'
  ORDER BY ordinal_position;
-- Expected: lists all new columns including office_id (23 columns total)

SELECT policyname, cmd FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'routes';
-- Expected: no policies yet (RLS policies are added in Migration 04)

SELECT COUNT(*) FROM public.routes;
-- Expected: 0 (new table)

-- ROLLBACK:
-- DROP TABLE IF EXISTS public.routes CASCADE;
-- DROP FUNCTION IF EXISTS public.set_routes_updated_at();
```

### 3.3 Migration 03 — Add FK from `orders.route_id` to `routes`

```sql
-- Migration: routes-rebuild-03-orders-route-fk
-- Purpose: Enforce FK from orders.route_id to routes.id
-- Prereq: Migrations 01 and 02 applied

BEGIN;

-- Add FK constraint (deferred so batched assignments don't fail mid-transaction)
ALTER TABLE public.orders
  ADD CONSTRAINT fk_orders_route_id
    FOREIGN KEY (route_id)
    REFERENCES public.routes(id)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

COMMIT;

-- POST-COMMIT VERIFY:
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'orders'
  ORDER BY ordinal_position;
-- Expected: lists all columns (route_id FK constraint added; column already exists from Migration 01)

SELECT policyname, cmd FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'orders';
-- Expected: lists all policies on orders (unchanged by this migration)

SELECT COUNT(*) FROM public.orders;
-- Expected: unchanged row count (constraint add does not affect rows)

-- ROLLBACK:
-- ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS fk_orders_route_id;
```

### 3.4 Migration 04 — RLS Policies for `routes`

```sql
-- Migration: routes-rebuild-04-routes-rls
-- Purpose: Row-level security for routes table
-- Prereq: Migration 02 applied; get_user_role(), is_member(), can_access_order() functions exist

BEGIN;

-- Performance indexes on members(user_id) — required for RLS policy evaluation
-- (B6: every RLS policy and SECURITY DEFINER RPC queries members by user_id;
--  without this index every RLS check does a full table scan)
CREATE INDEX IF NOT EXISTS idx_members_user_id ON public.members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_tenant_user ON public.members(tenant_id, user_id);

ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

-- HQ: full read of all routes in their tenant
CREATE POLICY routes_hq_select ON public.routes
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = (
      SELECT tenant_id FROM public.members
      WHERE user_id = auth.uid() LIMIT 1
    )
    AND public.get_user_role() IN ('hq', 'admin')
  );

-- HQ: create routes
CREATE POLICY routes_hq_insert ON public.routes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = (
      SELECT tenant_id FROM public.members
      WHERE user_id = auth.uid() LIMIT 1
    )
    AND public.get_user_role() IN ('hq', 'admin')
  );

-- HQ: update routes (optimization, assignment, archive)
CREATE POLICY routes_hq_update ON public.routes
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = (
      SELECT tenant_id FROM public.members
      WHERE user_id = auth.uid() LIMIT 1
    )
    AND public.get_user_role() IN ('hq', 'admin')
  )
  WITH CHECK (
    tenant_id = (
      SELECT tenant_id FROM public.members
      WHERE user_id = auth.uid() LIMIT 1
    )
    AND public.get_user_role() IN ('hq', 'admin')
  );

-- Office: read only their own office's routes (Jeffrey Q2 decision: is_member() AND office_id match)
CREATE POLICY routes_office_select ON public.routes
  FOR SELECT
  TO authenticated
  USING (
    public.is_member(tenant_id)
    AND public.get_user_role() = 'office'
    AND office_id = public.get_user_office_id()
  );

-- Office: create routes scoped to their own office
CREATE POLICY routes_office_insert ON public.routes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_member(tenant_id)
    AND public.get_user_role() = 'office'
    AND office_id = public.get_user_office_id()
  );

-- Office: update routes scoped to their own office (Jeffrey Q2: own office only)
CREATE POLICY routes_office_update ON public.routes
  FOR UPDATE
  TO authenticated
  USING (
    public.is_member(tenant_id)
    AND public.get_user_role() = 'office'
    AND office_id = public.get_user_office_id()
  )
  WITH CHECK (
    public.is_member(tenant_id)
    AND public.get_user_role() = 'office'
    AND office_id = public.get_user_office_id()
  );

-- Office: delete routes scoped to their own office
CREATE POLICY routes_office_delete ON public.routes
  FOR DELETE
  TO authenticated
  USING (
    public.is_member(tenant_id)
    AND public.get_user_role() = 'office'
    AND office_id = public.get_user_office_id()
  );

-- Driver: read only their own assigned routes (no drafts, no other drivers)
CREATE POLICY routes_driver_select ON public.routes
  FOR SELECT
  TO authenticated
  USING (
    driver_user_id = auth.uid()
    AND optimization_status = 'assigned'
    AND archived_at IS NULL
    AND public.get_user_role() = 'driver'
  );

-- Driver: NO insert, NO update, NO delete on routes
-- (Drivers use update_driver_status RPC for order status changes only)

-- anon: no access
-- (No anon policy = anon denied by default when RLS is enabled)

COMMIT;

-- POST-COMMIT VERIFY:
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'routes'
  ORDER BY ordinal_position;
-- Expected: lists all columns added in this migration

SELECT policyname, cmd FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'routes';
-- Expected: 8 policies added in this migration:
--   routes_driver_select, routes_hq_insert, routes_hq_select, routes_hq_update,
--   routes_office_delete, routes_office_insert, routes_office_select, routes_office_update
--   Note: office policies scope by office_id = get_user_office_id()

SELECT COUNT(*) FROM public.routes;
-- Expected: 0 (new table; RLS enable does not affect rows)

SELECT indexname FROM pg_indexes
  WHERE tablename = 'members'
    AND indexname IN ('idx_members_user_id', 'idx_members_tenant_user');
-- Expected: 2 rows (both indexes present; required for RLS performance)

-- ROLLBACK:
-- ALTER TABLE public.routes DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS routes_hq_select ON public.routes;
-- DROP POLICY IF EXISTS routes_hq_insert ON public.routes;
-- DROP POLICY IF EXISTS routes_hq_update ON public.routes;
-- DROP POLICY IF EXISTS routes_office_select ON public.routes;
-- DROP POLICY IF EXISTS routes_office_insert ON public.routes;
-- DROP POLICY IF EXISTS routes_office_update ON public.routes;
-- DROP POLICY IF EXISTS routes_office_delete ON public.routes;
-- DROP POLICY IF EXISTS routes_driver_select ON public.routes;
-- DROP INDEX IF EXISTS idx_members_user_id;
-- DROP INDEX IF EXISTS idx_members_tenant_user;
```

### 3.5 Migration 05 — RLS additions to `orders` for new columns

```sql
-- Migration: routes-rebuild-05-orders-geocoding-rls
-- Purpose: Ensure HQ/Office can write geocoding/route fields; drivers cannot
-- Note: The orders table's existing RLS policies restrict wide UPDATE.
--       The confirm-address Edge Function runs SECURITY DEFINER and uses
--       a narrow update RPC (confirm_order_address) so the driver UPDATE
--       policy does not need to change. This migration adds the narrow RPC.

BEGIN;

-- Narrow RPC for address confirmation (HQ/Office only, SECURITY DEFINER)
-- Called by the confirm-address Edge Function after geocoding validation
CREATE OR REPLACE FUNCTION public.confirm_order_address(
  p_order_id    TEXT,
  p_address     TEXT,
  p_lat         DECIMAL,
  p_lng         DECIMAL,
  p_confidence  TEXT   -- 'high' | 'low' | 'unresolvable'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id TEXT;
  v_role      TEXT;
BEGIN
  -- Role check: HQ or Office only
  v_role := public.get_user_role();
  IF v_role NOT IN ('hq', 'admin', 'office') THEN
    RAISE EXCEPTION 'unauthorized: only hq/office may confirm addresses';
  END IF;

  -- Validate confidence value
  IF p_confidence NOT IN ('high', 'low', 'unresolvable') THEN
    RAISE EXCEPTION 'invalid confidence value: %', p_confidence;
  END IF;

  -- Resolve tenant
  SELECT tenant_id INTO v_tenant_id
  FROM public.orders WHERE id = p_order_id LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_id;
  END IF;

  -- Cross-tenant guard: caller must belong to the same tenant as the order.
  -- Required to prevent an HQ/Office user from Tenant B writing to Tenant A's
  -- orders. SECURITY DEFINER bypasses RLS, so this check is manual.
  -- (Delta blocker RLS-1 resolution — 2026-06-10)
  DECLARE
    v_caller_tenant TEXT;
  BEGIN
    SELECT tenant_id INTO v_caller_tenant
    FROM public.members WHERE user_id = auth.uid() LIMIT 1;

    IF v_caller_tenant IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION 'unauthorized: order belongs to a different tenant';
    END IF;
  END;

  -- Narrow write: only geocoding fields
  UPDATE public.orders
  SET
    delivery_address      = p_address,
    geocoded_lat          = p_lat,
    geocoded_lng          = p_lng,
    address_confidence    = p_confidence,
    address_confirmed_at  = NOW(),
    address_confirmed_by  = auth.uid(),
    updated_at            = NOW()
  WHERE id = p_order_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'success',    true,
    'order_id',   p_order_id,
    'confidence', p_confidence
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_order_address(TEXT, TEXT, DECIMAL, DECIMAL, TEXT)
  TO authenticated;

-- Narrow RPC for route assignment (HQ/Office only, SECURITY DEFINER)
-- Called by the assign-route Edge Function
CREATE OR REPLACE FUNCTION public.assign_order_to_route(
  p_order_id        TEXT,
  p_route_id        UUID,
  p_route_sequence  SMALLINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id TEXT;
  v_role      TEXT;
BEGIN
  v_role := public.get_user_role();
  IF v_role NOT IN ('hq', 'admin', 'office') THEN
    RAISE EXCEPTION 'unauthorized: only hq/office may assign routes';
  END IF;

  SELECT tenant_id INTO v_tenant_id
  FROM public.orders WHERE id = p_order_id LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_id;
  END IF;

  -- Cross-tenant guard: caller must belong to the same tenant as the order.
  -- SECURITY DEFINER bypasses RLS, so this check is enforced manually.
  -- This MUST appear before any UPDATE. (Delta blocker RLS-1 resolution — 2026-06-10)
  DECLARE
    v_caller_tenant TEXT;
  BEGIN
    SELECT tenant_id INTO v_caller_tenant
    FROM public.members WHERE user_id = auth.uid() LIMIT 1;

    IF v_caller_tenant IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION 'unauthorized: caller is not a member of this tenant';
    END IF;
  END;

  -- Office caller: validate office_id matches the route's office_id
  -- (Jeffrey Q2 decision — B2 resolution 2026-06-10)
  IF v_role = 'office' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.routes
      WHERE id = p_route_id
        AND office_id = public.get_user_office_id()
    ) THEN
      RAISE EXCEPTION 'unauthorized: office user cannot assign to this route';
    END IF;
  END IF;

  UPDATE public.orders
  SET
    route_id          = p_route_id,
    route_sequence    = p_route_sequence,
    updated_at        = NOW()
  WHERE id = p_order_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'success',   true,
    'order_id',  p_order_id,
    'route_id',  p_route_id,
    'sequence',  p_route_sequence
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_order_to_route(TEXT, UUID, SMALLINT)
  TO authenticated;

COMMIT;

-- POST-COMMIT VERIFY:
SELECT routine_name, routine_type FROM information_schema.routines
  WHERE routine_schema = 'public'
    AND routine_name IN ('confirm_order_address', 'assign_order_to_route');
-- Expected: 1 row per function name (2 rows total)

SELECT policyname, cmd FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'orders';
-- Expected: lists all policies on orders (unchanged by this migration; RPCs only added)

SELECT COUNT(*) FROM public.orders;
-- Expected: unchanged (no DML in this migration)

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.confirm_order_address(TEXT, TEXT, DECIMAL, DECIMAL, TEXT);
-- DROP FUNCTION IF EXISTS public.assign_order_to_route(TEXT, UUID, SMALLINT);
```

### 3.6 Backfill Strategy

- **`coordinate_status`** (legacy): Existing Nominatim-geocoded orders have `coordinate_status = 'geocoded'` or `'low_confidence'` embedded in the `data` JSONB column. These are **not** auto-backfilled to the new `geocoded_lat`/`geocoded_lng` columns. Orders that were geocoded by Nominatim are treated as `address_confidence = NULL` (unconfirmed) until they pass the Google geocoding gate during their next route-build event.
- **Rationale:** Re-geocoding every historical order via Google would incur cost and is unnecessary — only `ready_pickup` / `need_box` orders participate in routes, and they will be geocoded on demand as routes are built.
- **Legacy column preservation:** `coordinate_status`, `lat`, `lon` fields inside `data` JSONB are **not removed** until production reads exclusively from the new relational columns. Removal is a post-go-live cleanup gate — see Section 7 (Backlog).
- **Parallel read**: During the transition, `MapViewPage` must read `geocoded_lat`/`geocoded_lng` if non-null, falling back to `data->>'lat'`/`data->>'lon'` for legacy orders. This fallback is removed in a post-go-live cleanup.

---

## Section 4 — Phased Implementation Plan

### Slice 1 — Foundation & Service Layer
**Goal:** Google API access confirmed, environment plumbing in place, service helpers scaffolded, schema applied.

#### Files Changed
- `index.html`: Add `var GOOGLE_MAPS_KEY = "%%GOOGLE_MAPS_KEY%%"` near existing Supabase key block; add `initGoogleMaps(callback)` helper function; add `GOOGLE_MAPS_KEY_MISSING` graceful-degradation banner component.
- `backend/server.js`: Inject `GOOGLE_MAPS_KEY` env var into HTML template at serve time (pattern mirrors existing SUPABASE_URL injection).
- `supabase/functions/geocode-address/index.ts` *(new)*: Edge Function — accepts `{ order_id, address, tenant_id }`, calls Google Geocoding API with server-side key, classifies `location_type`, calls `confirm_order_address` RPC, returns result.
- `supabase/functions/optimize-route/index.ts` *(new)*: Edge Function — accepts `{ route_id, stop_order_ids, start, end }`, calls Google Routes API with server-side key, returns optimized sequence + estimates; calls `assign_order_to_route` RPC in batch.
- `supabase/functions/assign-route/index.ts` *(new)*: Edge Function — accepts finalized route, validates all `address_confirmed_at` non-null, writes `routes` row, calls `assign_order_to_route` for each stop, returns route URL.

#### New Supabase Objects
- Migrations 01–05 (as defined in Section 3).
- Supabase Edge Function secrets: `GOOGLE_GEOCODING_KEY`, `GOOGLE_ROUTES_KEY` (separate from browser key — see Section 5).

#### Acceptance Criteria
- `GET /functions/v1/geocode-address` with a valid Bronx address returns `{ confidence: 'high', lat, lng }`.
- `GOOGLE_MAPS_KEY` injected variable present on served page.
- `initGoogleMaps()` loads Maps JS API when key is valid; renders degradation banner when key is empty.
- Migrations applied cleanly; `orders` table has `geocoded_lat`, `address_confidence`, `route_id`, `route_sequence` columns; `routes` table exists with RLS enabled.
- `confirm_order_address` and `assign_order_to_route` RPCs reject calls from driver role.

**RLS Acceptance Tests (Delta blocker AT-1, AT-2, AT-3 resolution — 2026-06-10):**

```
Test: Driver B reads zero rows for any order assigned to Driver A (AT-1)
- Log in as Driver B (driver_b@casabe-xpress.test, NOT assigned to SMOKE-001)
- SELECT * FROM orders WHERE id = 'SMOKE-001'
- Expected: [] (can_access_order() returns false for Driver B — assignedDriverUserId
  does not match Driver B's auth.uid())
- Failure mode: any row returned means orders_driver_select RLS policy is broken
```

```
Test: Cross-tenant user reads zero rows (AT-2)
- Log in as any authenticated user whose tenant_id != 'casabe-xpress'
  (e.g. an HQ user from Tenant B)
- SELECT * FROM orders (no filter)
- Expected: [] (is_member() returns false for every casabe-xpress row)
- Also verify: SELECT * FROM routes (no filter)
- Expected: [] (routes RLS tenant check also blocks Tenant B user)
- Failure mode: any row returned means cross-tenant isolation is broken
```

```
Test: Driver A cannot write payment field (AT-3)
- Log in as Driver A (driver_a@casabe-xpress.test)
- UPDATE orders
    SET data = jsonb_set(data, '{payment}', '{"method":"HACKED"}')
    WHERE id = 'SMOKE-001'
- Expected: RLS error (no orders_driver_update policy exists —
  only update_driver_status RPC is permitted for drivers)
- Verify: re-fetch order.data.payment — must be unchanged
- Failure mode: write succeeds = driver UPDATE policy is too broad
```

```
Test: Server keys not in any browser-accessible response (AT-4)
- Open browser DevTools → Network tab
- Load the app (full page load) and trigger a geocode (optimize a route or
  confirm an address)
- Inspect ALL responses: index.html page source, any Edge Function responses
  (geocode-address, optimize-route, assign-route)
- Expected: GOOGLE_GEOCODING_KEY and GOOGLE_ROUTES_KEY do NOT appear in
  any response body, header, or page source
- The Maps JS browser key (restricted by HTTP referrer) MAY appear in
  index.html page source — this is expected and acceptable
- Failure mode: any Edge Function response body containing a raw API key
  string means the function is leaking secrets in its output
Note: Edge Functions must return generic error messages only (no key values
in error bodies). Delta verifies this by intentionally triggering a geocode
error and inspecting the response body.
```

#### Dependencies
- None (first slice).

---

### Slice 2 — Address Verification Gate
**Goal:** Google Geocoding + Places Autocomplete integrated; confirmation modal built; address corrections persist to Supabase.

#### Files Changed
- `index.html`:
  - Add `AddressConfirmationModal` component (full-screen, shows flagged stop cards with Google suggestion, **Use suggestion** / **Edit address** / **Remove from route** actions).
  - Add `PlacesAutocomplete` sub-component used by **Edit address** (3-char trigger, 300ms debounce, `componentRestrictions: { country: 'us' }`, two-line styled suggestions).
  - Replace Nominatim `drainGeoQueue` / `_geoQueue` with `geocodeOrderAddress(order_id, address)` client function that calls the `geocode-address` Edge Function.
  - Replace `geoCache` useState with read from `orders.geocoded_lat` / `orders.geocoded_lng` / `orders.address_confidence` relational columns.
  - Add `COORD_STATUSES` → `ADDRESS_CONFIDENCE` mapping: `high` = green pin, `low` = amber warning pin, `null`/`unresolvable` = red warning pin.
  - Update `coordStatusLabel`, `coordStatusColor`, `coordStatusIcon` to map new confidence values.
  - Wire `onOptimizeClick` to check all selected stops for `address_confidence = 'high'`; if any fail, open modal.

#### New Supabase Objects
- No new tables (uses Slice 1 schema).
- `geocode-address` Edge Function (deployed in Slice 1, integrated in UI here).

#### Acceptance Criteria
- Clicking **Optimize Route** with a `low`-confidence address opens the confirmation modal.
- **Use suggestion** writes `geocoded_lat`, `geocoded_lng`, `address_confidence = 'high'`, `address_confirmed_at` to Supabase via `confirm_order_address` RPC.
- **Edit address** shows Places Autocomplete; selecting an option geocodes and persists.
- **Remove from route** deselects the stop; modal counter decrements.
- **Continue to optimize** remains disabled until all flagged stops resolved or removed.
- Corrected address appears in HQ Operations order view within 1 Realtime cycle.
- No Nominatim network calls in browser DevTools.
- Driver cannot reach `confirm_order_address` RPC (returns 403).

#### Dependencies
- Slice 1 complete.

---

### Slice 3 — Page Rebuild (Layout, Map, Stop Pool)
**Goal:** Replace `MapViewPage` and `DriverRoutePage` Leaflet maps with Google Maps. Build correct desktop/mobile layouts per reference mockups.

#### Files Changed
- `index.html`:
  - Remove Leaflet CSS/JS `<link>`/`<script>` imports (lines 31–32).
  - Remove Leaflet CSS overrides block (lines 35–43).
  - Replace `MapViewPage`:
    - 300px fixed left sidebar + fluid right panel layout (desktop).
    - Bottom drawer + floating action button layout (mobile).
    - **Driver Selector** component: reads from `drivers` table (not hardcoded list); `All Drivers` + active drivers with route label.
    - **Route Origin (fixed):** Tape Direct (`3801 White Plains Rd, Bronx, NY 10467`) is the fixed start point for every route. It is **not** a customer stop and cannot be reordered. The `routes.start_address` field is not nullable and always contains the Tape Direct address. Tape Direct renders as the green home-pin origin marker on the map, not in the numbered stop sequence.
    - **Route Endpoints** selector: Tape Direct (default, non-editable origin) / optional manual end destination.
    - **Stops in Route** list: numbered cards with draggable handles (post-optimization), orange tracking-number links, confidence icons.
    - **Map View** panel: `google.maps.Map` instance with custom markers (green home, numbered amber pickup, numbered blue dropbox, yellow warning unconfirmed, red flag endpoint).
    - **Orders Queue** tab: live table of `ready_pickup` + `need_box` orders, checkbox add-to-route.
    - **Driver Assignments** tab: live driver cards with stop counts, route status.
    - **Bottom Action Bar**: stop count, distance, duration, start/end labels, **Open in Google Maps**, **Assign to driver** (disabled until gate passes).
    - `window.google.maps.Polyline` for route line rendering.
  - Replace `DriverRoutePage` Leaflet map with Google Maps instance (read-only view, no dispatcher actions).
  - Remove `#leaflet-map-container`, `#driver-route-leaflet-map` DOM nodes.
  - Remove `_leafletMapRef`, `_leafletInstRef` refs.
  - Remove debug fixtures `DBG-001` – `DBG-004`.
  - Remove `COORD_STATUSES` duplicate definition at line ~30225.
  - Update nav label only: internal key remains `map_view` (Q3 decision — preserve existing route keys for compatibility). The `navItems` entry must read `{ key: 'map_view', label: 'Routes & Optimization', ... }`. No changes to `validPages` arrays or deep-link logic.
  - Update `ow_route` (Office route builder) to use the same new `RoutesOptimizationPage` component or a scoped variant.

#### New Supabase Objects
- None (uses Slices 1–2 schema).

#### Acceptance Criteria
- No `leaflet`, `openstreetmap.org`, or `nominatim.openstreetmap.org` network calls in DevTools.
- Desktop layout: 300px left sidebar, fluid right panel, both fill viewport height.
- Mobile layout: bottom drawer, floating action button, bottom action bar above nav.
- Map shows correct marker types for each order status/confidence.
- Driver Selector shows live drivers from DB (not hardcoded list).
- Only `ready_pickup` and `need_box` orders appear in stop pool.
- Status change elsewhere removes stop in real time (Realtime subscription).
- Tracking number links open existing order detail panel.
- `DriverRoutePage` renders Google Maps for driver's assigned stops.
- P4 test suite assertions updated to check `google.maps` instead of `window.L`.

#### Dependencies
- Slices 1–2 complete.

---

### Slice 4 — Optimization, Assignment & Driver Sync
**Goal:** Google Routes API integration, persisted optimized routes, driver portal connected to `routes` table.

#### Files Changed
- `index.html`:
  - Wire **Optimize Route** button to call `optimize-route` Edge Function.
  - On response: write `routeId` to component state; re-render stop list in optimized sequence from DB.
  - **Manual reorder**: drag-to-reorder updates `route_sequence` on each affected order via `assign_order_to_route` RPC; sets `routes.optimization_status = 'custom'`; shows "Custom order — not optimized" label + **Re-optimize** button.
  - Wire **Assign to driver** button to call `assign-route` Edge Function.
  - On assignment: show confirmation toast; **Open in Google Maps** becomes active with deep link.
  - `DriverRoutePage`: subscribe to `routes WHERE driver_user_id = auth.uid() AND optimization_status = 'assigned'`; render stop cards in `route_sequence` order; show Google Maps link.
  - Google Maps deep link builder: `https://www.google.com/maps/dir/?api=1&origin=...&destination=...&waypoints=...&travelmode=driving`; warn if stop count exceeds Google's 23-waypoint deep-link limit.
  - Show "Notification sending unavailable — messaging not yet approved" banner after assignment (messaging gate per requirement #8).
- `supabase/functions/optimize-route/index.ts`: Google Routes API call, returns optimized sequence.
- `supabase/functions/assign-route/index.ts`: validates address gate, writes `routes`, bulk-calls `assign_order_to_route`.

#### New Supabase Objects
- None (uses Slices 1–2 schema).

#### Acceptance Criteria
- **Optimize Route** calls `optimize-route` Edge Function. **On Routes API failure: surface a clear error to the dispatcher. The last successfully persisted route in Supabase remains unchanged. No fallback algorithm is used. Dispatcher must explicitly retry.**
- Optimized stop sequence persisted in `routes` + `orders.route_sequence`.
- HQ map, stop list, stats bar, and driver portal all show same sequence after assignment.
- `routes.optimization_status` transitions: `draft` → `optimized` → `assigned` (or `draft` → `custom` → `assigned`).
- Driver portal updates within Realtime latency after assignment.
- Manual reorder sets `optimization_status = 'custom'`; **Re-optimize** resets to Google Routes API result.
- Google Maps deep link opens in browser with correct origin/destination/waypoints.
- Deep link warning shown when stops > 23.
- Driver cannot read another driver's route (RLS enforced).
- Assignment banner confirms messaging unavailable (no SMS/WA send).
- No `_db.upsert("orders", ...)` calls from driver context for route state (only `update_driver_status` RPC).
- **Routes API failure returns error to UI, Supabase route record unchanged** (hard block — Q1 final decision).
- **Tape Direct address appears as the fixed origin pin on the map and as a non-draggable first entry in the stop list. It is not included in the optimization sequence. Dragging or reordering Tape Direct is disabled. The route schema stores `start_address` on the `routes` table — always Tape Direct, not nullable.** The `routes.start_address` field (TEXT NOT NULL) is always `3801 White Plains Rd, Bronx, NY 10467`. Tape Direct is never listed as a numbered stop in the stop pool or sequence cards and cannot be moved to a mid-route position.
- **Test:** Confirm that the drag handle for the origin row is absent or disabled in the Slice 3/4 UI. Confirm `routes.start_address` is `NOT NULL` in the schema. Confirm the optimization payload sent to `optimize-route` Edge Function does not include Tape Direct as a waypoint — only as the `origin` field.
- **Test: Attempting to dispatch a route with one or more unconfirmed addresses returns an error and does not call the Routes API.** (Dispatch gate — confirmed `address_confidence` check fires before `optimize-route` Edge Function call.)

**RLS Acceptance Tests (B5 blockers — Delta V2 review 2026-06-10):**

```
AT-1: Driver B reads zero route rows
Test: Driver B cannot see Driver A's route stops
- Login as Driver B
- SELECT * FROM route_stops WHERE order_id = 'SMOKE-001'
- Expected: [] (can_access_order() returns false for Driver B)
```

```
AT-2: Cross-tenant reads zero rows
Test: Tenant B HQ cannot see Tenant A routes
- Login as Tenant B HQ user
- SELECT * FROM routes
- Expected: [] (is_member() fails for Tenant A data)
```

```
AT-3: Driver payment-field write rejected
Test: Driver A cannot modify payment data on orders
- Login as Driver A
- UPDATE orders SET data = jsonb_set(data, '{payment}', '{"method":"HACKED"}') WHERE id = 'SMOKE-001'
- Expected: RLS error (no orders_driver_update policy — only update_driver_status RPC permitted)
```

```
AT-4: Server API keys not in any browser-accessible response
Test: Geocoding and Routes API keys never reach the browser
- Open browser devtools → Network tab
- Load the app, trigger an address geocode
- Inspect all response bodies: index.html, Edge Function responses
- Expected: GOOGLE_GEOCODING_KEY and GOOGLE_ROUTES_KEY values do NOT appear anywhere
- The Maps JS browser key (restricted) MAY appear — that is acceptable
```

#### Dependencies
- Slices 1–3 complete.

---

### Slice 5 — Cleanup, Test Suite Update & Old Page Removal
**Goal:** Remove all legacy Map Preview and Route Optimization Preview artifacts; update test suite; confirm acceptance criteria from spec.

#### Files Changed
- `index.html`:
  - Remove any remaining Nominatim/OSM/Leaflet references.
  - Remove old "Map Preview" section comment blocks.
  - Remove legacy `routeResult` state and nearest-neighbor TSP code.
  - Remove `geoCache` state and all reads from it.
  - Remove `COORD_STATUSES.geocoded` comment referencing Leaflet pin color (update comments only).
  - Remove `window.__R4MapViewPageSrc` test hook if Leaflet-specific.
  - Final cleanup of duplicate `COORD_STATUSES` definition.
- Test suite (P4 block at ~line 30390):
  - Replace `assert("P4: Leaflet (window.L) loaded", ...)` with `assert("P4: Google Maps loaded", ...)`.
  - Replace `#leaflet-map-container` assertions with Google Maps container assertions.
  - Add assertions: routes table accessible, address gate blocks optimization, driver cannot modify routes.
- Issue any new acceptance-test hooks required by Delta for the rebuilt page.

#### New Supabase Objects
- None.

#### Acceptance Criteria (mirrors spec's Definition of Done)
1. No Leaflet, OpenStreetMap, or Nominatim network calls in any browser DevTools session.
2. Debug and production render the rebuilt Routes & Optimization page.
3. Only `ready_pickup` and `need_box` orders enter the live stop pool.
4. Driver filter uses `driver_user_id` UUID exclusively (no name-string fallback).
5. Status changes elsewhere remove stops in real time.
6. Optimization blocked by unresolved addresses.
7. Suggested and corrected addresses persist and appear in HQ and Office views.
8. Map, list, stats bar, `routes` table, and driver portal show same route sequence.
9. Driver cannot read another driver's `routes` row (RLS test). Driver A cannot query orders where `assignedDriverUserId` = Driver B's UUID (orders RLS test — Delta blocker AT-1).
10. Driver cannot modify `delivery_address`, `geocoded_lat`, `geocoded_lng`, `address_confidence`, `route_id`, `route_sequence`, or payment fields via direct Supabase write or RPC (RPC scope test — Delta blocker AT-3).
11. Google Maps link opens with correct origin, destination, waypoint order.
12. Mobile bottom drawer and action bar usable on 375px viewport.
13. Messaging does not send before provider approval (banner displayed instead).
14. Existing order and driver workflows unaffected.
15. An authenticated user from Tenant A cannot read or modify `routes` or `orders` belonging to Tenant B (cross-tenant isolation test — Delta blocker AT-2).
16. No request to `geocode-address`, `optimize-route`, or `assign-route` Edge Functions returns a response body containing `GOOGLE_GEOCODING_KEY` or `GOOGLE_ROUTES_KEY`. The Maps JS browser key (restricted) may appear in `index.html` page source — that is expected (Delta blocker AT-4).

#### Dependencies
- Slices 1–4 complete; Delta QA sign-off; Jeffrey production UI approval.

---

## Section 5 — Google API Key Security Plan

> **✅ KEY-1 RESOLVED (2026-06-10):** `server.js` injection approach removed entirely. Two separate restricted keys per Jeffrey's decision (see Section 8, Q4). Browser key delivered via Netlify build-time environment substitution (Option B — final). Server keys in Supabase Edge Function secrets only.

### Key Placement — Final

| Key | Restriction | Where stored |
|---|---|---|
| Browser key (Maps JS + Places) | HTTP referrers: casabekonnect-app.netlify.app/* + approved preview domains | Netlify environment variable: `GOOGLE_MAPS_API_KEY` (build-time substitution) |
| Server key (Geocoding + Routes) | API restriction: Geocoding API + Routes API only | Supabase Edge Function secrets: `GOOGLE_GEOCODING_KEY`, `GOOGLE_ROUTES_KEY` |

The browser key is NEVER added to Supabase secrets.  
The server key is NEVER added to Netlify environment variables or index.html.

---

### 5.0 Pre-Implementation Gate

> **Implementation of any Google API slice is BLOCKED until ALL four conditions are met:**
> 1. Both keys created and restricted in Google Cloud Console (browser key: HTTP referrers; server key: API restriction to Geocoding + Routes only).
> 2. All 4 APIs enabled with billing: Maps JavaScript API, Places API, Geocoding API, Routes API.
> 3. Browser key tested on production domain (`casabekonnect-app.netlify.app`) — Maps JS loads without console error.
> 4. Server key added to Supabase Edge Function secrets and verified via Edge Function health check (test geocode call returns 200 from `geocode-address` function).
>
> Forge must not begin any Google API implementation slice until this gate is cleared with Delta.

### 5.1 Key Inventory ✅ FINAL (Q4 decided 2026-06-10)

| Key | Variable name | Purpose | Where stored | Visible in browser? |
|---|---|---|---|---|
| Browser key | `GOOGLE_MAPS_API_KEY` | Maps JS API + Places Autocomplete only | Netlify env var → substituted into `index.html` at build time | **Yes** — intentional; restricted by HTTP referrer in GCP; never committed to source control |
| Server key | `GOOGLE_GEOCODING_KEY` | Geocoding API (Edge Function only) | Supabase Edge Function secret | **No** — never in any response body |
| Server key | `GOOGLE_ROUTES_KEY` | Routes API (Edge Function only) | Supabase Edge Function secret | **No** — never in any response body |

> **`server.js` is removed from the key delivery chain entirely.** `backend/server.js` does not serve `index.html` — Netlify serves it as a static file. Browser key delivery is via Netlify build-time substitution only.

### 5.2 Browser Key — Final Decision: Netlify Build-Time Environment Substitution ✅ FINAL (2026-06-10)

The Maps JavaScript API browser key is delivered via Netlify build-time environment substitution.

**Implementation:**
1. In `index.html`, use the placeholder: `const GOOGLE_MAPS_API_KEY = '%%GOOGLE_MAPS_KEY%%';`
2. In `netlify.toml`, add a build step:
   ```toml
   [build]
     command = "sed -i 's/%%GOOGLE_MAPS_KEY%%/$GOOGLE_MAPS_API_KEY/g' index.html"
   ```
3. Set `GOOGLE_MAPS_API_KEY` in Netlify environment variables (dashboard → Site settings → Environment variables)
4. Key is still public by nature (delivered to browsers) but never committed to source control
5. Restrict in Google Cloud Console: HTTP referrers → `casabekonnect-app.netlify.app/*` + any approved preview domains

**GCP API restrictions on browser key (allowlist only):**
- Maps JavaScript API
- Places API

**Do NOT allow on the browser key:**
- Geocoding API (server key only)
- Routes API (server key only)
- Directions API (not used)

### 5.3 Server-Side Key Security (`GOOGLE_GEOCODING_KEY`, `GOOGLE_ROUTES_KEY`) ✅ FINAL (Q4 decided 2026-06-10)

- Stored as Supabase Edge Function secrets via `supabase secrets set GOOGLE_GEOCODING_KEY=...`.
- API-restricted in Google Cloud to Geocoding API + Routes API only.
- **NEVER** appears in: `index.html`, any JS bundle, `server.js`, git history, any Edge Function response body, any log output.
- Edge Functions validate caller JWT role before any external API call:
  - `geocode-address`: role must be `hq`, `admin`, or `office`.
  - `optimize-route`: role must be `hq`, `admin`, or `office`.
  - `assign-route`: role must be `hq`, `admin`, or `office`.
- **Edge Functions must not echo key values back in error messages.** Return generic errors only (e.g. `"Geocoding failed. Please retry."` — not raw GCP error bodies containing key or project details).

### 5.4 Environment Variable Naming Convention ✅ FINAL (2026-06-10)

```
GOOGLE_MAPS_API_KEY          # Netlify env var → substituted into index.html at build time.
                             # Placeholder in index.html: const GOOGLE_MAPS_API_KEY = '%%GOOGLE_MAPS_KEY%%';
                             # Delivered to browsers (expected); restricted by HTTP referrer in GCP.
                             # NEVER committed to source control.
GOOGLE_GEOCODING_KEY         # Supabase Edge Function secret; Geocoding API. NEVER in index.html.
GOOGLE_ROUTES_KEY            # Supabase Edge Function secret; Routes API. NEVER in index.html.
```

> ❌ **REMOVED:** `GOOGLE_MAPS_BROWSER_KEY`, the `server.js` injection approach, and any hardcoded key placement in `index.html`. The browser key is delivered exclusively via Netlify build-time substitution. The placeholder `%%GOOGLE_MAPS_KEY%%` is replaced at build time and the actual key value is never in source control.

### 5.5 Server API Key Not in Browser Response — Acceptance Test

**(Delta blocker AT-4 resolution — 2026-06-10)**

This acceptance test must be added to the Slice 1 gate and also to the Slice 5 final checklist:

```
Test: Server-side API keys not browser-accessible (AT-4)
- Open browser DevTools → Network tab
- Load the app (full page load)
- Inspect ALL responses: index.html source, any Edge Function responses
  (geocode-address, optimize-route, assign-route)
- Expected: GOOGLE_GEOCODING_KEY and GOOGLE_ROUTES_KEY do NOT appear
  in any response body, header, or page source
- The Maps JS browser key (restricted by HTTP referrer) MAY appear in
  index.html page source — this is expected and acceptable
- Failure mode: any Edge Function response body containing a raw API key string
  means the function is leaking secrets in its output
Note: Edge Functions must return generic error messages (no key values in error
bodies). Delta verifies this by intentionally triggering a geocode error and
checking the response body.
```

---

### 5.6 Graceful Degradation

| Condition | Behavior |
|---|---|
| `GOOGLE_MAPS_API_KEY` is empty string | `initGoogleMaps()` renders: `⚠️ Map unavailable — contact support (maps key not configured)`. No JS error thrown. |
| `GOOGLE_MAPS_API_KEY` is `%%GOOGLE_MAPS_KEY%%` (un-substituted placeholder) | Same banner (literal `%%` detected). |
| `google.maps` fails to load (network error) | `initGoogleMaps()` catches script `onerror`; renders same banner. |
| `geocode-address` Edge Function returns error | UI shows inline error on the affected stop card; does not block other stops. |
| `optimize-route` Edge Function returns error | UI shows toast: "Route optimization failed — check addresses and try again. Please retry." **The last successfully persisted route in Supabase remains unchanged. No fallback algorithm is used. No nearest-neighbor fallback, ever. Dispatcher must explicitly retry.** |
| `assign-route` Edge Function returns error | UI shows error toast; route NOT marked `assigned`; dispatcher can retry. |

---

## Section 6 — Implementation Estimate

### Complexity Key
- **S** — Small: ≤ 4 hours of implementation work
- **M** — Medium: 4–12 hours
- **L** — Large: 12–24 hours

### Slice Estimates

| Slice | Name | Complexity | Estimate |
|---|---|---|---|
| 1 | Foundation & Service Layer | L | 16–20 h |
| 2 | Address Verification Gate | L | 14–18 h |
| 3 | Page Rebuild (Layout, Map, Stop Pool) | L | 20–28 h |
| 4 | Optimization, Assignment & Driver Sync | L | 16–22 h |
| 5 | Cleanup, Test Suite Update & Removal | M | 8–12 h |
| **Total** | | | **74–100 h** |

### Total Estimate Range
**74–100 hours of implementation work** (Forge) + Delta schema review and QA touchpoints at each slice gate (~8–12 h additional).

### Critical Path

```
Slice 1 (Foundation) 
  ↓
Slice 2 (Address Gate) ─── can overlap last 20% with Slice 3 start
  ↓
Slice 3 (Page Rebuild) ─── largest slice; no parallelism with Slice 4
  ↓
Slice 4 (Optimization + Assignment)
  ↓
Slice 5 (Cleanup + Removal) ─── Jeffrey UI approval gate here
```

**Critical path:** Slices 1 → 2 → 3 → 4 → 5. No slice can begin until its predecessor's acceptance criteria pass. Delta schema approval of Migrations 01–05 must occur before Slice 1 is merged.

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Google API project not yet provisioned with all 4 APIs enabled | Blocks Slice 1 | Jeffrey confirms GCP project + key restrictions before Slice 1 starts |
| `orders` table `data` JSONB structure varies across tenants | Schema migration may need conditional handling | Delta audits live production `orders.data` schema before Migration 01 |
| Supabase Realtime fanout latency for large order pools | UI lag on updates | Filter Realtime subscriptions by `tenant_id`; add index on `routes.tenant_id` |
| Google Routes API 23-waypoint deep-link limit | Warning only; API itself supports more | Deep link builder shows warning; Routes API call not affected |
| `coordinate_status` legacy field still read by code outside MapViewPage | Stale reads during transition | Parallel-read fallback in Slice 3; cleanup gate in Slice 5 |

---

## Section 7 — Backlog (Not in This Rebuild)

### Address Book — Release 2
The spec explicitly defers the Address Book. Do not include in schema or implementation.

When scoped: an `address_book` table (tenant-scoped, HQ/Office write, read-shared) with `label`, `address`, `geocoded_lat`, `geocoded_lng`, `address_confidence`, `confirmed_at`. Places Autocomplete and the confirmation modal will be able to look up saved addresses. Delta schema approval required at that time.

### Messaging Integration — Pending Twilio/WhatsApp Approval
- Driver assignment notification (SMS + WhatsApp deep link) is built in Slice 4 with a hard gate: messaging sends only when `TWILIO_ENABLED=true` and consent requirements pass.
- The UI assignment flow shows a "Notification unavailable — awaiting messaging approval" banner in the interim.
- When Twilio/WhatsApp approval arrives: add `send-assignment-notification` Edge Function; wire to `assign-route` post-write; Delta reviews message template for opt-out compliance.

### Legacy Coordinate Column Cleanup
- After production exclusively reads `geocoded_lat`/`geocoded_lng` relational columns (post-Slice 5 go-live verification), schedule a cleanup migration to:
  - Drop fallback reads of `data->>'lat'`, `data->>'lon'`, `data->>'coordinate_status'` from `MapViewPage` and `DriverRoutePage`.
  - Optionally remove those keys from the `data` JSONB on a rolling basis (not destructive — keys remain in historical snapshots).
  - Drop `COORD_STATUSES.geocoded` / `'manual_override'` old values (replaced by `address_confidence` model).
- This cleanup is a post-Release 1 gate. Delta must approve.

### `route_optimizations` Audit Table Cleanup
- The existing `route_optimizations` table (Phase 6) is now superseded by `routes` for live state but can remain as an audit trail.
- Post-Release 1: evaluate whether to migrate historical optimization records or simply stop writing to it.

### Multi-Destination Route Support
- Current spec assumes single-tenant, single-origin Bronx routes. If Jeffrey needs multi-origin or multi-destination routing, that is a future scope item.

### Driver GPS Location Tracking in Routes
- `DriverRoutePage` currently has GPS position state for ETA calculations.
- Integrating live GPS position into the HQ map (showing driver dot on route) is not in this rebuild. Deferred to future slice.

---

## Section 8 — Platform Decisions — Final

All four platform decisions are locked. No open questions remain. These are final and must not be reopened without Jeffrey's explicit instruction.

### Q1 — Routes API Failure: Hard Block ✅ LOCKED (2026-06-10)

**Jeffrey's decision:** Option B — hard block. No fallback.

**Spec (final):**
- On Routes API failure: surface a clear error to the dispatcher: `"Route optimization failed. Please retry."`
- The last persisted route record in Supabase remains **unchanged** — no partial writes on failure.
- **No nearest-neighbor fallback, ever.** The old client-side nearest-neighbor code will be removed in Slice 5 and must not be re-introduced.
- Any code path that previously referenced "nearest-neighbor fallback" is now a no-op; the only behaviour on failure is the error message above.

---

### Q2 — Office Role Permissions ✅ LOCKED (2026-06-10)

**Jeffrey's decision:**
- **HQ:** full access to all tenant routes (`routes` and `route_stops`).
- **Office:** SELECT / INSERT / UPDATE / DELETE only for routes where `office_id` matches the user’s assigned office (via `get_user_office_id()` or equivalent helper function).
- **Driver:** SELECT only for their assigned stops via `can_access_order()` — no route-level access.
- **Anon:** blocked entirely.

**Impact on Section 3.4 (Migration 04):** The `routes_office_*` policies must scope `USING` and `WITH CHECK` clauses by `office_id` match. Replace the broad tenant-level Office policies with:
```sql
-- Office SELECT: routes where office_id = get_user_office_id()
CREATE POLICY routes_office_select ON public.routes
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'office'
    AND office_id = public.get_user_office_id()
  );
-- Office INSERT: scope to caller's office
CREATE POLICY routes_office_insert ON public.routes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'office'
    AND office_id = public.get_user_office_id()
  );
-- Office UPDATE: scope to caller's office
CREATE POLICY routes_office_update ON public.routes
  FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'office'
    AND office_id = public.get_user_office_id()
  )
  WITH CHECK (
    public.get_user_role() = 'office'
    AND office_id = public.get_user_office_id()
  );
-- Office DELETE: scope to caller's office
CREATE POLICY routes_office_delete ON public.routes
  FOR DELETE TO authenticated
  USING (
    public.get_user_role() = 'office'
    AND office_id = public.get_user_office_id()
  );
```
HQ retains full tenant-wide access via the existing `routes_hq_*` policies (no change).

**`assign_order_to_route` RPC update (Migration 05):** Office callers must be validated against their `office_id` before any route assignment. HQ bypasses this check:
```sql
IF public.get_user_role() = 'office' THEN
  IF NOT EXISTS (
    SELECT 1 FROM public.routes
    WHERE id = p_route_id
    AND office_id = public.get_user_office_id()
  ) THEN
    RAISE EXCEPTION 'unauthorized: office user cannot assign to this route';
  END IF;
END IF;
```
This validation block must appear in `assign_order_to_route` after the initial role check.

---

### Q3 — Navigation Label ✅ LOCKED (2026-06-10)

**Jeffrey's decision:**
- **Internal page key:** `map_view` — **unchanged**. Preserve existing route keys for compatibility; no `validPages` array changes needed.
- **Nav label displayed to users:** `"Routes & Optimization"` (not `"Map View"`, `"Map Preview"`, or `"Map Preview — Active Orders"`).

**Implementation:** Update only the `navItems` label entry. The `key: 'map_view'` value remains as-is in `validPages`, page routing, and all internal references. In Slice 3, the specific `navItems` entry for `map_view` must read:
```js
{ key: 'map_view', label: 'Routes & Optimization', icon: '...' }
```
No page key renaming, no validPages array changes, no deep-link changes.

---

### Q4 — Two Separate Restricted Keys + Netlify Build-Time Delivery ✅ LOCKED (2026-06-10)

**Jeffrey's decision:** Two separate restricted keys. The `server.js` injection approach is **removed entirely**. Browser key delivery is via **Netlify build-time environment substitution** (Option B — final).

#### Browser key (Maps JS + Places only)
- Restrict in Google Cloud Console: HTTP referrers → `casabekonnect-app.netlify.app/*` plus any approved preview domains.
- **Delivery:** Netlify build-time env substitution. Placeholder in `index.html`: `const GOOGLE_MAPS_API_KEY = '%%GOOGLE_MAPS_KEY%%';`
- **netlify.toml build step:** `sed -i 's/%%GOOGLE_MAPS_KEY%%/$GOOGLE_MAPS_API_KEY/g' index.html`
- **Variable name:** `GOOGLE_MAPS_API_KEY` (Netlify env var; set in dashboard → Site settings → Environment variables).
- Key is delivered to browsers (expected and safe — restricted by GCP referrer policy) but is **never committed to source control**.

#### Server key (Geocoding + Routes only)
- Stored as Supabase Edge Function secrets: `GOOGLE_GEOCODING_KEY` and `GOOGLE_ROUTES_KEY`.
- API-restricted in Google Cloud to Geocoding API + Routes API only.
- **NEVER** appears in: `index.html`, any JS bundle, any Edge Function response body, any log output.
- Edge Functions must not echo key values back in error messages.

#### Pre-implementation gate (added to Section 5)
Implementation of any Google API slice is **blocked** until:
1. Both keys created and restricted in Google Cloud.
2. All 4 APIs enabled with billing (Maps JS, Places, Geocoding, Routes).
3. Browser key tested on production domain (`casabekonnect-app.netlify.app`).
4. Server key added to Supabase secrets and verified via Edge Function health check.

**See Section 5 for updated key security plan.**

---

*End of document.*  
*All four Jeffrey platform decisions are locked. Delta V3 review pending. No implementation work will begin until Delta V3 clears all blockers and Jeffrey signs off.*
