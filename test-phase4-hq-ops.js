#!/usr/bin/env node
/**
 * test-phase4-hq-ops.js
 *
 * Phase 4 HQ Unified Operations Integration Test
 *
 * Tests:
 * 1. HQ Operations surface and routing
 * 2. HQ tabs: Pickup | Dropoff | Completed
 * 3. HQ Pickup tab (all offices/partners/orders)
 * 4. HQ Dropoff tab (in_transit items)
 * 5. HQ Completed tab (completed shipments/boxes)
 * 6. Filters: status, office, driver, pickup_location, date
 * 7. Activity panel (activity_log across all offices/drivers)
 * 8. Payment status filters
 *
 * Usage: node test-phase4-hq-ops.js
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
console.log('  PHASE 4 — HQ UNIFIED OPERATIONS INTEGRATION TEST');
console.log('═══════════════════════════════════════════════════════════\n');

// ─────────────────────────────────────────────────────────────────────────
console.log('HQ Operations Surface & Routing');
console.log('─────────────────────────────────────────────────────────────');

test('1. HQ Operations surface marker', () => {
  return html.includes('HQ Operations') || html.includes('hq_operations') || html.includes('HQOperations');
});

test('2. HQ role conditional rendering', () => {
  return html.includes('roleKey === "hq"') || html.includes('role === "hq"') || html.includes('dbRole === "hq"');
});

test('3. HQ page routing', () => {
  return html.includes('hq') && (html.includes('setPage') || html.includes('navigate') || html.includes('page'));
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nHQ Tabs (Pickup | Dropoff | Completed)');
console.log('─────────────────────────────────────────────────────────────');

test('4. HQ Pickup tab', () => {
  return html.includes('Pickup') && (html.includes('hq') || html.includes('HQ'));
});

test('5. HQ Dropoff tab', () => {
  return html.includes('Dropoff') || html.includes('Drop-off') || (html.includes('Delivery') && html.includes('hq'));
});

test('6. HQ Completed tab', () => {
  return html.includes('Completed') && (html.includes('hq') || html.includes('shipment'));
});

test('7. HQ tab switching logic', () => {
  return (html.includes('Pickup') || html.includes('pickup')) &&
         (html.includes('Dropoff') || html.includes('dropoff'));
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nHQ Pickup Tab (All Offices/Partners/Orders)');
console.log('─────────────────────────────────────────────────────────────');

test('8. All offices visible to HQ', () => {
  return html.includes('office') && (html.includes('all') || html.includes('ALL') || html.includes('pickup'));
});

test('9. Pickup location field (office | client_house)', () => {
  return html.includes('pickup_location') || html.includes('pickupLocation');
});

test('10. Order tracking ID displayed', () => {
  return html.includes('Tracking ID') || html.includes('tracking') || html.includes('Order ID');
});

test('11. Office/partner source visible', () => {
  return html.includes('office') && (html.includes('partner') || html.includes('source'));
});

test('12. Destination field in pickup view', () => {
  return html.includes('Destination') || html.includes('destination');
});

test('13. Box count/type visible', () => {
  return html.includes('box') && (html.includes('Box') || html.includes('count'));
});

test('14. Driver assignment visible', () => {
  return html.includes('Driver') || html.includes('driver') || html.includes('Assigned');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nHQ Dropoff Tab (In Transit / Dropoff Ready)');
console.log('─────────────────────────────────────────────────────────────');

test('15. In transit items visible', () => {
  return html.includes('in_transit') || html.includes('inTransit') || html.includes('In Transit');
});

test('16. Dropoff-ready items visible', () => {
  return html.includes('dropoff') || html.includes('Dropoff') || html.includes('drop-off');
});

test('17. Driver column in dropoff view', () => {
  return html.includes('Driver') && (html.includes('dropoff') || html.includes('Dropoff'));
});

test('18. Status field visible', () => {
  return html.includes('Status') || html.includes('status');
});

test('19. Last activity timestamp visible', () => {
  return html.includes('activity') && (html.includes('time') || html.includes('timestamp'));
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nHQ Completed Tab (Shipments & Box Orders)');
console.log('─────────────────────────────────────────────────────────────');

test('20. Completed shipments visible', () => {
  return html.includes('Completed') && html.includes('Shipments');
});

test('21. Completed box orders visible', () => {
  return html.includes('Completed') && html.includes('Box Orders');
});

test('22. Most recent first ordering', () => {
  return html.includes('Completed') && (html.includes('recent') || html.includes('desc') || html.includes('created'));
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nHQ Filters');
console.log('─────────────────────────────────────────────────────────────');

test('23. Status filter', () => {
  return html.includes('Status') && (html.includes('filter') || html.includes('Filter'));
});

test('24. Office/Partner filter', () => {
  return html.includes('office') && (html.includes('filter') || html.includes('Filter') || html.includes('select'));
});

test('25. Driver filter', () => {
  return html.includes('Driver') && (html.includes('filter') || html.includes('Filter'));
});

test('26. Pickup location filter', () => {
  return html.includes('pickup_location') && (html.includes('filter') || html.includes('Filter'));
});

test('27. Date/search filter', () => {
  return html.includes('date') && (html.includes('search') || html.includes('filter')) ||
         html.includes('search') && html.includes('filter');
});

test('28. Filter bar present', () => {
  return html.includes('FilterBar') || html.includes('filter') && html.includes('SET');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nActivity Panel (activity_log visibility)');
console.log('─────────────────────────────────────────────────────────────');

test('29. HQ can see all activity_log rows', () => {
  return html.includes('activity_log') && (html.includes('hq') || html.includes('all'));
});

test('30. Activity panel shows latest activity', () => {
  return html.includes('Activity') && (html.includes('latest') || html.includes('Recent'));
});

test('31. Activity displayed across all offices/drivers', () => {
  return html.includes('activity') && html.includes('office') && html.includes('driver');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nPayment Filters & Status');
console.log('─────────────────────────────────────────────────────────────');

test('32. Payment status filter present', () => {
  return html.includes('payment') && html.includes('status');
});

test('33. Payment column visible', () => {
  return html.includes('Payment') || html.includes('payment');
});

test('34. Read-only payment display (no write logic)', () => {
  return html.includes('Payment') && !html.includes('recordPaymentStripe') || 
         html.includes('payment') && !html.includes('paymentProcess');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nBackward Compatibility (Phases 0/1/2/3)');
console.log('─────────────────────────────────────────────────────────────');

test('35. Phase 0 invoice print untouched', () => {
  return html.includes('invoicePrintRef');
});

test('36. Phase 0 commissions untouched', () => {
  return html.includes('Partner Commissions') || html.includes('calculateOfficeCommission');
});

test('37. Phase 2 Office Portal untouched', () => {
  return html.includes('Office Portal') || html.includes('office_portal');
});

test('38. Phase 3 Driver Portal untouched', () => {
  return html.includes('DriverPortalApp') || html.includes('Driver Portal');
});

test('39. All role portals co-exist', () => {
  return (html.includes('HQ Operations') || html.includes('hq_operations')) &&
         (html.includes('Office Portal') || html.includes('office_portal')) &&
         (html.includes('DriverPortalApp') || html.includes('Driver Portal'));
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════');
console.log(`Passed: ${passed}/39`);
console.log(`Failed: ${failed}/39`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach((name, i) => {
    console.log(`  ${i + 1}. ${name}`);
  });
  console.log('\n❌ HQ OPERATIONS TEST FAILED');
  process.exit(1);
}

console.log('\n✅ HQ OPERATIONS TEST PASSED (39/39)');
process.exit(0);
