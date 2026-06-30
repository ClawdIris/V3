/**
 * Slice 3: DriverRoutePage uses Google Maps (migrated from Leaflet/OSM)
 */
const fs = require('fs');
const path = require('path');

describe('Slice 3 — DriverRoutePage Google Maps', () => {
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

  test('DriverRoutePage: references map ref (_drMapRef)', () => {
    expect(drBlock).toContain('_drMapRef');
  });

  test('DriverRoutePage: uses google.maps.Map instance', () => {
    expect(drBlock).toContain('gmaps.Map');
    expect(drBlock).toContain('_drMapInstRef');
  });

  test('DriverRoutePage: has driver-route-google-map container id', () => {
    expect(drBlock).toContain('driver-route-google-map');
  });

  test('DriverRoutePage: does NOT use OSM tiles (Leaflet removed)', () => {
    expect(drBlock).not.toContain('openstreetmap.org');
  });

  test('DriverRoutePage: fitBounds called for stops', () => {
    expect(drBlock).toContain('fitBounds');
  });

  test('global html: Leaflet CDN fully removed', () => {
    expect(html).not.toContain('leaflet@');
  });

  test('global html: Google Maps lazy loader present', () => {
    expect(html).toContain('function initGoogleMaps');
  });
});
