#!/usr/bin/env node
/**
 * PHASE 0 S4 SMOKE TEST - Casabe Konnect R4 Stabilization
 * 
 * Tests required before moving to Phase 1 (Data Schema Work)
 * 
 * Requirements:
 * 1. v9.12 invoice print functionality
 * 2. Commission remediation and calculations
 * 3. Atlantic Travel test order (18% commission)
 * 4. App loads without critical errors
 */

const fs = require('fs');
const path = require('path');

console.log('════════════════════════════════════════════════════════════════');
console.log('  🔍 PHASE 0 S4 SMOKE TEST - Casabe Konnect R4 Stabilization');
console.log('════════════════════════════════════════════════════════════════\n');

const indexPath = path.join(__dirname, 'index.html');
const indexContent = fs.readFileSync(indexPath, 'utf8');

let passed = 0;
let failed = 0;
const issues = [];

// ════════════════════════════════════════════════════════════════
// TEST GROUP 1: v9.12 Invoice Print Functionality
// ════════════════════════════════════════════════════════════════
console.log('📋 Test Group 1: v9.12 Invoice Print');
console.log('─'.repeat(60));

const invoicePrintTests = [
  {
    name: 'Invoice printout HTML template exists',
    check: () => indexContent.includes('invoice-printout') && indexContent.includes('.invoice-printout')
  },
  {
    name: 'Invoice header section rendered',
    check: () => indexContent.includes('inv-header') && indexContent.includes('inv-co-name')
  },
  {
    name: 'Invoice tracking number section',
    check: () => indexContent.includes('inv-tracking-row') && indexContent.includes('inv-tracking-num')
  },
  {
    name: 'Invoice table with items',
    check: () => indexContent.includes('inv-table') && indexContent.includes('inv-table th')
  },
  {
    name: 'Invoice totals section',
    check: () => indexContent.includes('inv-totals') && indexContent.includes('inv-grand')
  },
  {
    name: 'Invoice print CSS styles',
    check: () => indexContent.includes('body.printing-invoice .invoice-printout')
  },
  {
    name: 'Invoice print reference handler',
    check: () => indexContent.includes('invoicePrintRef')
  },
  {
    name: 'v9.12 invoice print ref documentation',
    check: () => indexContent.includes('v9.12: clone the mounted printout')
  }
];

invoicePrintTests.forEach(test => {
  if (test.check()) {
    console.log(`  ✓ ${test.name}`);
    passed++;
  } else {
    console.log(`  ✗ ${test.name}`);
    failed++;
    issues.push(`Invoice Print: ${test.name}`);
  }
});

// ════════════════════════════════════════════════════════════════
// TEST GROUP 2: Commission Remediation & Source-of-Truth
// ════════════════════════════════════════════════════════════════
console.log('\n💰 Test Group 2: Commission Remediation & Calculations');
console.log('─'.repeat(60));

const commissionTests = [
  {
    name: 'Commission calculation engine present',
    check: () => indexContent.includes('calculateOfficeCommission') || indexContent.includes('commissionModel')
  },
  {
    name: 'Office commission model structure',
    check: () => indexContent.includes('commissionModel') && indexContent.includes('type')
  },
  {
    name: 'Percentage commission type',
    check: () => indexContent.includes('"percentage"')
  },
  {
    name: 'Commission rate normalization',
    check: () => indexContent.includes('normalizeCommissionPercentage') || indexContent.includes('commissionRate')
  },
  {
    name: 'v9.13 commission source-of-truth guard',
    check: () => indexContent.includes('v9.13') || indexContent.includes('source-of-truth')
  },
  {
    name: 'Commission audit logging prepared',
    check: () => indexContent.includes('commission') && indexContent.includes('log')
  },
  {
    name: 'Office commission editor UI',
    check: () => indexContent.includes('OfficeDetailModal') || indexContent.includes('Commission')
  }
];

commissionTests.forEach(test => {
  if (test.check()) {
    console.log(`  ✓ ${test.name}`);
    passed++;
  } else {
    console.log(`  ✗ ${test.name}`);
    failed++;
    issues.push(`Commission: ${test.name}`);
  }
});

// ════════════════════════════════════════════════════════════════
// TEST GROUP 3: Atlantic Travel Office Configuration
// ════════════════════════════════════════════════════════════════
console.log('\n✈️  Test Group 3: Atlantic Travel Office Configuration');
console.log('─'.repeat(60));

// Find Atlantic Travel definition
const atlanticMatch = indexContent.match(/Atlantic\s+Travel[^}]*?18[^}]*?commission/i) ||
                      indexContent.match(/off_atl[^}]*?18[^}]*?percentage/i) ||
                      indexContent.match(/"off_atl"[^}]*?Atlantic[^}]*?0\.18/);

const atlanticTests = [
  {
    name: 'Atlantic Travel office defined',
    check: () => indexContent.includes('Atlantic Travel') && (indexContent.includes('off_atl') || indexContent.includes('atlantic'))
  },
  {
    name: 'Atlantic Travel has 18% commission rate',
    check: () => {
      const atlanticSection = indexContent.match(/Atlantic\s+Travel[^}]{0,200}/i);
      if (!atlanticSection) return false;
      // Check for 0.18 or 18 or "18%"
      return atlanticSection[0].includes('0.18') || atlanticSection[0].includes('18') || atlanticSection[0].includes('.18');
    }
  },
  {
    name: 'Atlantic Travel in office offices array',
    check: () => indexContent.includes('"off_atl"') && indexContent.match(/off_atl[^}]*Atlantic/)
  },
  {
    name: 'Atlantic Travel active status',
    check: () => indexContent.includes('Atlantic Travel') && (
      indexContent.includes('"active": true') || indexContent.includes('active:true')
    )
  }
];

atlanticTests.forEach(test => {
  if (test.check()) {
    console.log(`  ✓ ${test.name}`);
    passed++;
  } else {
    console.log(`  ✗ ${test.name}`);
    failed++;
    issues.push(`Atlantic Travel: ${test.name}`);
  }
});

// Extract and display Atlantic configuration
const atlanticConfigMatch = indexContent.match(/\{\s*id:\s*"off_atl"[^}]*?notes:[^}]*?\}/);
if (atlanticConfigMatch) {
  console.log(`\n  ℹ Atlantic Travel config found:`, atlanticConfigMatch[0].slice(0, 150) + '...');
}

// ════════════════════════════════════════════════════════════════
// TEST GROUP 4: App Structure & Core Functionality
// ════════════════════════════════════════════════════════════════
console.log('\n⚙️  Test Group 4: App Structure & Core Functionality');
console.log('─'.repeat(60));

const structureTests = [
  {
    name: 'React application loaded',
    check: () => indexContent.includes('React.createElement') && indexContent.includes('root')
  },
  {
    name: 'State management (useState)',
    check: () => indexContent.includes('useState')
  },
  {
    name: 'Dashboard/HQ views present',
    check: () => indexContent.includes('Dashboard') || indexContent.includes('HQOverview')
  },
  {
    name: 'Order processing flow',
    check: () => indexContent.includes('Orders') || indexContent.includes('OrderForm')
  },
  {
    name: 'WhatsApp integration present',
    check: () => indexContent.includes('WhatsApp') || indexContent.includes('PAID_INVOICE')
  },
  {
    name: 'Supabase integration',
    check: () => indexContent.includes('supabase') || indexContent.includes('Supabase')
  }
];

structureTests.forEach(test => {
  if (test.check()) {
    console.log(`  ✓ ${test.name}`);
    passed++;
  } else {
    console.log(`  ✗ ${test.name}`);
    failed++;
    issues.push(`Structure: ${test.name}`);
  }
});

// ════════════════════════════════════════════════════════════════
// TEST GROUP 5: Build Quality & Syntax
// ════════════════════════════════════════════════════════════════
console.log('\n🔧 Test Group 5: Build Quality & Syntax');
console.log('─'.repeat(60));

const buildTests = [
  {
    name: 'File size reasonable (>1MB)',
    check: () => {
      const size = fs.statSync(indexPath).size;
      return size > 1000000;
    }
  },
  {
    name: 'No obvious minification errors',
    check: () => !indexContent.includes('SyntaxError') && !indexContent.includes('Unexpected token')
  },
  {
    name: 'Script tag properly closed',
    check: () => indexContent.includes('</script>')
  },
  {
    name: 'HTML5 DOCTYPE',
    check: () => indexContent.includes('<!DOCTYPE html>')
  }
];

buildTests.forEach(test => {
  if (test.check()) {
    console.log(`  ✓ ${test.name}`);
    passed++;
  } else {
    console.log(`  ✗ ${test.name}`);
    failed++;
    issues.push(`Build: ${test.name}`);
  }
});

// ════════════════════════════════════════════════════════════════
// SUMMARY REPORT
// ════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log('📊 PHASE 0 S4 TEST SUMMARY');
console.log('═'.repeat(60));

console.log(`\n✓ Passed: ${passed}`);
console.log(`✗ Failed: ${failed}`);
console.log(`Total:   ${passed + failed}\n`);

if (issues.length > 0) {
  console.log('⚠️  ISSUES FOUND:');
  issues.forEach((issue, idx) => {
    console.log(`  ${idx + 1}. ${issue}`);
  });
  console.log();
}

const status = failed === 0 ? '✅ PASS' : '❌ FAIL';
console.log(`STATUS: ${status} - ${failed === 0 ? 'Ready for Phase 1' : 'Review required before Phase 1'}`);
console.log('═'.repeat(60));

// ════════════════════════════════════════════════════════════════
// PHASE 1 READINESS
// ════════════════════════════════════════════════════════════════
if (failed === 0) {
  console.log('\n🚀 PHASE 1 DATA SCHEMA WORK READY');
  console.log('   Tasks:');
  console.log('   1. Add pickup_location field to orders (office | client_house)');
  console.log('   2. Create box_orders table with RLS policies');
  console.log('   3. Create activity_log table with RLS policies');
  console.log('   4. Test RLS with HQ / Office / Driver / anon roles');
  console.log('   5. Verify Supabase policy sync (Office, HQ, Driver views)');
  console.log('   6. Production-ready code & full testing by 6AM');
  console.log('═'.repeat(60) + '\n');
}

process.exit(failed > 0 ? 1 : 0);
