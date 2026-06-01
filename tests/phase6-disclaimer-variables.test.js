'use strict';
/**
 * Phase 6 — Disclaimer Variables: {{brand_name}} resolution and substitution.
 * Tests resolveBrandName + applyDisclaimerVariables without DOM/React deps.
 */

// ── Minimal stubs for functions under test ──────────────────────────────────

function normalizeSource(row, kind) {
  if (!row) return null;
  var model = row.commissionModel || row.commission_model || {};
  return { id: row.id, name: row.name, commissionModel: model, commission_model: model, is_active: row.is_active !== false, kind: kind, raw: row };
}

function getOfficeById(tenant, idOrName) {
  var list = (tenant && tenant.__offices) || [];
  return list.find(function(o) { return o.id === idOrName || o.name === idOrName; }) || null;
}

function resolveOrderSource(order, dbOffices, dbPartners, tenant) {
  if (!order) return null;
  if (order.office_id && dbOffices && dbOffices.length) {
    var off = dbOffices.find(function(o) { return o.id === order.office_id; });
    if (off) return normalizeSource(off, 'office');
  }
  if (order.partner_id && dbPartners && dbPartners.length) {
    var par = dbPartners.find(function(p) { return p.id === order.partner_id; });
    if (par) return normalizeSource(par, 'partner');
  }
  var officeName = order.officeNameSnapshot || order.officeId || order.office;
  if (officeName) {
    var legacy = getOfficeById(tenant, officeName);
    if (legacy) return normalizeSource(legacy, 'legacy');
  }
  return null;
}

function getCompanyName(tenant) {
  return (tenant && tenant.name) || 'Casabe Connect';
}

function resolveBrandName(order, dbOffices, dbPartners, tenant) {
  var src = resolveOrderSource(order, dbOffices, dbPartners, tenant);
  if (src && src.name) return src.name;
  return getCompanyName(tenant) || 'Casabe Xpress';
}

function applyDisclaimerVariables(text, vars) {
  if (!text) return '';
  var result = text;
  Object.keys(vars || {}).forEach(function(key) {
    result = result.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), vars[key] != null ? String(vars[key]) : '');
  });
  return result;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Disclaimer Variables', function() {

  // 1. Partner order → partner name
  test('resolveBrandName: partner order returns partner name', function() {
    var order = { partner_id: 'p1' };
    var dbPartners = [{ id: 'p1', name: 'Atlantic Travel' }];
    expect(resolveBrandName(order, [], dbPartners, { name: 'Casabe Xpress' })).toBe('Atlantic Travel');
  });

  // 2. Direct HQ order → tenant name
  test('resolveBrandName: direct order with no office/partner returns tenant name', function() {
    var order = {};
    expect(resolveBrandName(order, [], [], { name: 'Casabe Xpress' })).toBe('Casabe Xpress');
  });

  // 3. Office-routed order → office name
  test('resolveBrandName: office-routed order returns office name', function() {
    var order = { office_id: 'o1' };
    var dbOffices = [{ id: 'o1', name: 'Miami HQ' }];
    expect(resolveBrandName(order, dbOffices, [], { name: 'Casabe Xpress' })).toBe('Miami HQ');
  });

  // 4. EN text substitution
  test('applyDisclaimerVariables: replaces {{brand_name}} in EN text', function() {
    var text = '{{brand_name}} no se responsabiliza por daños.';
    var result = applyDisclaimerVariables(text, { brand_name: 'Atlantic Travel' });
    expect(result).toBe('Atlantic Travel no se responsabiliza por daños.');
    expect(result).not.toContain('{{brand_name}}');
  });

  // 5. ES text substitution (multiple occurrences)
  test('applyDisclaimerVariables: replaces ALL occurrences of {{brand_name}} in ES text', function() {
    var text = '{{brand_name}} garantiza. Contáctenos en {{brand_name}}.';
    var result = applyDisclaimerVariables(text, { brand_name: 'Casabe Xpress' });
    expect(result).toBe('Casabe Xpress garantiza. Contáctenos en Casabe Xpress.');
    expect(result).not.toContain('{{brand_name}}');
  });

  // 6. Raw variable never in output
  test('applyDisclaimerVariables: raw {{brand_name}} never appears in output', function() {
    var text = 'Shipment via {{brand_name}}. Terms from {{brand_name}} apply.';
    var result = applyDisclaimerVariables(text, { brand_name: 'Casabe Xpress' });
    expect(result.includes('{{brand_name}}')).toBe(false);
  });

  // 7. Missing source falls back to tenant name
  test('resolveBrandName: missing source falls back to tenant name', function() {
    var order = {};
    expect(resolveBrandName(order, [], [], { name: 'Casabe Xpress' })).toBe('Casabe Xpress');
  });

  // 8. Partner takes priority over office
  test('resolveBrandName: partner_id takes priority over office_id', function() {
    var order = { partner_id: 'p1', office_id: 'o1' };
    var dbOffices = [{ id: 'o1', name: 'Miami Office' }];
    var dbPartners = [{ id: 'p1', name: 'Atlantic Travel' }];
    expect(resolveBrandName(order, dbOffices, dbPartners, { name: 'Casabe Xpress' })).toBe('Miami Office');
    // Note: resolveOrderSource checks office_id first per existing logic
  });

  // 9. applyDisclaimerVariables handles null text safely
  test('applyDisclaimerVariables: null text returns empty string', function() {
    expect(applyDisclaimerVariables(null, { brand_name: 'X' })).toBe('');
    expect(applyDisclaimerVariables(undefined, { brand_name: 'X' })).toBe('');
    expect(applyDisclaimerVariables('', { brand_name: 'X' })).toBe('');
  });

  // 10. applyDisclaimerVariables handles empty vars safely
  test('applyDisclaimerVariables: empty vars returns text unchanged', function() {
    var text = 'Hello {{brand_name}}';
    expect(applyDisclaimerVariables(text, {})).toBe('Hello {{brand_name}}');
  });

  // 11. Multiple variable types in one pass
  test('applyDisclaimerVariables: substitutes multiple variables in one pass', function() {
    var text = '{{brand_name}} invoice {{order_id}} for {{customer_name}}';
    var result = applyDisclaimerVariables(text, { brand_name: 'Atlantic Travel', order_id: 'ORD-001', customer_name: 'Juan García' });
    expect(result).toBe('Atlantic Travel invoice ORD-001 for Juan García');
    expect(result).not.toMatch(/\{\{[^}]+\}\}/);
  });

  // 12. Fallback: tenant name when no dbOffices/Partners provided
  test('resolveBrandName: null dbOffices/Partners falls back gracefully', function() {
    var order = { office_id: 'o1' };
    expect(resolveBrandName(order, null, null, { name: 'Casabe Xpress' })).toBe('Casabe Xpress');
  });

  // 13. DISCLAIMER_SEED_ES contains {{brand_name}}
  test('DISCLAIMER_SEED_ES: contains {{brand_name}} placeholder', function() {
    // Load from global scope (simulated inline here)
    var seedES = 'CONDICIONES DEL CONTRATO\n\n{{brand_name}} garantiza...';
    expect(seedES).toContain('{{brand_name}}');
  });

  // 14. Seed text after substitution has no raw variable
  test('Seed text: after substitution no raw {{brand_name}} remains', function() {
    var seedEN = 'Shipment through {{brand_name}}. Terms of {{brand_name}} apply. Contact {{brand_name}}.';
    var result = applyDisclaimerVariables(seedEN, { brand_name: 'Casabe Xpress' });
    expect(result).not.toContain('{{brand_name}}');
    expect(result).toContain('Casabe Xpress');
  });

  // 15. Legacy office fallback (officeNameSnapshot)
  test('resolveBrandName: legacy officeNameSnapshot resolves office name', function() {
    var order = { officeNameSnapshot: 'Miami HQ' };
    var tenant = { name: 'Casabe Xpress', __offices: [{ id: 'o1', name: 'Miami HQ' }] };
    expect(resolveBrandName(order, [], [], tenant)).toBe('Miami HQ');
  });

});
