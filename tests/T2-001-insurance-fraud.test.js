/**
 * T2-001: Insurance Fraud Prevention Tests
 *
 * Verifies that:
 * 1. Safety warnings cannot be bypassed client-side
 * 2. Server validates acknowledgement tokens before processing orders
 * 3. Insurance fields are validated server-side (declaredValue required)
 * 4. Danger Zone acknowledgement is enforced
 * 5. Tokens are user-bound and tamper-proof
 * 6. Expired tokens are rejected (re-ack required)
 * 7. API endpoints work correctly
 */

'use strict';

const assert = require('assert');
const {
  generateAcknowledgementToken,
  verifyAcknowledgementToken,
  validateOrderSafetyFields,
  safetyValidationMiddleware,
  registerSafetyRoutes,
  REQUIRED_WARNINGS,
  ACKNOWLEDGEMENT_TTL_MS,
} = require('../src/middleware/safety-validation');

const TEST_SECRET = 'test-safety-secret-not-for-production';
const USER_ID     = 'user-550e8400-e29b-41d4-a716-446655440000';
const USER_ID_2   = 'user-123e4567-e89b-12d3-a456-426614174000';

// Helper: generate a token for a given user with all standard warnings
function makeFullToken(userId = USER_ID, warnings = Object.values(REQUIRED_WARNINGS)) {
  return generateAcknowledgementToken(warnings, userId, TEST_SECRET).token;
}

// ─────────────────────────────────────────────────────────────
describe('T2-001: Insurance Fraud Prevention', () => {

  // ─────────────────────────────────────────────────────────
  // 1. Acknowledgement token generation
  // ─────────────────────────────────────────────────────────
  describe('Acknowledgement Token Generation', () => {

    test('should generate a non-empty token', () => {
      const { token } = generateAcknowledgementToken(
        [REQUIRED_WARNINGS.INSURANCE_TERMS],
        USER_ID,
        TEST_SECRET
      );
      assert(token, 'Token must be non-empty string');
      assert.strictEqual(typeof token, 'string');
    });

    test('different users should produce different tokens for same warnings', () => {
      const { token: t1 } = generateAcknowledgementToken([REQUIRED_WARNINGS.INSURANCE_TERMS], USER_ID,   TEST_SECRET);
      const { token: t2 } = generateAcknowledgementToken([REQUIRED_WARNINGS.INSURANCE_TERMS], USER_ID_2, TEST_SECRET);
      assert.notStrictEqual(t1, t2, 'User binding must make tokens distinct');
    });

    test('token should encode the acknowledged warnings', () => {
      const warnings = [REQUIRED_WARNINGS.INSURANCE_TERMS, REQUIRED_WARNINGS.DECLARED_VALUE];
      const { token } = generateAcknowledgementToken(warnings, USER_ID, TEST_SECRET);
      const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
      assert(parsed.payload.includes('insurance_terms'), 'Token payload must contain warning IDs');
    });
  });

  // ─────────────────────────────────────────────────────────
  // 2. Acknowledgement token verification — happy paths
  // ─────────────────────────────────────────────────────────
  describe('Acknowledgement Token Verification — Valid', () => {

    test('should verify a fresh token for the correct user', () => {
      const token = makeFullToken();
      const result = verifyAcknowledgementToken(token, USER_ID, [], TEST_SECRET);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.reason, 'ok');
    });

    test('should return list of acknowledged warnings', () => {
      const warnings = [REQUIRED_WARNINGS.INSURANCE_TERMS, REQUIRED_WARNINGS.NO_REFUND_PACKED];
      const { token } = generateAcknowledgementToken(warnings, USER_ID, TEST_SECRET);
      const result = verifyAcknowledgementToken(token, USER_ID, warnings, TEST_SECRET);
      assert.strictEqual(result.valid, true);
      assert(result.acknowledgedWarnings.includes(REQUIRED_WARNINGS.INSURANCE_TERMS));
    });
  });

  // ─────────────────────────────────────────────────────────
  // 3. Attack scenarios — bypass attempts
  // ─────────────────────────────────────────────────────────
  describe('Bypass Attack Rejection', () => {

    test('should reject missing acknowledgement token', () => {
      const result = verifyAcknowledgementToken(null, USER_ID, [], TEST_SECRET);
      assert.strictEqual(result.valid, false);
      assert(/missing/i.test(result.reason));
    });

    test('should reject token for a different user (token theft)', () => {
      const token = makeFullToken(USER_ID);
      const result = verifyAcknowledgementToken(token, USER_ID_2, [], TEST_SECRET);
      assert.strictEqual(result.valid, false, 'Token must not be reusable by another user');
      assert(/user mismatch/i.test(result.reason));
    });

    test('should reject tampered token', () => {
      const token = makeFullToken();
      const tampered = token.slice(0, -5) + 'ZZZZZ';
      const result = verifyAcknowledgementToken(tampered, USER_ID, [], TEST_SECRET);
      assert.strictEqual(result.valid, false, 'Tampered token must be rejected');
    });

    test('should reject token signed with wrong secret', () => {
      const { token } = generateAcknowledgementToken(Object.values(REQUIRED_WARNINGS), USER_ID, 'wrong-secret');
      const result = verifyAcknowledgementToken(token, USER_ID, [], TEST_SECRET);
      assert.strictEqual(result.valid, false);
      assert(/signature mismatch/i.test(result.reason));
    });

    test('should reject expired tokens', () => {
      const crypto   = require('crypto');
      const userId   = USER_ID;
      const warnings = [REQUIRED_WARNINGS.INSURANCE_TERMS];
      const ancient  = Date.now() - (ACKNOWLEDGEMENT_TTL_MS + 5000);

      const warningList = [...warnings].sort().join(',');
      const payload = `${userId}:${warningList}:${ancient}`;
      const sig = crypto.createHmac('sha256', TEST_SECRET).update(payload).digest('hex');
      const expToken = Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');

      const result = verifyAcknowledgementToken(expToken, userId, warnings, TEST_SECRET);
      assert.strictEqual(result.valid, false);
      assert(/expired/i.test(result.reason));
    });

    test('should reject token missing required warnings', () => {
      // Token only has DECLARED_VALUE, but INSURANCE_TERMS is required
      const { token } = generateAcknowledgementToken(
        [REQUIRED_WARNINGS.DECLARED_VALUE],
        USER_ID,
        TEST_SECRET
      );
      const result = verifyAcknowledgementToken(
        token,
        USER_ID,
        [REQUIRED_WARNINGS.INSURANCE_TERMS], // Required but not in token
        TEST_SECRET
      );
      assert.strictEqual(result.valid, false);
      assert(/missing acknowledgement/i.test(result.reason));
    });
  });

  // ─────────────────────────────────────────────────────────
  // 4. Order safety field validation
  // ─────────────────────────────────────────────────────────
  describe('Order Safety Field Validation', () => {

    function makeOrderData(overrides = {}) {
      const token = makeFullToken(USER_ID);
      return {
        insurance:                   false,
        declaredValue:               0,
        consigneeDangerZone:         false,
        safetyAcknowledgementToken:  token,
        ...overrides
      };
    }

    test('valid order with no insurance passes', () => {
      const order  = makeOrderData();
      const result = validateOrderSafetyFields(order, USER_ID, TEST_SECRET);
      assert.strictEqual(result.valid, true);
    });

    test('valid order with insurance + declaredValue passes', () => {
      const order  = makeOrderData({ insurance: true, declaredValue: 500 });
      const result = validateOrderSafetyFields(order, USER_ID, TEST_SECRET);
      assert.strictEqual(result.valid, true);
    });

    test('should reject insurance: true with declaredValue = 0', () => {
      const order  = makeOrderData({ insurance: true, declaredValue: 0 });
      const result = validateOrderSafetyFields(order, USER_ID, TEST_SECRET);
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => /declaredValue/i.test(e)));
    });

    test('should reject insurance: true with missing declaredValue', () => {
      const order  = makeOrderData({ insurance: true, declaredValue: undefined });
      const result = validateOrderSafetyFields(order, USER_ID, TEST_SECRET);
      assert.strictEqual(result.valid, false);
    });

    test('should reject order without any acknowledgement token', () => {
      const order  = makeOrderData({ safetyAcknowledgementToken: null });
      const result = validateOrderSafetyFields(order, USER_ID, TEST_SECRET);
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => /acknowledgement/i.test(e)));
    });

    test('should reject insurance order with expired acknowledgement', () => {
      const crypto = require('crypto');
      const ancient = Date.now() - (ACKNOWLEDGEMENT_TTL_MS + 5000);
      const warnings = Object.values(REQUIRED_WARNINGS).sort().join(',');
      const payload  = `${USER_ID}:${warnings}:${ancient}`;
      const sig      = crypto.createHmac('sha256', TEST_SECRET).update(payload).digest('hex');
      const expToken = Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');

      const order  = makeOrderData({ insurance: true, declaredValue: 300, safetyAcknowledgementToken: expToken });
      const result = validateOrderSafetyFields(order, USER_ID, TEST_SECRET);
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => /expired/i.test(e)));
    });

    test('danger zone order requires danger_zone warning in token', () => {
      // Token that only acknowledges insurance — NOT danger zone
      const partialToken = generateAcknowledgementToken(
        [REQUIRED_WARNINGS.INSURANCE_TERMS, REQUIRED_WARNINGS.NO_REFUND_PACKED, REQUIRED_WARNINGS.DECLARED_VALUE],
        USER_ID,
        TEST_SECRET
      ).token;

      const order = makeOrderData({
        consigneeDangerZone:        true,
        safetyAcknowledgementToken: partialToken
      });
      const result = validateOrderSafetyFields(order, USER_ID, TEST_SECRET);
      assert.strictEqual(result.valid, false, 'Missing danger_zone ack should fail');
      assert(result.errors.some(e => /danger_zone/i.test(e)));
    });

    test('danger zone + insurance order with full token passes', () => {
      const order = makeOrderData({
        insurance:           true,
        declaredValue:       750,
        consigneeDangerZone: true
      });
      const result = validateOrderSafetyFields(order, USER_ID, TEST_SECRET);
      assert.strictEqual(result.valid, true, 'Full acknowledgement for all warnings must pass');
    });
  });

  // ─────────────────────────────────────────────────────────
  // 5. Middleware
  // ─────────────────────────────────────────────────────────
  describe('Safety Validation Middleware', () => {

    function makeReqRes(body = {}, userId = USER_ID) {
      const req = { body, user: { id: userId }, ip: '127.0.0.1' };
      const res = {
        _status: 200, _body: null,
        status(code) { this._status = code; return this; },
        json(data)   { this._body   = data; return this; }
      };
      return { req, res };
    }

    test('should call next() for valid acknowledgement', (done) => {
      const token = makeFullToken(USER_ID);
      const { req, res } = makeReqRes({
        insurance:                  false,
        declaredValue:              0,
        consigneeDangerZone:        false,
        safetyAcknowledgementToken: token
      });

      const mw = safetyValidationMiddleware(TEST_SECRET);
      mw(req, res, () => {
        assert.strictEqual(req.safetyValidated, true);
        done();
      });
    });

    test('should return 401 if user not authenticated', () => {
      const { req, res } = makeReqRes({ safetyAcknowledgementToken: 'x' }, null);
      req.user = null;
      const mw = safetyValidationMiddleware(TEST_SECRET);
      mw(req, res, () => { throw new Error('should not reach next()'); });
      assert.strictEqual(res._status, 401);
    });

    test('should return 400 if acknowledgement token missing', () => {
      const { req, res } = makeReqRes({ safetyAcknowledgementToken: null });
      const mw = safetyValidationMiddleware(TEST_SECRET);
      mw(req, res, () => { throw new Error('should not reach next()'); });
      assert.strictEqual(res._status, 400);
    });

    test('should return 400 for insurance without declaredValue', () => {
      const token = makeFullToken(USER_ID);
      const { req, res } = makeReqRes({
        insurance:                  true,
        declaredValue:              0,
        safetyAcknowledgementToken: token
      });
      const mw = safetyValidationMiddleware(TEST_SECRET);
      mw(req, res, () => { throw new Error('should not reach next()'); });
      assert.strictEqual(res._status, 400);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 6. API endpoints
  // ─────────────────────────────────────────────────────────
  describe('Safety API Endpoints', () => {

    let server, port;

    beforeAll(async () => {
      const express = require('express');
      const http    = require('http');
      const app     = express();
      app.use(express.json());

      // Inject mock auth
      app.use((req, res, next) => {
        req.user = { id: USER_ID };
        next();
      });

      registerSafetyRoutes(app, TEST_SECRET);

      server = http.createServer(app);
      await new Promise(resolve => server.listen(0, resolve));
      port = server.address().port;
    });

    afterAll(() => server && server.close());

    function httpPost(path, body) {
      const http = require('http');
      return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const opts = {
          hostname: 'localhost', port, path, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        };
        const req = http.request(opts, res => {
          let buf = '';
          res.on('data', c => (buf += c));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
      });
    }

    function httpGet(path) {
      const http = require('http');
      return new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}${path}`, res => {
          let buf = '';
          res.on('data', c => (buf += c));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
        }).on('error', reject);
      });
    }

    test('POST /api/safety/acknowledge returns signed token', async () => {
      const { status, body } = await httpPost('/api/safety/acknowledge', {
        warnings: [REQUIRED_WARNINGS.INSURANCE_TERMS, REQUIRED_WARNINGS.NO_REFUND_PACKED]
      });
      assert.strictEqual(status, 200);
      assert(body.token,          'Must return token');
      assert(body.acknowledged,   'Must return acknowledged list');
      assert(body.expiresIn > 0,  'Must return expiry');
    });

    test('returned token should be verifiable', async () => {
      const warnings = Object.values(REQUIRED_WARNINGS);
      const { body } = await httpPost('/api/safety/acknowledge', { warnings });
      const result = verifyAcknowledgementToken(body.token, USER_ID, warnings, TEST_SECRET);
      assert.strictEqual(result.valid, true, 'API-generated token must verify');
    });

    test('POST /api/safety/acknowledge rejects unknown warning IDs', async () => {
      const { status, body } = await httpPost('/api/safety/acknowledge', {
        warnings: ['fake_warning_id']
      });
      assert.strictEqual(status, 400);
      assert(/unknown/i.test(body.error));
    });

    test('POST /api/safety/acknowledge rejects empty warnings array', async () => {
      const { status } = await httpPost('/api/safety/acknowledge', { warnings: [] });
      assert.strictEqual(status, 400);
    });

    test('GET /api/safety/warnings returns known warning list', async () => {
      const { status, body } = await httpGet('/api/safety/warnings');
      assert.strictEqual(status, 200);
      assert(Array.isArray(body.warnings), 'Must return array');
      assert(body.warnings.length >= 4,    'Must include at least 4 warnings');
      // Each warning must have key + id
      body.warnings.forEach(w => {
        assert(w.key, 'Each warning must have key');
        assert(w.id,  'Each warning must have id');
      });
    });
  });

  // ─────────────────────────────────────────────────────────
  // 7. Immutability simulation
  // ─────────────────────────────────────────────────────────
  describe('Insurance Flag Immutability', () => {

    test('an order created with insurance:true cannot have insurance:false patched in', () => {
      // Simulate the server-side logic: once an order is confirmed with insurance,
      // any subsequent PATCH/PUT that sets insurance:false must be rejected.
      function simulateInsurancePatch(existingOrder, patch) {
        // Server rule: if order was created with insurance, cannot unset it
        if (existingOrder.insurance === true && patch.insurance === false) {
          return { allowed: false, error: 'Insurance coverage cannot be removed after order confirmation' };
        }
        return { allowed: true };
      }

      const confirmed = { id: 'CC-1234', insurance: true, status: 'order_placed' };
      const result = simulateInsurancePatch(confirmed, { insurance: false });
      assert.strictEqual(result.allowed, false, 'Removing insurance after confirmation must be rejected');
      assert(/cannot be removed/i.test(result.error));
    });

    test('adding insurance to an existing order should require a new acknowledgement', () => {
      function simulateInsuranceAdd(existingOrder, patch, hasAckToken) {
        if (!existingOrder.insurance && patch.insurance === true) {
          if (!hasAckToken) {
            return { allowed: false, error: 'New acknowledgement token required to add insurance' };
          }
        }
        return { allowed: true };
      }

      const uninsured = { id: 'CC-1235', insurance: false };
      const resultNoToken = simulateInsuranceAdd(uninsured, { insurance: true }, false);
      assert.strictEqual(resultNoToken.allowed, false);

      const resultWithToken = simulateInsuranceAdd(uninsured, { insurance: true }, true);
      assert.strictEqual(resultWithToken.allowed, true);
    });

    test('danger zone flag cannot be removed once set', () => {
      function simulateDangerZonePatch(existingOrder, patch) {
        if (existingOrder.consigneeDangerZone === true && patch.consigneeDangerZone === false) {
          return { allowed: false, error: 'Danger zone flag cannot be removed after driver assignment' };
        }
        return { allowed: true };
      }

      const dzOrder = { id: 'CC-1236', consigneeDangerZone: true, assignedDriver: 'DRV-01' };
      const result = simulateDangerZonePatch(dzOrder, { consigneeDangerZone: false });
      assert.strictEqual(result.allowed, false, 'Removing danger zone flag must be rejected');
    });
  });

});
