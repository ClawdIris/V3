/**
 * routes-slice4-5.test.js — Slice 4 (optimize/assign) + Slice 5 (cleanup) gates.
 * Static assertions over index.html (Jest). Live behavior is covered by
 * authenticated-render.spec.js + ShipmentTester.
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

describe('Slice 4 — live optimization + assignment', () => {
  test('Optimize Route button + handler wired to optimize-route EF', () => {
    expect(html).toContain('optimize-route-btn');
    expect(html).toContain('handleOptimizeRoute');
    expect(html).toContain('functions.invoke("optimize-route"');
  });

  test('Assign to driver button + handler wired to assign-route EF', () => {
    expect(html).toContain('assign-route-btn');
    expect(html).toContain('handleAssignRoute');
    expect(html).toContain('functions.invoke("assign-route"');
  });

  test('creates a draft routes row before optimizing', () => {
    expect(html).toContain('.from("routes").insert');
  });

  test('Q1 hard rule: NO nearest-neighbor fallback in live optimize (error surfaced instead)', () => {
    // handleOptimizeRoute must not call nearestNeighborTSP
    const start = html.indexOf('var handleOptimizeRoute');
    const end = html.indexOf('var handleAssignRoute');
    const block = html.slice(start, end);
    expect(block).not.toContain('nearestNeighborTSP');
    expect(block).toContain('Please retry');
  });

  test('Tape Direct fixed origin (3801 White Plains Rd), never a waypoint', () => {
    expect(html).toContain('TAPE_DIRECT_ORIGIN');
    expect(html).toContain('3801 White Plains Rd, Bronx, NY 10467');
  });

  test('messaging-unavailable banner shown after assignment (A2P fence)', () => {
    expect(html).toContain('messaging not yet approved');
  });

  test('Open in Google Maps deep link on assignment + 23-stop warning', () => {
    expect(html).toContain('open-google-maps');
    expect(html).toContain('23 stops');
  });

  test('driver selector uses UUID (userId), not name-string', () => {
    expect(html).toContain('d.userId || d.user_id');
  });
});

describe('Slice 5 — cleanup acceptance', () => {
  test('no Nominatim/OSM/Leaflet NETWORK calls (comments allowed)', () => {
    expect(html).not.toContain('nominatim.openstreetmap.org');
    expect(html).not.toContain('unpkg.com/leaflet');
    expect(html).not.toContain('tile.openstreetmap');
  });

  test('Google Maps is the map engine', () => {
    expect(html).toContain('google-map-container');
    expect(html).toContain('function initGoogleMaps');
  });
});
