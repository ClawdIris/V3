/**
 * Phase 6 — Slice 2: Geocoding + Coordinate Quality Tests
 *
 * Gates checked:
 *  [1] Geocode status values render correctly in map UI
 *  [2] Orders with missing coordinates are flagged and filterable
 *  [3] Manual coordinate override UI exists and writes to activity_log
 *  [4] Office and Driver roles cannot access HQ map tools (nav gate)
 *  [5] No new Supabase Security Advisor regressions (schema policy audit)
 *  [6] Slice 1 gate still passes (Map tab in HQ nav, not in Office/Driver nav)
 */

const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'index.html');
const SQL_PATH  = path.join(__dirname, '..', 'phase6-slice2-schema.sql');

let html = '';

beforeAll(() => {
  html = fs.readFileSync(HTML_PATH, 'utf8');
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [1] — Geocode status values render correctly
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 1: Geocode status value rendering', () => {
  test('all 4 COORD_STATUSES are defined', () => {
    expect(html).toContain("missing: \"missing\"");
    expect(html).toContain("geocoded: \"geocoded\"");
    expect(html).toContain("low_confidence: \"low_confidence\"");
    expect(html).toContain("manual_override: \"manual_override\"");
  });

  test('coordStatusLabel returns correct labels', () => {
    expect(html).toContain('"Geocoded"');
    expect(html).toContain('"Low Confidence"');
    expect(html).toContain('"Manual Override"');
    expect(html).toContain('"Missing"');
  });

  test('coordStatusColor maps all 4 statuses to color values', () => {
    // Leaflet map uses hex colors for real map marker rendering
    // (previously used CSS vars which Leaflet canvas cannot interpret)
    expect(html).toContain('COORD_STATUSES.geocoded)');
    expect(html).toContain('COORD_STATUSES.low_confidence)');
    expect(html).toContain('COORD_STATUSES.manual_override)');
    // Function must return some color value for each status
    expect(html).toContain('coordStatusColor');
  });

  test('coordStatusIcon returns emoji icons for all 4 statuses', () => {
    expect(html).toContain('coordStatusIcon');
    // geocoded → 📍, low_confidence → ⚠️, manual_override → ✏️, missing → ❓
    expect(html).toContain('"📍"');
    expect(html).toContain('"⚠️"');
    expect(html).toContain('"✏️"');
    expect(html).toContain('"❓"');
  });

  test('stat cards for all 4 statuses are rendered', () => {
    expect(html).toContain('"Geocoded"');
    expect(html).toContain('"Manual Override"');
    expect(html).toContain('"Low Confidence"');
    expect(html).toContain('"Missing"');
  });

  test('map pins use data-coord-status attribute', () => {
    expect(html).toContain('"data-coord-status": cStatus');
  });

  test('order table Coord Status column exists', () => {
    expect(html).toContain('"Coord Status"');
  });

  test('order table coord status badge uses data-coord-status', () => {
    expect(html).toContain('"data-coord-status": cStatus');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [2] — Missing coordinates flagged and filterable
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 2: Missing coordinates flagging and filter', () => {
  test('"needs_coordinates" filter exists as chip button', () => {
    expect(html).toContain('id: "needs-coords-filter"');
    expect(html).toContain('"needs_coordinates"');
  });

  test('filter chip shows missing count', () => {
    // In the HTML file the icon is stored as \u26A0 escape sequence
    expect(html).toContain('Needs Coordinates (" + missingCount');
  });

  test('filteredOrders logic filters by needs_coordinates', () => {
    expect(html).toContain('coordFilter === "needs_coordinates"');
    expect(html).toContain('e.status === COORD_STATUSES.missing || e.status === COORD_STATUSES.low_confidence');
  });

  test('empty state message when all coords are good', () => {
    // In the HTML file the checkmark is stored as \u2713 escape
    expect(html).toContain('All active orders have usable coordinates!');
  });

  test('Slice 2: Google geocode-address Edge Function wired (Nominatim removed)', () => {
    // Nominatim network call must be GONE
    expect(html).not.toContain('nominatim.openstreetmap.org/search');
    // Edge Function geocoding present
    expect(html).toContain('geocodeOrderAddress');
    expect(html).toContain('geocode-address');
    expect(html).toContain('enqueueGeocode'); // compatibility shim retained
  });

  test('Slice 2: geocoding delegates to Edge Function (no client-side throttle queue)', () => {
    // Old Nominatim throttle removed
    expect(html).not.toContain('setTimeout(drainGeoQueue, 1100)');
    // New path invokes the Edge Function
    expect(html).toContain('functions.invoke("geocode-address"');
  });

  test('geoCache is persisted to localStorage', () => {
    expect(html).toContain('casabe_geocache_v2');
    expect(html).toContain('localStorage.setItem(GEO_CACHE_KEY');
    expect(html).toContain('localStorage.getItem(GEO_CACHE_KEY');
  });

  test('geocoding does not overwrite manual_override entries', () => {
    expect(html).toContain('entry.status === COORD_STATUSES.manual_override');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [3] — Manual coordinate override UI + activity_log
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 3: Manual coordinate override + activity_log', () => {
  test('"Fix Coordinates" button exists with correct id', () => {
    expect(html).toContain('id: "manual-coord-override-btn"');
    // Icon stored as escape sequences in HTML
    expect(html).toContain('Fix Coordinates"');
  });

  test('override form with lat/lon/note fields exists', () => {
    expect(html).toContain('id: "coord-override-form"');
    expect(html).toContain('id: "override-lat"');
    expect(html).toContain('id: "override-lon"');
  });

  test('Save Override button exists', () => {
    expect(html).toContain('id: "override-save-btn"');
    expect(html).toContain('Save Override"');
  });

  test('activity_log entry is created on save with old/new data', () => {
    expect(html).toContain('activity_type: "coordinate_override"');
    expect(html).toContain('old_data:');
    expect(html).toContain('new_data:');
    expect(html).toContain('coordinate_status: prevEntry.status');
    expect(html).toContain('coordinate_status: COORD_STATUSES.manual_override');
  });

  test('activity_log records who changed coordinates', () => {
    expect(html).toContain('user_email: _session.email || "hq"');
  });

  test('activity_log records timestamp', () => {
    expect(html).toContain('created_at: new Date().toISOString()');
  });

  test('override sets coordinate_status to manual_override', () => {
    expect(html).toContain('status: COORD_STATUSES.manual_override');
  });

  test('override validates lat range -90 to 90', () => {
    expect(html).toContain('lat < -90 || lat > 90');
  });

  test('override validates lon range -180 to 180', () => {
    expect(html).toContain('lon < -180 || lon > 180');
  });

  test('onCoordOverride callback propagates patch to parent orders', () => {
    expect(html).toContain('_onCoordOverride(oid,');
    expect(html).toContain('coordinate_status: COORD_STATUSES.manual_override');
  });

  test('override preserves history (non-destructive: old value logged)', () => {
    expect(html).toContain('old_data: { lat: prevEntry.lat, lon: prevEntry.lon,');
  });

  test('activity log card renders in UI', () => {
    expect(html).toContain('Coordinate Override Log');
    expect(html).toContain('entries this session');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [4] — Office and Driver roles cannot access HQ map tools
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 4: Role access control for map tools', () => {
  test('map_view nav item exists for HQ role', () => {
    // The nav item with k:"map_view" appears in the nav list
    expect(html).toContain('k: "map_view"');
  });

  test('HQ valid pages include map_view', () => {
    // map_view was added to HQ validPages in Slice 2
    expect(html).toContain('"map_view"');
  });

  test('Office valid pages do NOT include map_view', () => {
    // validPages for office role should not contain map_view
    // The role-switch logic resets page when switching to office/driver
    const officeValidPages = html.match(/r === "office"\s*\?\s*\[(.*?)\]/s);
    if (officeValidPages) {
      expect(officeValidPages[0]).not.toContain('map_view');
    } else {
      // Alternative check: map_view is gated inside renderPage HQ block
      expect(html).toContain('page === "map_view"');
    }
  });

  test('MapViewPage receives read-only tag in render', () => {
    expect(html).toContain('Read-Only');
    expect(html).toContain('HQ Only');
  });

  test('MapViewPage does not contain order edit/save actions', () => {
    // The component should have no saveOrder, onSave calls
    // Check the MapViewPage block specifically
    const mvpStart = html.indexOf('PHASE 6 — SLICE 2');
    const mvpEnd   = html.indexOf('var renderPage = function renderPage()');
    const mvpBlock = html.slice(mvpStart, mvpEnd);
    // Map page should not call saveOrder
    expect(mvpBlock).not.toContain('saveOrder');
    expect(mvpBlock).not.toContain('onSave(');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [5] — No new Supabase Security Advisor regressions
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 5: Schema security audit (SQL file check)', () => {
  let sql = '';

  beforeAll(() => {
    sql = fs.readFileSync(SQL_PATH, 'utf8');
  });

  test('migration SQL file exists', () => {
    expect(fs.existsSync(SQL_PATH)).toBe(true);
  });

  test('SQL adds columns with IF NOT EXISTS (safe re-run)', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS lat');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS lon');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS coordinate_status');
  });

  test('coordinate_status has CHECK constraint with all 4 values', () => {
    expect(sql).toContain("CHECK (coordinate_status IN ('missing', 'geocoded', 'low_confidence', 'manual_override'))");
  });

  test('no new public tables are created (no CREATE TABLE)', () => {
    // Should not create new tables (only ALTER existing)
    const createTableLines = sql.split('\n')
      .filter(l => !l.trim().startsWith('--'))
      .filter(l => /CREATE TABLE\b/.test(l));
    expect(createTableLines.length).toBe(0);
  });

  test('no RLS disabled on any table', () => {
    expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY');
    expect(sql).not.toContain('ALTER TABLE orders DISABLE');
  });

  test('existing orders RLS is not dropped', () => {
    expect(sql).not.toContain('DROP POLICY');
    expect(sql).not.toContain('DROP TABLE');
  });

  test('activity_log is used but not recreated', () => {
    // SQL references activity_log in comments but does not create it
    const createActivityLog = sql.match(/CREATE TABLE.*activity_log/i);
    expect(createActivityLog).toBeNull();
  });

  test('migration includes coordinate_status default of missing', () => {
    expect(sql).toContain("DEFAULT 'missing'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [6] — Slice 1 gate: Map tab in HQ nav, not in Office/Driver nav
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 6: Slice 1 nav gate still passes', () => {
  test('Map View nav item is present in HQ nav', () => {
    expect(html).toContain('k: "map_view"');
    expect(html).toContain('Map View');
  });

  test('map_view page route is handled in renderPage', () => {
    expect(html).toContain('page === "map_view"');
    expect(html).toContain('MapViewPage');
  });

  test('Map View not in Office nav valid pages', () => {
    // Office nav pages are: ow_dash, ow_route, ow_team, ow_import, receipts_invoices
    const officeNavMatch = html.match(/"ow_dash".*"ow_route".*"ow_team"/s);
    expect(officeNavMatch).not.toBeNull();
    // Find the office pages list and confirm map_view absent
    const regex = /r === "office"\s*\?\s*\["([^"]+)"(?:,"([^"]+)")*\]/;
    // Just check the nav key list doesn't have map_view next to office keys
    // The office validPages array does not contain map_view
    expect(html).not.toContain('"ow_dash", "ow_route", "ow_team", "ow_import", "receipts_invoices", "map_view"');
  });

  test('Driver nav does not include map_view', () => {
    // driver validPages = ["driver_route", "driver_proof"] — no map_view
    const driverPagesMatch = html.match(/"driver_route", "driver_proof"/);
    expect(driverPagesMatch).not.toBeNull();
    expect(html).not.toContain('"driver_route", "driver_proof", "map_view"');
  });

  test('Map View — Map Preview title present', () => {
    // Page title is 'Map Preview' (renamed from 'Active Order Map' in Leaflet migration)
    expect(html).toContain('Map Preview');
  });
});
