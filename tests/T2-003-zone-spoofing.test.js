/**
 * T2-003: Zone Spoofing Prevention Tests
 *
 * Verifies that:
 * 1. Server determines zone from destination (not from client input)
 * 2. Signed tokens cannot be forged or tampered with
 * 3. Wrong zone in token is rejected (prevents pricing tier evasion)
 * 4. Expired tokens are rejected
 * 5. Missing tokens are rejected
 * 6. API endpoints work correctly
 */

'use strict';

const assert = require('assert');
const {
  resolveZone,
  generateZoneToken,
  verifyZoneToken,
  zoneValidationMiddleware,
  registerZoneRoutes,
  DEST_ZONE_MAP,
  ZONE_PRICING,
  TOKEN_TTL_MS,
} = require('../src/middleware/zone-validation');

const TEST_SECRET = 'test-secret-not-for-production';

// ─────────────────────────────────────────────────────────
// 1. Zone resolution (server-side)
// ─────────────────────────────────────────────────────────
describe('T2-003: Zone Spoofing Prevention', () => {

  describe('Server-side Zone Resolution', () => {

    test('should resolve known destinations to correct zones', () => {
      assert.strictEqual(resolveZone('Guatemala City'), 'green');
      assert.strictEqual(resolveZone('Antigua'),        'green');
      assert.strictEqual(resolveZone('Cobán'),          'yellow');
      assert.strictEqual(resolveZone('Puerto Barrios'), 'yellow');
      assert.strictEqual(resolveZone('Quetzaltenango'), 'blue');
      assert.strictEqual(resolveZone('Huehuetenango'),  'blue');
      assert.strictEqual(resolveZone('Petén'),          'red');
      assert.strictEqual(resolveZone('Zacapa'),         'red');
      assert.strictEqual(resolveZone('Alta Verapaz'),   'orange');
    });

    test('should return null for unknown destinations', () => {
      assert.strictEqual(resolveZone('Narnia'),         null);
      assert.strictEqual(resolveZone(''),               null);
      assert.strictEqual(resolveZone(null),             null);
      assert.strictEqual(resolveZone(undefined),        null);
    });

    test('should perform case-insensitive partial matching', () => {
      // "guatemala" → partial match for "Guatemala City"
      const zone = resolveZone('guatemala');
      assert(zone !== null, 'Partial match should work for "guatemala"');
    });

    test('should cover all zone tiers (green/yellow/blue/red/orange)', () => {
      const zones = new Set(Object.values(DEST_ZONE_MAP));
      assert(zones.has('green'),  'Must have green zone');
      assert(zones.has('yellow'), 'Must have yellow zone');
      assert(zones.has('blue'),   'Must have blue zone');
      assert(zones.has('red'),    'Must have red zone');
      assert(zones.has('orange'), 'Must have orange zone');
    });

    test('each zone should have a pricing tier', () => {
      for (const zone of ['green', 'yellow', 'blue', 'red', 'orange']) {
        const pricing = ZONE_PRICING[zone];
        assert(pricing,               `Zone "${zone}" must have pricing`);
        assert(pricing.tier > 0,      `Zone "${zone}" must have positive tier`);
        assert(pricing.label,         `Zone "${zone}" must have label`);
        assert(pricing.surcharge >= 0,`Zone "${zone}" surcharge must be >= 0`);
      }
    });

    test('higher zones should have higher surcharges (no pricing evasion benefit)', () => {
      // Ensure spoofing "green" from "red" would provide a benefit (why someone would try)
      assert(ZONE_PRICING['red'].surcharge > ZONE_PRICING['green'].surcharge,
        'Red zone must cost more than green zone');
      assert(ZONE_PRICING['orange'].surcharge >= ZONE_PRICING['red'].surcharge,
        'Orange zone must cost at least as much as red');
    });
  });

  // ─────────────────────────────────────────────────────────
  // 2. Token generation
  // ─────────────────────────────────────────────────────────
  describe('Zone Token Generation', () => {

    test('should generate a non-empty token', () => {
      const { token } = generateZoneToken('green', 'Guatemala City', TEST_SECRET);
      assert(token,          'Token must be non-empty');
      assert.strictEqual(typeof token, 'string');
    });

    test('different destinations should produce different tokens', () => {
      const { token: t1 } = generateZoneToken('green',  'Guatemala City', TEST_SECRET);
      const { token: t2 } = generateZoneToken('yellow', 'Cobán',          TEST_SECRET);
      assert.notStrictEqual(t1, t2, 'Tokens for different zones must differ');
    });

    test('token should be parseable base64url JSON', () => {
      const { token } = generateZoneToken('blue', 'Quetzaltenango', TEST_SECRET);
      const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
      assert(parsed.payload, 'Token must contain payload');
      assert(parsed.sig,     'Token must contain signature');
    });

    test('token payload must encode zone and destination', () => {
      const { token } = generateZoneToken('red', 'Petén', TEST_SECRET);
      const { payload } = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
      assert(payload.startsWith('red:'), 'Payload must start with zone');
      assert(payload.includes('Petén'),  'Payload must include destination');
    });
  });

  // ─────────────────────────────────────────────────────────
  // 3. Token verification — happy path
  // ─────────────────────────────────────────────────────────
  describe('Zone Token Verification — Valid Tokens', () => {

    test('should accept a freshly generated token', () => {
      const { token } = generateZoneToken('green', 'Guatemala City', TEST_SECRET);
      const result = verifyZoneToken(token, 'green', TEST_SECRET);
      assert.strictEqual(result.valid, true,    'Fresh token must be valid');
      assert.strictEqual(result.zone,  'green', 'Zone must match');
    });

    test('should verify token without zone expectation check', () => {
      const { token } = generateZoneToken('yellow', 'Cobán', TEST_SECRET);
      const result = verifyZoneToken(token, null, TEST_SECRET);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.zone, 'yellow');
    });
  });

  // ─────────────────────────────────────────────────────────
  // 4. Token verification — attack scenarios
  // ─────────────────────────────────────────────────────────
  describe('Zone Token Verification — Attack Rejection', () => {

    test('should reject missing token', () => {
      const result = verifyZoneToken(null, 'green', TEST_SECRET);
      assert.strictEqual(result.valid, false);
      assert(/missing/i.test(result.reason));
    });

    test('should reject empty token', () => {
      const result = verifyZoneToken('', 'green', TEST_SECRET);
      assert.strictEqual(result.valid, false);
    });

    test('should reject tampered token (bit-flip attack)', () => {
      const { token } = generateZoneToken('red', 'Zacapa', TEST_SECRET);
      // Flip a character in the token
      const tampered = token.slice(0, -4) + 'XXXX';
      const result = verifyZoneToken(tampered, 'red', TEST_SECRET);
      assert.strictEqual(result.valid, false, 'Tampered token must be rejected');
    });

    test('should reject token signed with different secret (cross-tenant attack)', () => {
      const { token } = generateZoneToken('green', 'Guatemala City', 'attacker-secret');
      const result = verifyZoneToken(token, 'green', TEST_SECRET);
      assert.strictEqual(result.valid, false, 'Wrong-secret token must be rejected');
      assert(/signature mismatch|malformed/i.test(result.reason));
    });

    test('should reject token where zone does not match destination (zone spoofing)', () => {
      // Attacker submits destination "Petén" (red) but claims zone is "green"
      // Server resolves "Petén" → "red", token zone = "green" → MISMATCH
      const { token } = generateZoneToken('green', 'Petén', TEST_SECRET);
      // Server resolves Petén → red, so expectedZone = red
      const result = verifyZoneToken(token, 'red', TEST_SECRET);
      assert.strictEqual(result.valid, false, 'Zone mismatch must be rejected');
      assert(/mismatch/i.test(result.reason), `Expected mismatch error, got: ${result.reason}`);
    });

    test('should reject expired tokens', () => {
      // Build a token with issuedAt far in the past
      const secret  = TEST_SECRET;
      const zone    = 'green';
      const dest    = 'Antigua';
      const ancient = Date.now() - (TOKEN_TTL_MS + 1000); // Just over TTL

      // Manually construct an expired token
      const payload  = `${zone}:${dest}:${ancient}`;
      const crypto   = require('crypto');
      const sig      = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const expToken = Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');

      const result = verifyZoneToken(expToken, zone, secret);
      assert.strictEqual(result.valid, false, 'Expired token must be rejected');
      assert(/expired/i.test(result.reason));
    });

    test('should reject completely fabricated tokens', () => {
      const fakeToken = Buffer.from(JSON.stringify({
        payload: 'green:Guatemala City:' + Date.now(),
        sig: 'deadbeef'.repeat(8) // Wrong signature
      })).toString('base64url');

      const result = verifyZoneToken(fakeToken, 'green', TEST_SECRET);
      assert.strictEqual(result.valid, false, 'Fabricated token must be rejected');
    });

    test('should reject non-base64url garbage', () => {
      const result = verifyZoneToken('not-a-valid-token-at-all!!!', 'green', TEST_SECRET);
      assert.strictEqual(result.valid, false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 5. Express middleware
  // ─────────────────────────────────────────────────────────
  describe('Zone Validation Middleware', () => {

    function makeReqRes(body = {}) {
      const req = { body, ip: '127.0.0.1' };
      const res = {
        _status: 200, _body: null,
        status(code) { this._status = code; return this; },
        json(data)   { this._body   = data; return this; }
      };
      return { req, res };
    }

    test('should call next() for valid zone token', (done) => {
      const { token } = generateZoneToken('green', 'Guatemala City', TEST_SECRET);
      const { req, res } = makeReqRes({ destination: 'Guatemala City', zoneToken: token });

      const middleware = zoneValidationMiddleware(TEST_SECRET);
      middleware(req, res, () => {
        assert.strictEqual(req.validatedZone, 'green');
        assert(req.validatedPricing,         'Pricing must be attached');
        done();
      });
    });

    test('should reject missing destination with 400', () => {
      const { req, res } = makeReqRes({ zoneToken: 'sometoken' });
      const middleware = zoneValidationMiddleware(TEST_SECRET);
      middleware(req, res, () => { throw new Error('should not reach next()'); });
      assert.strictEqual(res._status, 400);
    });

    test('should reject missing zoneToken with 400', () => {
      const { req, res } = makeReqRes({ destination: 'Guatemala City' });
      const middleware = zoneValidationMiddleware(TEST_SECRET);
      middleware(req, res, () => { throw new Error('should not reach next()'); });
      assert.strictEqual(res._status, 400);
    });

    test('should reject unknown destination with 400', () => {
      const { req, res } = makeReqRes({ destination: 'Narnia', zoneToken: 'x' });
      const middleware = zoneValidationMiddleware(TEST_SECRET);
      middleware(req, res, () => { throw new Error('should not reach next()'); });
      assert.strictEqual(res._status, 400);
    });

    test('should reject spoofed zone token with 403', () => {
      // Token says "green" but destination resolves to "red"
      const { token } = generateZoneToken('green', 'Petén', TEST_SECRET);
      const { req, res } = makeReqRes({ destination: 'Petén', zoneToken: token });
      const middleware = zoneValidationMiddleware(TEST_SECRET);
      middleware(req, res, () => { throw new Error('should not reach next()'); });
      assert.strictEqual(res._status, 403, 'Spoofed zone must be 403');
    });

    test('should reject invalid token signature with 403', () => {
      const { token } = generateZoneToken('green', 'Guatemala City', 'wrong-secret');
      const { req, res } = makeReqRes({ destination: 'Guatemala City', zoneToken: token });
      const middleware = zoneValidationMiddleware(TEST_SECRET);
      middleware(req, res, () => { throw new Error('should not reach next()'); });
      assert.strictEqual(res._status, 403);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 6. API endpoints
  // ─────────────────────────────────────────────────────────
  describe('Zone API Endpoints', () => {

    let server, port;

    beforeAll(async () => {
      const express = require('express');
      const http    = require('http');
      const app     = express();
      app.use(express.json());

      registerZoneRoutes(app, TEST_SECRET);

      server = http.createServer(app);
      await new Promise(resolve => server.listen(0, resolve));
      port = server.address().port;
    });

    afterAll(() => server && server.close());

    function httpGet(path) {
      const http = require('http');
      return new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}${path}`, res => {
          let body = '';
          res.on('data', c => (body += c));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        }).on('error', reject);
      });
    }

    test('GET /api/zones/validate returns zone and signed token', async () => {
      const { status, body } = await httpGet('/api/zones/validate?destination=Guatemala%20City');
      assert.strictEqual(status, 200);
      assert.strictEqual(body.zone,        'green');
      assert(body.zoneToken,               'Must return a zoneToken');
      assert(body.pricing,                 'Must return pricing');
      assert.strictEqual(body.pricing.tier, 1);
    });

    test('GET /api/zones/validate for remote destination returns higher tier', async () => {
      const { status, body } = await httpGet('/api/zones/validate?destination=Pet%C3%A9n');
      assert.strictEqual(status, 200);
      assert.strictEqual(body.zone,        'red');
      assert(body.pricing.surcharge > 0,   'Remote zone must have surcharge');
    });

    test('GET /api/zones/validate for unknown destination returns 404', async () => {
      const { status } = await httpGet('/api/zones/validate?destination=Narnia');
      assert.strictEqual(status, 404);
    });

    test('GET /api/zones/validate without destination returns 400', async () => {
      const { status } = await httpGet('/api/zones/validate');
      assert.strictEqual(status, 400);
    });

    test('GET /api/zones returns full destination list', async () => {
      const { status, body } = await httpGet('/api/zones');
      assert.strictEqual(status, 200);
      assert(Array.isArray(body.destinations), 'Must return destinations array');
      assert(body.destinations.length > 0,     'Must have at least one destination');
      // Verify structure
      const first = body.destinations[0];
      assert(first.destination, 'Each entry must have destination');
      assert(first.zone,        'Each entry must have zone');
      assert(first.pricing,     'Each entry must have pricing');
    });

    test('returned zoneToken should pass verification', async () => {
      const { body } = await httpGet('/api/zones/validate?destination=Antigua');
      const result = verifyZoneToken(body.zoneToken, 'green', TEST_SECRET);
      assert.strictEqual(result.valid, true, 'API-generated token must be verifiable');
      assert.strictEqual(result.zone,  'green');
    });
  });

});
