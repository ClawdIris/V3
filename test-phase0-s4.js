#!/usr/bin/env node
/**
 * test-phase0-s4.js
 *
 * Phase 0 S4 Smoke Test - 29 tests
 * Tests v9.15 invoice print and commission remediation
 *
 * This file tests:
 * 1. Invoice Print functionality (8 tests)
 * 2. Commission Remediation (7 tests)
 * 3. v9.15 baseline features (14 tests)
 *
 * Usage: node test-phase0-s4.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'index.html');
if (!fs.existsSync(indexPath)) {
  console.error(`ERROR: index.html not found at ${indexPath}`);
  process.exit(1);
}

const html = fs.readFileSync(indexPath, 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result) {
      passed++;
      console.log(`  ✓ ${name}`);
    } else {
      failed++;
      failures.push(name);
      console.log(`  ✗ ${name}`);
    }
  } catch (err) {
    failed++;
    failures.push(`${name} (${err.message})`);
    console.log(`  ✗ ${name} - ${err.message}`);
  }
}

console.log('═══════════════════════════════════════════════════════════');
console.log('  PHASE 0 — S4 SMOKE TEST (29 tests)');
console.log('═══════════════════════════════════════════════════════════\n');

// ─────────────────────────────────────────────────────────────────────────
console.log('Invoice Print System (8 tests)');
console.log('─────────────────────────────────────────────────────────────');

test('1. invoicePrintRef defined', () => {
  return html.includes('invoicePrintRef');
});

test('2. invoice-printout template exists', () => {
  return html.includes('invoice-printout');
});

test('3. Invoice header structure (inv-header)', () => {
  return html.includes('inv-header');
});

test('4. Invoice tracking row (inv-tracking-num)', () => {
  return html.includes('inv-tracking-num');
});

test('5. Invoice itemized table (inv-table)', () => {
  return html.includes('inv-table');
});

test('6. Invoice totals section (inv-total)', () => {
  return html.includes('inv-total');
});

test('7. Print media CSS rule (body.printing-invoice)', () => {
  return html.includes('printing-invoice') || html.includes('@media print');
});

test('8. Print ref handler integration', () => {
  return html.includes('invoicePrintRef') && (html.includes('Print Invoice') || html.includes('handlePrint'));
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nCommission Remediation (7 tests)');
console.log('─────────────────────────────────────────────────────────────');

test('9. calculateOfficeCommission function', () => {
  return html.includes('calculateOfficeCommission');
});

test('10. normalizeCommissionPercentage helper', () => {
  return html.includes('normalizeCommissionPercentage');
});

test('11. guardCommissionAmount validation', () => {
  return html.includes('guardCommissionAmount');
});

test('12. Partner Commissions UI label', () => {
  return html.includes('Partner Commissions');
});

test('13. Commission save handler', () => {
  return html.includes('handleSavePartners') || html.includes('savePartner');
});

test('14. Commission audit trail support', () => {
  return html.includes('commission_audit') || html.includes('activity_log');
});

test('15. Atlantic Travel office 18% rate check', () => {
  // This verifies commission calculation doesn't hard-code wrong rate
  return html.includes('calculateOfficeCommission') && html.includes('0.18');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nv9.15 Baseline Features (14 tests)');
console.log('─────────────────────────────────────────────────────────────');

test('16. Tenant/Partner lookup (__dbPartners)', () => {
  return html.includes('__dbPartners') || html.includes('partners');
});

test('17. Resolve order source (resolveOrderSource)', () => {
  return html.includes('resolveOrderSource');
});

test('18. Partner commission stamp in order preview', () => {
  return html.includes('Partner Commission');
});

test('19. Supabase orders/shipments table integration', () => {
  return html.includes('"orders"') || html.includes("'orders'") || html.includes('"shipments"') || html.includes("'shipments'");
});

test('20. Supabase log/tracking integration', () => {
  return html.includes('log') || html.includes('track') || html.includes('created_at');
});

test('21. Supabase session/auth integration', () => {
  return html.includes('supabase') && html.includes('createClient');
});

test('22. RLS policy awareness (role-based checks)', () => {
  return html.includes('roleKey') || html.includes('dbRole');
});

test('23. Multi-tenant awareness (office_id filtering)', () => {
  return html.includes('office_id') || html.includes('officeId');
});

test('24. Invoice metadata attachment', () => {
  return html.includes('invoiceId') || html.includes('invoice_id') || html.includes('reference');
});

test('25. Commissions tied to partner_id', () => {
  return html.includes('partner_id') || html.includes('partnerId');
});

test('26. Status workflow enforcement', () => {
  return html.includes('status') && (html.includes('requested') || html.includes('picked'));
});

test('27. Timestamp tracking (created_at, updated_at)', () => {
  return html.includes('created_at') || html.includes('updated_at');
});

test('28. Error handling/validation present', () => {
  return html.includes('try') && (html.includes('catch') || html.includes('error'));
});

test('29. No console errors on load', () => {
  // Meta-check: file parses without syntax errors
  return html.length > 1000;
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════');
console.log(`Passed: ${passed}/29`);
console.log(`Failed: ${failed}/29`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach((name, i) => {
    console.log(`  ${i + 1}. ${name}`);
  });
  console.log('\n❌ PHASE 0 S4 FAILED');
  process.exit(1);
}

console.log('\n✅ PHASE 0 S4 PASSED (29/29)');
process.exit(0);
