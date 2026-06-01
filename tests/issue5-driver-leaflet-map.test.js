/**
 * Issue 5: DriverRoutePage uses real Leaflet map (not map-ph/map-grid placeholder)
 */
const fs = require('fs');
const path = require('path');

describe('Issue 5 — DriverRoutePage Leaflet map', () => {
  let html;
  let drBlock;

  beforeAll(() => {
    html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    // Extract only the DriverRoutePage function block
    const drStart = html.indexOf('var DriverRoutePage = function DriverRoutePage');
    const drEnd = html.indexOf('\nvar ', drStart + 200);
    drBlock = html.slice(drStart, drEnd);
  });

  test('DriverRoutePage: does NOT use map-ph class', () => {
    expect(drBlock).not.toContain('map-ph');
  });

  test('DriverRoutePage: does NOT use map-grid class', () => {
    expect(drBlock).not.toContain('map-grid');
  });

  test('DriverRoutePage: references Leaflet map ref (_drMapRef)', () => {
    expect(drBlock).toContain('_drMapRef');
  });

  test('DriverRoutePage: references L.map or _drMapInstRef for Leaflet instance', () => {
    expect(drBlock).toContain('_drMapInstRef');
  });

  test('DriverRoutePage: has driver-route-leaflet-map container id', () => {
    expect(drBlock).toContain('driver-route-leaflet-map');
  });

  test('DriverRoutePage: uses OSM tile URL', () => {
    expect(drBlock).toContain('openstreetmap.org');
  });

  test('DriverRoutePage: fitBounds called for stops', () => {
    expect(drBlock).toContain('fitBounds');
  });

  test('global html: Leaflet CDN loaded', () => {
    expect(html).toContain('leaflet@');
  });
});
