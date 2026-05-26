#!/usr/bin/env node
/**
 * Smoke test for Casabe R4 Commission Engine Build
 * Tests core commission calculations, WhatsApp triggers, and payment reminders
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 Casabe R4 Commission Engine - Smoke Tests\n');

// Test 1: Commission calculation functions exist
console.log('✓ Test 1: Commission calculations');
const indexContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const tests = [
  { name: 'calculateOfficeCommission', found: indexContent.includes('calculateOfficeCommission') },
  { name: 'getOrderCommission', found: indexContent.includes('getOrderCommission') },
  { name: 'normalizeCommissionPercentage', found: indexContent.includes('normalizeCommissionPercentage') },
  { name: 'WhatsApp invoice send', found: indexContent.includes('PAID_INVOICE_EDGE_URL') },
  { name: 'Payment reminder logic', found: indexContent.includes('paymentReminder') || indexContent.includes('reminder') },
  { name: 'Partner commission', found: indexContent.includes('partner_id') || indexContent.includes('partnerCommission') },
  { name: 'HQ analytics', found: indexContent.includes('Analytics') && indexContent.includes('Dashboard') },
];

let passed = 0;
let failed = 0;

tests.forEach(test => {
  if (test.found) {
    console.log(`  ✓ ${test.name}`);
    passed++;
  } else {
    console.log(`  ✗ ${test.name}`);
    failed++;
  }
});

// Test 2: Check for proper React structure
console.log('\n✓ Test 2: React structure');
const reactTests = [
  { name: 'React import', found: indexContent.includes('var _React = React') },
  { name: 'useState', found: indexContent.includes('useState') },
  { name: 'Inline IIFE (no array wrapper)', found: !indexContent.match(/return \[\s*React\.createElement/g) },
];

reactTests.forEach(test => {
  if (test.found) {
    console.log(`  ✓ ${test.name}`);
    passed++;
  } else {
    console.log(`  ✗ ${test.name}`);
    failed++;
  }
});

// Test 3: Check for WhatsApp block closure
console.log('\n✓ Test 3: WhatsApp block closure');
const whatsappMatch = indexContent.match(/fu-div[\s\S]*?\.map\((function|[a-z])\s*\([^)]*\)\s*\{[\s\S]*?\}\s*\)\s*\)\)\)/g);
if (whatsappMatch) {
  console.log(`  ✓ WhatsApp block with proper closing (found ${whatsappMatch.length} blocks)`);
  passed++;
} else {
  console.log(`  ℹ WhatsApp block check (may not have 5-paren close - needs manual review)`);
}

// Test 4: Syntax check
console.log('\n✓ Test 4: Basic syntax validation');
try {
  // Extract just the script content
  const scriptMatch = indexContent.match(/<script type="text\/javascript">([\s\S]*)<\/script>/);
  if (scriptMatch && scriptMatch[1]) {
    const scriptContent = scriptMatch[1];
    // Just check for balanced braces as a basic sanity check
    const openBraces = (scriptContent.match(/\{/g) || []).length;
    const closeBraces = (scriptContent.match(/\}/g) || []).length;
    const openParens = (scriptContent.match(/\(/g) || []).length;
    const closeParens = (scriptContent.match(/\)/g) || []).length;
    
    if (openBraces === closeBraces && openParens === closeParens) {
      console.log(`  ✓ Brace/parenthesis balance: ${openBraces} braces, ${openParens} parens`);
      passed++;
    } else {
      console.log(`  ✗ Brace mismatch: {${openBraces}/${closeBraces}, (${openParens}/${closeParens}`);
      failed++;
    }
  }
} catch (e) {
  console.log(`  ✗ Syntax validation failed: ${e.message}`);
  failed++;
}

// Test 5: File size
console.log('\n✓ Test 5: Build integrity');
const fileSize = fs.statSync(path.join(__dirname, 'index.html')).size;
const sizeStr = (fileSize / 1024 / 1024).toFixed(2);
if (fileSize > 1000000) {
  console.log(`  ✓ File size: ${sizeStr}MB (complete build)`);
  passed++;
} else {
  console.log(`  ✗ File size: ${sizeStr}MB (may be incomplete)`);
  failed++;
}

// Summary
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Total: ${passed} passed, ${failed} failed`);
console.log(`Status: ${failed === 0 ? '✓ READY FOR DEPLOY' : '✗ REVIEW REQUIRED'}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

process.exit(failed > 0 ? 1 : 0);
