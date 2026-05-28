#!/usr/bin/env node
/*
 * Casabe Konnect unified shell smoke gate.
 *
 * Purpose:
 *   Catch the exact failure mode where a later phase overwrites the app shell
 *   and removes earlier phase surfaces. This is intentionally static and fast;
 *   it should be run after every small rebuild commit before deeper browser or
 *   Supabase smoke testing.
 *
 * Usage:
 *   node test-unified-shell-smoke.js
 *   node test-unified-shell-smoke.js /path/to/index.html
 */

'use strict';

const fs = require('fs');
const path = require('path');

const targetPath = path.resolve(process.argv[2] || path.join(__dirname, 'index.html'));

if (!fs.existsSync(targetPath)) {
  console.error(`ERROR: file not found: ${targetPath}`);
  process.exit(2);
}

const html = fs.readFileSync(targetPath, 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

function hasAny(patterns) {
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(html);
    return html.includes(pattern);
  });
}

function check(group, name, patterns, opts = {}) {
  const ok = hasAny(patterns);
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push({ group, name, note: opts.note || '' });
    console.log(`  ✗ ${name}`);
    if (opts.note) console.log(`    ${opts.note}`);
  }
}

function group(title) {
  console.log(`\n${title}`);
  console.log('─'.repeat(72));
}

console.log('════════════════════════════════════════════════════════════════');
console.log('  CASABE UNIFIED SHELL SMOKE GATE');
console.log('════════════════════════════════════════════════════════════════');
console.log(`Target: ${targetPath}`);

group('Build / App Shell');
check('Build', 'HTML5 document + React root', ['<!DOCTYPE html>', '<div id="root"']);
check('Build', 'React app code present', ['React.createElement', 'ReactDOM.createRoot']);
check('Build', 'Supabase client present', ['supabase.createClient', 'createClient(SUPABASE_URL']);
check('Build', 'Unified shell is not HQ-only', [
  /office_portal/i,
  /DriverPortalApp/,
  /Partner Commissions/,
  /InvoiceModal/,
], {
  note: 'If this fails and title is HQ Operations, a phase likely overwrote the shell.'
});

group('Phase 0 — Stabilization');
check('Phase 0', 'v9.12 invoice print ref', ['invoicePrintRef', 'invoice-printout']);
check('Phase 0', 'Invoice print layout/styles', ['inv-header', 'inv-tracking-num', 'inv-table', 'body.printing-invoice']);
check('Phase 0', 'Commission calculation helpers', [
  'calculateOfficeCommission',
  'normalizeCommissionPercentage',
  'guardCommissionAmount',
]);
check('Phase 0', 'Partner commissions editor', ['Partner Commissions', 'handleSavePartners', 'savePartner']);
check('Phase 0', 'v9.15 partner-aware order preview/stamp path', [
  'resolveOrderSource',
  'Partner Commission',
  '__dbPartners',
]);

group('Phase 1 — Data Foundations');
check('Phase 1', 'pickup_location referenced', ['pickup_location']);
check('Phase 1', 'box_orders integration', ['box_orders', '.from("box_orders")', ".from('box_orders')"]);
check('Phase 1', 'activity_log integration', ['activity_log', '.from("activity_log")', ".from('activity_log')"]);

group('Phase 2 — Office Portal');
check('Phase 2', 'Office Portal route/surface', ['Office Portal', 'office_portal', 'OfficePortal']);
check('Phase 2', 'Pickup location office/client_house options', ['client_house', 'Pickup Location']);
check('Phase 2', 'Office Pending / Pickup / Completed tabs', ['Pending', 'Ready for Pickup', 'Completed']);
check('Phase 2', 'Office box orders surface', ['Box Orders', 'box order', 'box_orders']);
check('Phase 2', 'Completed tab distinguishes shipments and box orders', ['Shipments', 'Box Orders']);

group('Phase 3 — Driver Portal');
check('Phase 3', 'Driver portal surface', ['DriverPortalApp', 'Driver Portal', 'Today’s Route', "Today's Route"]);
check('Phase 3', 'Driver Pickup / Dropoff / Completed tabs', ['Confirm Pickup', 'Confirm Dropoff', 'Dropoff']);
check('Phase 3', 'Activity log panel/service', ['ActivityLogService', 'Today’s Activity', "Today's Activity", 'activity_log']);
check('Phase 3', 'Payment recording UI/service', ['PaymentModal', 'Record Payment', 'Payment Method', 'recordPayment']);
check('Phase 3', 'Stripe/WhatsApp payment support', ['StripePaymentService', 'stripe.com/pay', 'Copy for WhatsApp', 'whatsappMessage']);

group('Phase 4 — HQ Unified Tabs');
check('Phase 4', 'HQ operations surface', ['HQ Operations', 'HQ Unified', 'HQ Pickup']);
check('Phase 4', 'HQ Pickup / Dropoff / Completed tabs', ['PickupTab', 'DropoffTab', 'CompletedTab']);
check('Phase 4', 'HQ filters', ['SET_OFFICE', 'SET_DRIVER', 'payment_status', 'FilterBar']);
check('Phase 4', 'HQ activity/details support', ['getActivityLog', 'getBoxDetails', 'activity_log']);

group('Regression Traps');
check('Regression', 'Not missing previous full-app invoice marker', ['invoicePrintRef'], {
  note: 'Missing this usually means the Phase 4 HQ-only file replaced the v9.x shell.'
});
check('Regression', 'Not missing driver workflow markers', ['Confirm Pickup', 'Confirm Dropoff'], {
  note: 'Missing these means Phase 3 is not actually integrated.'
});
check('Regression', 'Not missing office workflow markers', ['office_portal', 'Office Portal'], {
  note: 'Missing these means Phase 2 is not actually integrated.'
});

console.log('\n════════════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('════════════════════════════════════════════════════════════════');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failures.length) {
  console.log('\nFailures:');
  for (const item of failures) {
    console.log(`  - [${item.group}] ${item.name}`);
    if (item.note) console.log(`    ${item.note}`);
  }
  console.log('\nSTATUS: FAIL — unified shell is not ready for deeper smoke.');
  process.exit(1);
}

console.log('\nSTATUS: PASS — static unified shell markers are present.');
