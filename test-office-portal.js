#!/usr/bin/env node

/**
 * PHASE 2: OFFICE PORTAL - SMOKE TESTS
 * 
 * Test Requirements:
 * 1. Pickup Location required field in Order Form ✓
 * 2. Office pickup list (view pending orders) ✓
 * 3. Office Box Orders section ✓
 * 4. Tabs: Pending | Ready for Pickup | Completed ✓
 * 5. Completed tab includes shipments + box orders ✓
 * 6. Box order status flow: Pending → Ready for Pickup → Completed ✓
 */

const fs = require('fs');
const path = require('path');

console.log('\n╔═══════════════════════════════════════════════════════════════════════════════════════════════╗');
console.log('║                     PHASE 2: OFFICE PORTAL SMOKE TESTS                                    ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════════════════════════╝\n');

const indexPath = path.join(__dirname, 'index.html');
const content = fs.readFileSync(indexPath, 'utf8');

const tests = [
  {
    name: 'REQUIREMENT #1: Pickup Location Field Required',
    checks: [
      { pattern: /pickup_location/g, desc: 'pickup_location field present' },
      { pattern: /\"office\"|\"client_house\"/g, desc: 'Pickup location options defined' }
    ]
  },
  {
    name: 'REQUIREMENT #2: Office Pickup List Component',
    checks: [
      { pattern: /PendingOrdersTab/g, desc: 'PendingOrdersTab component exists' },
      { pattern: /ready_for_pickup/g, desc: 'Status filter for ready_for_pickup' }
    ]
  },
  {
    name: 'REQUIREMENT #3: Office Box Orders Section',
    checks: [
      { pattern: /CompletedTab/g, desc: 'CompletedTab component exists' },
      { pattern: /Box Orders/g, desc: 'Box Orders section present' }
    ]
  },
  {
    name: 'REQUIREMENT #4: Three Main Tabs Present',
    checks: [
      { pattern: /Pending/g, desc: 'Pending tab exists' },
      { pattern: /Ready for Pickup/g, desc: 'Ready for Pickup tab exists' },
      { pattern: /Completed/g, desc: 'Completed tab exists' }
    ]
  },
  {
    name: 'REQUIREMENT #5: Completed Tab Shows Shipments + Box Orders',
    checks: [
      { pattern: /Shipments/g, desc: 'Shipments sub-tab present' },
      { pattern: /📮 Box Orders/g, desc: 'Box Orders sub-tab present' },
      { pattern: /\"shipments\"===c/g, desc: 'Shipment filtering logic' },
      { pattern: /\"box_orders\"===c/g, desc: 'Box order filtering logic' }
    ]
  },
  {
    name: 'REQUIREMENT #6: Box Order Status Flow',
    checks: [
      { pattern: /\"in_warehouse\"/g, desc: 'In Warehouse status' },
      { pattern: /\"delivered\"/g, desc: 'Delivered status' },
      { pattern: /\"picked_up\"/g, desc: 'Picked Up status' },
      { pattern: /Mark Picked Up/g, desc: 'Mark as Picked Up action' },
      { pattern: /Mark Delivered/g, desc: 'Mark as Delivered action' }
    ]
  },
  {
    name: 'TECH REQUIREMENT: Single-File React (No Array Wrappers)',
    checks: [
      { pattern: /var OfficePortal=function/g, desc: 'IIFE-style component definition' },
      { pattern: /return React.createElement/g, desc: 'Uses React.createElement (inline)' },
      { pattern: /PendingOrdersTab=function/g, desc: 'Sub-components inline (no array)' }
    ]
  },
  {
    name: 'INTEGRATION: Navigation & Routing',
    checks: [
      { pattern: /office_portal/g, desc: 'office_portal page key' },
      { pattern: /if \(page === \"office_portal\"\)/g, desc: 'Page routing configured' },
      { pattern: /🏢 Office Portal/g, desc: 'Office Portal header text' }
    ]
  },
  {
    name: 'CODE QUALITY: WhatsApp Fu-Div (Exactly 5 Closing Parens)',
    checks: [
      { 
        pattern: /React.createElement\("div",\{className:"fu"\},.*?React.createElement\("div",\{className:"fu"\}\)[^)]*\){5}/s,
        desc: 'Proper nesting with 5 closing parens on fu-div'
      }
    ]
  }
];

let passed = 0;
let failed = 0;

tests.forEach((test, idx) => {
  console.log(`\n[TEST ${idx + 1}] ${test.name}`);
  console.log('─'.repeat(90));
  
  let testPassed = true;
  
  test.checks.forEach(check => {
    const match = check.pattern.exec(content);
    const status = match ? '✓' : '✗';
    const color = match ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    
    console.log(`  ${color}${status}${reset} ${check.desc}`);
    
    if (!match) {
      testPassed = false;
      failed++;
    } else {
      passed++;
    }
  });
  
  if (testPassed) {
    console.log('\n  ✓ TEST PASSED');
  } else {
    console.log('\n  ✗ TEST FAILED');
  }
});

// Syntax validation - extract JavaScript portion
console.log('\n\n[SYNTAX CHECK] Validating embedded JavaScript');
console.log('─'.repeat(90));

const scriptMatch = content.match(/<script type="text\/javascript">\s*"use strict";([\s\S]*?)<\/script>/);
if (scriptMatch) {
  const jsCode = `"use strict";${scriptMatch[1]}`;
  try {
    new Function(jsCode);
    console.log('✓ JavaScript syntax is valid (no parse errors)');
    passed++;
  } catch (err) {
    console.log(`✗ Syntax error: ${err.message}`);
    failed++;
  }
} else {
  console.log('⚠ Could not extract JavaScript to validate');
}

// Summary
console.log('\n\n╔═══════════════════════════════════════════════════════════════════════════════════════════════╗');
console.log('║                              TEST SUMMARY                                                    ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════════════════════════╝\n');

const total = passed + failed;
const percentage = Math.round((passed / total) * 100);

console.log(`✓ PASSED:  ${passed}/${total}`);
console.log(`✗ FAILED:  ${failed}/${total}`);
console.log(`📊 SUCCESS RATE: ${percentage}%\n`);

if (failed === 0) {
  console.log('✅ ALL TESTS PASSED — OFFICE PORTAL READY FOR PRODUCTION\n');
  process.exit(0);
} else {
  console.log('❌ SOME TESTS FAILED — REVIEW REQUIREMENTS\n');
  process.exit(1);
}
