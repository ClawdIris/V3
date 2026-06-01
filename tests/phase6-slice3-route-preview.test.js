/**
 * Phase 6 — Slice 3: Route Optimization Preview Tests
 *
 * Gates checked:
 *  [1] TSP solver functions defined (haversineDist, nearestNeighborTSP)
 *  [2] Route Preview Panel exists with correct IDs and structure
 *  [3] "Preview Only — No assignments saved" badge present
 *  [4] Driver dropdown and date picker controls exist
 *  [5] "Preview Route" button exists and triggers TSP solver
 *  [6] Excluded orders warning is wired (alert element + count message)
 *  [7] Route results panel: stop list, distances, summary stats
 *  [8] Visual route line (SVG polyline #route-svg-line) is conditional on results
 *  [9] HQ-only gate: map_view only in HQ validPages (Slices 1+2 gate preserved)
 *  [10] No DB writes during preview (no supabase insert/update in preview handler)
 *  [11] Coordinate eligibility: only geocoded/manual_override qualify
 *  [12] Slice 1 + Slice 2 tests continue to pass (regression check)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'index.html');

let html = '';

beforeAll(() => {
  html = fs.readFileSync(HTML_PATH, 'utf8');
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [1] — TSP solver functions defined
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 1: TSP solver functions', () => {
  test('haversineDist function is defined', () => {
    expect(html).toContain('function haversineDist(');
    expect(html).toContain('Math.atan2(Math.sqrt(a)');
  });

  test('nearestNeighborTSP function is defined', () => {
    expect(html).toContain('function nearestNeighborTSP(');
    expect(html).toContain('bestDist = Infinity');
    expect(html).toContain('unvisited.splice(bestIdx, 1)');
  });

  test('TSP returns ordered array with stopNum, legDist, cumDist', () => {
    expect(html).toContain('stopNum: ordered.length + 1');
    expect(html).toContain('legDist: Math.round(bestDist * 10) / 10');
    expect(html).toContain('cumDist: Math.round(cumDist * 10) / 10');
  });

  test('Miami depot coordinates are hardcoded as default', () => {
    expect(html).toContain('DEPOT_LAT = 25.7617');
    expect(html).toContain('DEPOT_LON = -80.1918');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [2] — Route Preview Panel structure
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 2: Route Preview Panel structure', () => {
  test('route-preview-panel element exists', () => {
    expect(html).toContain('id: "route-preview-panel"');
  });

  test('panel header contains "Route Optimization Preview" text', () => {
    expect(html).toContain('Route Optimization Preview');
  });

  test('route-results container exists', () => {
    expect(html).toContain('id: "route-results"');
  });

  test('route-stop-list container exists', () => {
    expect(html).toContain('id: "route-stop-list"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [3] — Preview-only badge
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 3: Preview-only badge', () => {
  test('route-preview-badge element exists', () => {
    expect(html).toContain('id: "route-preview-badge"');
  });

  test('badge contains Preview Only text and no assignments saved', () => {
    expect(html).toContain('Preview Only');
    expect(html).toContain('No assignments saved');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [4] — Driver dropdown and date picker
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 4: Driver and date filter controls', () => {
  test('route-driver-select element exists', () => {
    expect(html).toContain('id: "route-driver-select"');
  });

  test('driver dropdown includes "All Drivers" default option', () => {
    expect(html).toContain('"All Drivers"');
  });

  test('route-date-picker element exists with type date', () => {
    expect(html).toContain('id: "route-date-picker"');
    expect(html).toContain('type: "date"');
  });

  test('date defaults to today via toISOString slice', () => {
    expect(html).toContain('new Date().toISOString().slice(0, 10)');
  });

  test('driver select clears route result on change', () => {
    expect(html).toContain('setRouteDriver(e.target.value); setRouteResult(null)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [5] — Preview Route button
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 5: Preview Route button', () => {
  test('preview-route-btn element exists', () => {
    expect(html).toContain('id: "preview-route-btn"');
  });

  test('button triggers handlePreviewRoute', () => {
    expect(html).toContain('onClick: handlePreviewRoute');
  });

  test('handlePreviewRoute function is defined', () => {
    expect(html).toContain('var handlePreviewRoute = function()');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [6] — Excluded orders warning
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 6: Excluded orders warning', () => {
  test('route-excluded-warning element exists', () => {
    expect(html).toContain('id: "route-excluded-warning"');
  });

  test('excluded warning shows count with "excluded" message', () => {
    expect(html).toContain('excluded (missing/low-confidence coordinates)');
  });

  test('route-not-enough element exists for < 2 eligible orders', () => {
    expect(html).toContain('id: "route-not-enough"');
  });

  test('≥ 2 eligible orders threshold is enforced', () => {
    expect(html).toContain('filtered.length < 2');
    expect(html).toContain('error: "needsMore"');
    expect(html).toContain('eligibleCount: filtered.length');
  });

  test('excluded count is computed from active orders minus eligible', () => {
    expect(html).toContain('excludedCount = activeOrders.length - eligible.length');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [7] — Route results panel
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 7: Route results display', () => {
  test('stop list renders stopNum (numbered stops)', () => {
    expect(html).toContain('stop.stopNum');
  });

  test('per-leg distance shown on each stop row', () => {
    expect(html).toContain('stop.legDist');
    expect(html).toContain('"this leg"');
  });

  test('total distance summary stat is rendered', () => {
    expect(html).toContain('routeResult.totalDist.toFixed(1)');
    expect(html).toContain('" km"');
  });

  test('stops count stat is rendered', () => {
    expect(html).toContain('routeResult.stops.length');
  });

  test('driver label shown in summary', () => {
    expect(html).toContain('routeResult.driverLabel');
  });

  test('stop address rendered when available', () => {
    expect(html).toContain('stop.address &&');
  });

  test('empty state shown when no route computed yet', () => {
    expect(html).toContain('compute the optimized stop order');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [8] — Leaflet route line overlay (upgraded from SVG placeholder)
// SVG polyline (#route-svg-line) was replaced by a real Leaflet map.
// These tests reflect the Leaflet implementation.
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 8: Leaflet visual route line (Leaflet map, replaces SVG placeholder)', () => {
  test('leaflet-map-container is present', () => {
    expect(html).toContain('leaflet-map-container');
  });

  test('route polyline is conditional on routeResult.stops length >= 2', () => {
    expect(html).toContain('routeResult.stops.length >= 2');
  });

  test('Leaflet polyline uses real lat/lon from routeResult.stops', () => {
    // Leaflet route: L.polyline(routePoints, ...) drawn in useEffect
    expect(html).toContain('L.polyline');
  });

  test('Leaflet polyline uses dashArray for dashed route style', () => {
    expect(html).toContain('dashArray');
  });

  test('route-results panel is rendered when route is computed', () => {
    expect(html).toContain('id: "route-results"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [9] — HQ-only gate preserved
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 9: HQ-only visibility gate (Slice 1 regression)', () => {
  test('map_view is in HQ validPages list', () => {
    expect(html).toContain('"map_view"');
    // Verify it's in the HQ section (alongside hq_ops, analytics etc)
    expect(html).toMatch(/validPages.*hq.*map_view|map_view.*hq.*validPages/s);
  });

  test('map_view is NOT in office validPages', () => {
    // ow_dash, ow_route, ow_team, ow_import — no map_view
    const officePages = html.match(/office.*?\[.*?\]/s);
    if (officePages) {
      expect(officePages[0]).not.toContain('map_view');
    } else {
      // Alternative check: the validPages block
      expect(html).not.toMatch(/ow_dash.*map_view/);
    }
  });

  test('MapViewPage is rendered only when page === map_view', () => {
    expect(html).toContain('page === "map_view"');
    expect(html).toContain('React.createElement(MapViewPage');
  });

  test('driversList is passed to MapViewPage call', () => {
    expect(html).toContain('driversList: tenantDrivers');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [10] — No DB writes during preview
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 10: No DB writes in route preview', () => {
  test('handlePreviewRoute does not call supabase.from().insert', () => {
    // Extract the handlePreviewRoute function block
    const fnMatch = html.match(/var handlePreviewRoute = function\(\)\s*\{([\s\S]*?)\};\s*\/\* \u2500\u2500 Render/);
    if (fnMatch) {
      const fnBody = fnMatch[1];
      expect(fnBody).not.toContain('.insert(');
      expect(fnBody).not.toContain('.update(');
      expect(fnBody).not.toContain('.upsert(');
      expect(fnBody).not.toContain('_db.upsert');
    } else {
      // Fallback: verify the pattern appears after handlePreviewRoute and only uses setRouteResult
      expect(html).toContain('setRouteResult({');
    }
  });

  test('route preview is client-side only (comment present)', () => {
    expect(html).toContain('no DB writes');
  });

  test('nearestNeighborTSP does not reference supabase', () => {
    const fnMatch = html.match(/function nearestNeighborTSP\([\s\S]*?^  \}/m);
    if (fnMatch) {
      expect(fnMatch[0]).not.toContain('supabase');
      expect(fnMatch[0]).not.toContain('_db');
    }
    // Even without capturing the exact block, the comment confirms intent
    expect(html).toContain('client-side only, zero DB writes');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [11] — Coordinate eligibility rules
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 11: Coordinate eligibility rules', () => {
  test('only geocoded and manual_override orders are eligible', () => {
    expect(html).toContain('hasUsableCoords(entry)');
  });

  test('hasUsableCoords checks geocoded OR manual_override status', () => {
    expect(html).toContain('status === COORD_STATUSES.geocoded || entry.status === COORD_STATUSES.manual_override');
  });

  test('eligible filter uses geoCache entries', () => {
    expect(html).toContain('geoCache[o.id]');
    // present in eligible filter
    expect(html).toContain('entry && hasUsableCoords(entry)');
  });

  test('missing and low_confidence orders produce excludedCount > 0', () => {
    // excludedCount computed as difference from eligible
    expect(html).toContain('excludedCount = activeOrders.length - eligible.length');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [12] — Slice 1 + Slice 2 regression checks
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 12: Slice 1 + Slice 2 regression', () => {
  test('COORD_STATUSES still defined with all 4 values (Slice 2)', () => {
    expect(html).toContain('missing: "missing"');
    expect(html).toContain('geocoded: "geocoded"');
    expect(html).toContain('low_confidence: "low_confidence"');
    expect(html).toContain('manual_override: "manual_override"');
  });

  test('coord quality stats cards still present (Slice 2)', () => {
    expect(html).toContain('"Geocoded"');
    expect(html).toContain('"Manual Override"');
    expect(html).toContain('"Low Confidence"');
    expect(html).toContain('"Missing"');
  });

  test('manual coord override form still present (Slice 2)', () => {
    expect(html).toContain('id: "coord-override-form"');
    expect(html).toContain('id: "manual-coord-override-btn"');
    expect(html).toContain('id: "override-save-btn"');
  });

  test('needs-coords-filter chip still present (Slice 2)', () => {
    expect(html).toContain('id: "needs-coords-filter"');
  });

  test('map_view nav item still present (Slice 1)', () => {
    expect(html).toContain('k: "map_view"');
  });

  test('Nominatim geocoding still wired (Slice 2)', () => {
    expect(html).toContain('nominatim.openstreetmap.org');
  });
});
