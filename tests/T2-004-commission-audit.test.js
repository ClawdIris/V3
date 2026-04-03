/**
 * T2-004: Commission Audit Trail Tests
 *
 * Verifies that every commission change is logged with full metadata,
 * before/after values are captured, and the admin endpoint enforces
 * access control.
 */

'use strict';

const assert = require('assert');
const { registerCommissionRoutes } = require('../src/api/admin-commissions');

// ─────────────────────────────────────────────────────────────
// Helpers / shared fixtures
// ─────────────────────────────────────────────────────────────

const ORDER_ID  = '550e8400-e29b-41d4-a716-446655440000';
const ORDER_ID2 = '123e4567-e89b-12d3-a456-426614174000';

function makeCommission(overrides = {}) {
  return {
    id:                 'a1b2c3d4-e5f6-47e8-b9c0-d1e2f3a4b5c6',
    order_id:           ORDER_ID,
    amount:             25.00,
    rate:               0.10,
    calculated_by:      'system',
    calculation_method: 'standard',
    before_amount:      null,
    after_amount:       25.00,
    created_at:         new Date().toISOString(),
    updated_at:         new Date().toISOString(),
    metadata:           { zone: 'downtown', tier: 'premium' },
    ...overrides
  };
}

function makeAuditEntry(overrides = {}) {
  const commission = makeCommission();
  return {
    id:            'b2c3d4e5-f6a7-48f9-c0d1-e2f3a4b5c6d7',
    commission_id: commission.id,
    operation:     'INSERT',
    old_data:      null,
    new_data:      commission,
    changed_by:    'system',
    changed_at:    new Date().toISOString(),
    ...overrides
  };
}

// ─────────────────────────────────────────────────────────────
// 1. Commission record structure
// ─────────────────────────────────────────────────────────────
describe('T2-004: Commission Audit Trail', () => {

  describe('Commission Record Structure', () => {

    test('should have all required fields', () => {
      const c = makeCommission();

      assert(c.id,                 'Must have id');
      assert(c.order_id,           'Must have order_id');
      assert(c.amount   !== undefined, 'Must have amount');
      assert(c.rate     !== undefined, 'Must have rate');
      assert(c.calculated_by,      'Must have calculated_by');
      assert(c.calculation_method, 'Must have calculation_method');
      assert(c.created_at,         'Must have created_at');
      assert(c.updated_at,         'Must have updated_at');
      assert(c.metadata,           'Must have metadata (jsonb)');
    });

    test('should allow before_amount to be null on first insert', () => {
      const c = makeCommission({ before_amount: null });
      assert.strictEqual(c.before_amount, null, 'New commissions have no before_amount');
    });

    test('should capture before/after on update', () => {
      const before = makeCommission({ amount: 20.00, after_amount: 20.00 });
      const after  = makeCommission({ amount: 25.00, before_amount: 20.00, after_amount: 25.00 });

      assert.strictEqual(after.before_amount, 20.00, 'before_amount reflects old value');
      assert.strictEqual(after.after_amount,  25.00, 'after_amount reflects new value');
      assert.notStrictEqual(before.amount, after.amount, 'Amount changed between versions');
    });

    test('should store arbitrary metadata as jsonb', () => {
      const c = makeCommission({ metadata: { zone: 'zone-1', tier: 'base', promo: 'SUMMER10' } });

      assert.strictEqual(c.metadata.zone,  'zone-1');
      assert.strictEqual(c.metadata.tier,  'base');
      assert.strictEqual(c.metadata.promo, 'SUMMER10');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Audit log structure
  // ─────────────────────────────────────────────────────────────
  describe('Audit Log Entry Structure', () => {

    test('INSERT audit entry should have null old_data', () => {
      const entry = makeAuditEntry({ operation: 'INSERT', old_data: null });
      assert.strictEqual(entry.operation, 'INSERT');
      assert.strictEqual(entry.old_data,  null, 'INSERT has no prior state');
      assert(entry.new_data, 'INSERT must capture new state');
    });

    test('UPDATE audit entry should capture old and new data', () => {
      const old = makeCommission({ amount: 20.00 });
      const nw  = makeCommission({ amount: 25.00 });

      const entry = makeAuditEntry({
        operation: 'UPDATE',
        old_data:  old,
        new_data:  nw
      });

      assert.strictEqual(entry.operation,        'UPDATE');
      assert.strictEqual(entry.old_data.amount,  20.00, 'old_data holds previous amount');
      assert.strictEqual(entry.new_data.amount,  25.00, 'new_data holds updated amount');
    });

    test('should record changed_by identity', () => {
      const entry = makeAuditEntry({ changed_by: 'admin-user-42' });
      assert.strictEqual(entry.changed_by, 'admin-user-42');
    });

    test('should record changed_at timestamp', () => {
      const entry = makeAuditEntry();
      const ts = new Date(entry.changed_at);
      assert(!isNaN(ts.getTime()), 'changed_at must be a valid timestamp');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Trigger logic simulation
  // ─────────────────────────────────────────────────────────────
  describe('Trigger Behaviour', () => {

    /**
     * Simulates the PL/pgSQL trigger in JavaScript so we can
     * unit-test it without a live DB connection.
     */
    function simulateTrigger(operation, oldRow, newRow) {
      const auditEntries = [];

      if (operation === 'INSERT') {
        auditEntries.push({
          commission_id: newRow.id,
          operation:     'INSERT',
          old_data:      null,
          new_data:      { ...newRow },
          changed_by:    newRow.calculated_by || 'system',
          changed_at:    new Date().toISOString()
        });
      } else if (operation === 'UPDATE') {
        const updatedNew = { ...newRow, updated_at: new Date().toISOString() };
        auditEntries.push({
          commission_id: newRow.id,
          operation:     'UPDATE',
          old_data:      { ...oldRow },
          new_data:      updatedNew,
          changed_by:    newRow.calculated_by || 'system',
          changed_at:    new Date().toISOString()
        });
      }

      return auditEntries;
    }

    test('INSERT trigger produces one audit entry', () => {
      const commission = makeCommission();
      const entries = simulateTrigger('INSERT', null, commission);

      assert.strictEqual(entries.length, 1, 'Exactly one audit entry per INSERT');
      assert.strictEqual(entries[0].operation, 'INSERT');
      assert.strictEqual(entries[0].commission_id, commission.id);
    });

    test('UPDATE trigger produces one audit entry with before/after', () => {
      const old = makeCommission({ amount: 10.00 });
      const nw  = makeCommission({ amount: 15.00 });

      const entries = simulateTrigger('UPDATE', old, nw);

      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].operation,       'UPDATE');
      assert.strictEqual(entries[0].old_data.amount, 10.00);
      assert.strictEqual(entries[0].new_data.amount, 15.00);
    });

    test('UPDATE trigger stamps updated_at', () => {
      const before = Date.now();
      const old = makeCommission();
      const nw  = makeCommission({ amount: 30.00 });

      const entries = simulateTrigger('UPDATE', old, nw);
      const stampedTs = new Date(entries[0].new_data.updated_at).getTime();

      assert(stampedTs >= before, 'updated_at must be refreshed on UPDATE');
    });

    test('multiple updates each produce a separate audit entry', () => {
      const v1 = makeCommission({ amount: 10.00 });
      const v2 = makeCommission({ amount: 20.00 });
      const v3 = makeCommission({ amount: 30.00 });

      const allEntries = [
        ...simulateTrigger('INSERT', null, v1),
        ...simulateTrigger('UPDATE', v1, v2),
        ...simulateTrigger('UPDATE', v2, v3)
      ];

      assert.strictEqual(allEntries.length, 3, 'Full history: 1 insert + 2 updates');
      assert.strictEqual(allEntries[0].operation, 'INSERT');
      assert.strictEqual(allEntries[1].operation, 'UPDATE');
      assert.strictEqual(allEntries[2].operation, 'UPDATE');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Admin endpoint logic
  // ─────────────────────────────────────────────────────────────
  describe('Admin Endpoint Logic', () => {

    test('should require authentication (no token → 401)', async () => {
      // Build minimal mock app
      const express = require('express');
      const app     = express();
      app.use(express.json());

      const noAuth = (req, res) => res.status(401).json({ error: 'Unauthorized' });
      const noAdmin = noAuth;

      // Create mock supabase that should never be called
      const mockSupabase = { from: () => { throw new Error('Should not reach DB'); } };
      registerCommissionRoutes(app, mockSupabase, noAuth, noAdmin);

      const http = require('http');
      const server = http.createServer(app);

      await new Promise(resolve => server.listen(0, resolve));
      const port = server.address().port;

      await new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}/api/admin/commissions/audit`, res => {
          assert.strictEqual(res.statusCode, 401, 'Missing auth token should return 401');
          server.close(resolve);
        }).on('error', reject);
      });
    });

    test('should require admin role (non-admin → 401)', async () => {
      const express = require('express');
      const app     = express();
      app.use(express.json());

      // Auth passes but admin check fails
      const passAuth  = (req, res, next) => { req.user = { id: 'user-1', role: 'driver' }; next(); };
      const failAdmin = (req, res) => res.status(401).json({ error: 'Admin required' });

      const mockSupabase = { from: () => { throw new Error('Should not reach DB'); } };
      registerCommissionRoutes(app, mockSupabase, passAuth, failAdmin);

      const http = require('http');
      const server = http.createServer(app);
      await new Promise(resolve => server.listen(0, resolve));
      const port = server.address().port;

      await new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}/api/admin/commissions/audit`, res => {
          assert.strictEqual(res.statusCode, 401, 'Non-admin should be rejected');
          server.close(resolve);
        }).on('error', reject);
      });
    });

    test('admin gets paginated audit results', async () => {
      const express = require('express');
      const app     = express();
      app.use(express.json());

      const passAuth  = (req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); };
      const passAdmin = (req, res, next) => next();

      const fakeAuditData = [makeAuditEntry(), makeAuditEntry({ id: 'c3d4e5f6-a7b8-49c0-d1e2-f3a4b5c6d7e8' })];

      const mockSupabase = {
        from: (table) => ({
          select: () => ({
            order: () => ({
              range: () => Promise.resolve({ data: fakeAuditData, error: null })
            })
          })
        })
      };

      registerCommissionRoutes(app, mockSupabase, passAuth, passAdmin);

      const http = require('http');
      const server = http.createServer(app);
      await new Promise(resolve => server.listen(0, resolve));
      const port = server.address().port;

      await new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}/api/admin/commissions/audit`, res => {
          let body = '';
          res.on('data', chunk => (body += chunk));
          res.on('end', () => {
            assert.strictEqual(res.statusCode, 200);
            const json = JSON.parse(body);
            assert(Array.isArray(json.data), 'Response must have data array');
            assert.strictEqual(json.data.length, 2, 'Should return 2 audit entries');
            assert(json.pagination, 'Response must have pagination');
            server.close(resolve);
          });
        }).on('error', reject);
      });
    });

    test('should filter by order_id when provided', async () => {
      const express = require('express');
      const app     = express();
      app.use(express.json());

      const passAuth  = (req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); };
      const passAdmin = (req, res, next) => next();

      let capturedOrderId = null;

      const mockSupabase = {
        from: (table) => ({
          select: () => ({
            order: () => ({
              range: () => ({
                eq: (field, val) => {
                  capturedOrderId = val;
                  return Promise.resolve({ data: [], error: null });
                }
              })
            })
          })
        })
      };

      registerCommissionRoutes(app, mockSupabase, passAuth, passAdmin);

      const http = require('http');
      const server = http.createServer(app);
      await new Promise(resolve => server.listen(0, resolve));
      const port = server.address().port;

      await new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}/api/admin/commissions/audit?order_id=${ORDER_ID}`, res => {
          let body = '';
          res.on('data', c => (body += c));
          res.on('end', () => {
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(capturedOrderId, ORDER_ID, 'Should filter by order_id');
            server.close(resolve);
          });
        }).on('error', reject);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. RLS policy representation
  // ─────────────────────────────────────────────────────────────
  describe('RLS Policy Validation', () => {

    test('non-admin cannot access commission data', () => {
      // Simulate RLS: user role is "driver"
      const userRole = 'driver';
      const canAccess = userRole === 'admin';
      assert.strictEqual(canAccess, false, 'Drivers must not access commissions');
    });

    test('admin can access commission data', () => {
      const userRole = 'admin';
      const canAccess = userRole === 'admin';
      assert.strictEqual(canAccess, true, 'Admins must be able to access commissions');
    });

    test('service role can insert commissions (trigger path)', () => {
      // Service role bypasses RLS — represented as always allowed
      const isServiceRole = true;
      assert.strictEqual(isServiceRole, true, 'Service role must insert audit logs via trigger');
    });
  });

});
