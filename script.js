// Playwright smoke test for Casabe Konnect — Phase 7 Slice 7.1
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('[console.error] ' + msg.text());
  });

  console.log('Navigating to app...');
  await page.goto('http://localhost:8765/index.html?debug=1', { waitUntil: 'networkidle', timeout: 30000 });

  // Click "Test HQ" button
  console.log('Logging in as HQ...');
  try {
    const testHQBtn = await page.waitForSelector('button:has-text("Test HQ"), [data-testid="test-hq"]', { timeout: 5000 });
    await testHQBtn.click();
  } catch (e) {
    // Try finding by text content
    const btns = await page.$$('button');
    let found = false;
    for (const btn of btns) {
      const txt = await btn.textContent();
      if (txt && txt.includes('HQ')) { await btn.click(); found = true; break; }
    }
    if (!found) console.log('WARNING: Test HQ button not found, proceeding...');
  }
  await page.waitForTimeout(3000);

  // Navigate to Receipts & Invoices
  console.log('Navigating to Receipts & Invoices...');
  try {
    const navItem = await page.waitForSelector('text=Receipts', { timeout: 5000 });
    await navItem.click();
  } catch (e) {
    console.log('WARNING: Receipts nav item not found:', e.message);
  }
  await page.waitForTimeout(2000);

  // Check button exists
  const payBtn = await page.$('#generate-payment-link-btn, button:has-text("Generate Payment Link")');
  const btnVisible = payBtn !== null;
  console.log('⚡ Generate Payment Link button visible:', btnVisible);

  // Check for console errors
  const hasErrors = errors.filter(e => 
    !e.includes('favicon') && 
    !e.includes('net::ERR') &&
    !e.includes('Failed to load resource')
  );
  console.log('Console errors:', hasErrors.length === 0 ? 'NONE' : hasErrors.join('\n'));

  // Run test suite
  console.log('Running R4 test suite...');
  const testResults = await page.evaluate(() => {
    if (typeof window.__R4RunTests === 'function') {
      return window.__R4RunTests();
    }
    if (typeof window.__R4TestSummary !== 'undefined') {
      return window.__R4TestSummary;
    }
    return null;
  });
  
  if (testResults) {
    console.log(`\n✅ Test Results: ${testResults.pass}/${testResults.total} passed, ${testResults.fail} failed`);
  } else {
    console.log('Test suite not found (may not have run yet)');
  }

  // Check P6 tests specifically
  const p6Results = await page.evaluate(() => {
    if (window.__R4TestResults) {
      return window.__R4TestResults.filter(r => r.name && r.name.startsWith('P6:'));
    }
    return null;
  });

  if (p6Results) {
    console.log('\nP6 Tests:');
    p6Results.forEach(r => {
      console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.info ? ' — ' + r.info : ''}`);
    });
  }

  // Try clicking Generate Payment Link button to test unconfigured/disabled state
  if (payBtn) {
    console.log('\nChecking Generate Payment Link button state...');
    const isDisabled = await page.evaluate(el => el.disabled || el.hasAttribute('disabled'), payBtn);
    console.log('Button disabled (no order selected):', isDisabled);
    if (!isDisabled) {
      await payBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(3000);
      const unconfiguredBanner = await page.$('text=Stripe is not configured');
      console.log('Unconfigured banner shown:', unconfiguredBanner !== null);
    } else {
      console.log('Button correctly disabled — no order selected (expected behavior)');
    }
  }

  console.log('\n=== SMOKE TEST COMPLETE ===');
  console.log('Button visible:', btnVisible);
  console.log('Console errors:', hasErrors.length === 0 ? '✓ NONE' : '✗ ' + hasErrors.length + ' errors');
  if (testResults) {
    console.log('Test suite:', testResults.fail === 0 ? '✓ ALL PASS' : '✗ ' + testResults.fail + ' FAILED');
    console.log('Total tests:', testResults.total);
  }

  await browser.close();
})().catch(err => {
  console.error('Smoke test error:', err.message);
  process.exit(1);
});
