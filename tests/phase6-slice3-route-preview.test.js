/**
 * phase6-slice3-route-preview.test.js — RETIRED (Slice 5).
 *
 * The client-side "Preview Route" + nearest-neighbor TSP feature this file used to
 * cover was REMOVED in Slice 5 (replaced by live Google Routes API optimization in
 * Slice 4). Live optimize/assign behavior is now covered by:
 *   - tests/routes-slice4-5.test.js        (static wiring + Q1 no-fallback rule)
 *   - tests/authenticated-render.spec.js   (per-role render, no white screen)
 *   - ShipmentTester                       (end-to-end across the 24 cases)
 *
 * This file is kept as a guard that the legacy preview path stays removed.
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

describe('Slice 5 — legacy Preview Route / TSP removal guard', () => {
  test('nearestNeighborTSP solver removed', () => {
    expect(html).not.toContain('function nearestNeighborTSP(');
  });

  test('Preview Route button removed', () => {
    expect(html).not.toContain('id: "preview-route-btn"');
  });

  test('"Preview Only" route badge removed', () => {
    // The route panel badge "Preview Only — No assignments saved" is gone.
    // (An unrelated messaging "Stage 1 — Preview Only" string may still exist.)
    expect(html).not.toContain('Preview Only \u2014 No assignments saved');
    expect(html).not.toContain('Preview Only — No assignments saved');
  });

  test('live Optimize Route button + handler present (Slice 4 replacement)', () => {
    expect(html).toContain('id: "optimize-route-btn"');
    expect(html).toContain('onClick: handleOptimizeRoute');
  });

  test('optimization uses the Google Routes API Edge Function, no client-side fallback', () => {
    expect(html).toContain('functions.invoke("optimize-route"');
    // handleOptimizeRoute block must not reference the removed TSP solver
    const start = html.indexOf('var handleOptimizeRoute');
    const end = html.indexOf('var handleAssignRoute');
    expect(html.slice(start, end)).not.toContain('nearestNeighborTSP');
  });
});
