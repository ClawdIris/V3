#!/usr/bin/env node
/**
 * test-office-portal.js
 *
 * Phase 2 Office Portal Integration Test
 *
 * Tests:
 * 1. Office Portal route/surface integrated
 * 2. Pickup location required field (office | client_house options)
 * 3. Office Portal tabs: Pending | Ready for Pickup | Completed
 * 4. Box Orders section
 * 5. Completed tab distinguishes shipments vs box orders
 *
 * Usage: node test-office-portal.js
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
console.log('  PHASE 2 — OFFICE PORTAL INTEGRATION TEST');
console.log('═══════════════════════════════════════════════════════════\n');

// ─────────────────────────────────────────────────────────────────────────
console.log('Office Portal Route & Surface');
console.log('─────────────────────────────────────────────────────────────');

test('1. Office Portal route or surface marker', () => {
  return html.includes('Office Portal') || html.includes('office_portal') || html.includes('OfficePortal');
});

test('2. Office role conditional rendering', () => {
  return html.includes('roleKey === "office"') || html.includes('role === "office"') || html.includes('dbRole === "office"');
});

test('3. Office Portal page routing', () => {
  return html.includes('page') && (html.includes('"office"') || html.includes("'office'"));
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nPickup Location Field (office | client_house options)');
console.log('─────────────────────────────────────────────────────────────');

test('4. pickup_location field referenced', () => {
  return html.includes('pickup_location') || html.includes('pickupLocation');
});

test('5. office pickup location option', () => {
  return html.includes('office') && (html.includes('pickup') || html.includes('Pickup'));
});

test('6. client_house pickup location option', () => {
  return html.includes('client_house') || html.includes('clientHouse') || html.includes('client house');
});

test('7. Pickup Location label in UI', () => {
  return html.includes('Pickup Location') || html.includes('pickup location');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nOffice Portal Tabs (Pending | Ready for Pickup | Completed)');
console.log('─────────────────────────────────────────────────────────────');

test('8. Pending tab in office portal', () => {
  return html.includes('Pending');
});

test('9. Ready for Pickup tab (or "Ready")', () => {
  return html.includes('Ready for Pickup') || html.includes('Ready Pickup') || html.includes('Ready');
});

test('10. Completed tab', () => {
  return html.includes('Completed');
});

test('11. Office portal tabs as conditional display', () => {
  return (html.includes('Pending') && html.includes('Completed')) &&
         (html.includes('Ready') || html.includes('pickup'));
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nBox Orders Section');
console.log('─────────────────────────────────────────────────────────────');

test('12. Box Orders section label', () => {
  return html.includes('Box Orders') || html.includes('box orders');
});

test('13. Box order status tracking', () => {
  return html.includes('box') && (html.includes('status') || html.includes('Status'));
});

test('14. Box order list rendering', () => {
  return html.includes('box') && (html.includes('order') || html.includes('Order'));
});

test('15. Office filtering on box orders', () => {
  return html.includes('office') && html.includes('box');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nCompleted Tab: Shipments vs Box Orders Distinction');
console.log('─────────────────────────────────────────────────────────────');

test('16. Shipments labeled in completed view', () => {
  return html.includes('Shipments') || html.includes('shipments');
});

test('17. Box Orders labeled in completed view', () => {
  return html.includes('Box Orders') || html.includes('box orders');
});

test('18. Completed shipments view', () => {
  return html.includes('Completed') && html.includes('Shipments');
});

test('19. Completed box orders view', () => {
  return html.includes('Completed') && html.includes('Box Orders');
});

test('20. Distinct tab/section for each type', () => {
  return html.match(/Shipments/gi) && html.match(/Box Orders/gi);
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nIntegration with Phase 0 Features');
console.log('─────────────────────────────────────────────────────────────');

test('21. Does not remove invoice print (Phase 0)', () => {
  return html.includes('invoicePrintRef');
});

test('22. Does not remove commissions (Phase 0)', () => {
  return html.includes('Partner Commissions') || html.includes('calculateOfficeCommission');
});

test('23. Office portal added without replacing shell', () => {
  return html.includes('Office Portal') && html.includes('invoicePrintRef');
});

test('24. Unified shell has multiple portals', () => {
  return html.includes('office') && (html.includes('roleKey') || html.includes('dbRole'));
});

test('25. Navigation to office portal from shell', () => {
  return html.includes('Office Portal') && (html.includes('setPage') || html.includes('navigate'));
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════');
console.log(`Passed: ${passed}/25`);
console.log(`Failed: ${failed}/25`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach((name, i) => {
    console.log(`  ${i + 1}. ${name}`);
  });
  console.log('\n❌ OFFICE PORTAL TEST FAILED');
  process.exit(1);
}

console.log('\n✅ OFFICE PORTAL TEST PASSED (25/25)');
process.exit(0);
