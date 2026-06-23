const { test, expect } = require('@playwright/test');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Target under test.
//   Default: the in-repo index.html (the REAL build, single-file app).
//   Override: set CASABE_TARGET_URL to a debug-branch preview or local serve,
//             e.g. CASABE_TARGET_URL="https://debug--casabe.netlify.app"
//
// NOTE (FixForge P4 fix, 2026-06-22): previously hard-coded to a stale April
// copy at ~/Desktop/Cursor/index.html, which made every result meaningless.
// Now resolves to the repo build so a test_id maps to the code under review.
// ─────────────────────────────────────────────────────────────────────────────
const TARGET_URL =
  process.env.CASABE_TARGET_URL ||
  'file://' + path.resolve(__dirname, '..', 'index.html');

function shouldIgnoreRequestFailure(url) {
  return url.startsWith('data:') || url.startsWith('blob:');
}

// Stable test_ids — ShipmentTester references these in bug entries; FixForge
// re-runs exactly one with:  npm run verify -- --grep "RUNTIME-DESKTOP-001"
const VIEWS = [
  {
    test_id: 'RUNTIME-DESKTOP-001',
    name: 'desktop',
    viewport: { width: 1440, height: 900 },
  },
  {
    test_id: 'RUNTIME-MOBILE-001',
    name: 'mobile',
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
  },
];

test.describe('Runtime QA sweep', () => {
  for (const view of VIEWS) {
    // test_id is the FIRST token of the title -> grep-addressable, stable.
    test(`${view.test_id} full smoke - ${view.name}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: view.viewport,
        userAgent: view.userAgent,
        isMobile: view.isMobile,
        hasTouch: view.hasTouch,
      });
      const page = await context.newPage();

      const consoleErrors = [];
      const pageErrors = [];
      const requestFailures = [];
      const responseErrors = [];

      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
      });
      page.on('pageerror', (e) => pageErrors.push(e.message));
      page.on('requestfailed', (r) => {
        const url = r.url();
        if (!shouldIgnoreRequestFailure(url)) {
          requestFailures.push(`${url} :: ${r.failure() ? r.failure().errorText : 'unknown error'}`);
        }
      });
      page.on('response', (r) => {
        if (r.status() >= 400) responseErrors.push(`${r.status()} ${r.url()}`);
      });

      await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 120000 });
      await expect(page.locator('#root')).toBeVisible();
      await expect(page).toHaveTitle(/Casabe/i);

      const clickable = page.locator('button:visible, [role="button"]:visible, a:visible');
      const count = await clickable.count();
      const max = Math.min(count, 60);
      let clickFailures = 0;

      for (let i = 0; i < max; i++) {
        try {
          await clickable.nth(i).click({ timeout: 2500 });
          await page.waitForTimeout(120);
        } catch (_) {
          clickFailures++;
        }
      }

      const summary = {
        test_id: view.test_id,
        view: view.name,
        target: TARGET_URL,
        title: await page.title(),
        clickableFound: count,
        clickTested: max,
        clickFailures,
        consoleErrors: consoleErrors.length,
        pageErrors: pageErrors.length,
        requestFailures: requestFailures.length,
        responseErrors: responseErrors.length,
        firstConsoleErrors: consoleErrors.slice(0, 8),
        firstPageErrors: pageErrors.slice(0, 8),
        firstRequestFailures: requestFailures.slice(0, 8),
        firstResponseErrors: responseErrors.slice(0, 8),
      };
      console.log(JSON.stringify(summary));

      await page.screenshot({
        path: `test-results/runtime-${view.name}.png`,
        fullPage: true,
      });

      await context.close();

      // ── Pass/fail gate ──────────────────────────────────────────────────
      // Uncaught JS exceptions are real breakage -> hard fail (this is what
      // makes the test a meaningful gate, not just a logger). Console errors
      // and request failures are reported in the summary above but do not
      // fail the run on their own (third-party noise, blocked analytics, etc).
      expect(pageErrors, `Uncaught JS exceptions on ${view.name}: ${pageErrors.slice(0, 3).join(' | ')}`).toEqual([]);
    });
  }
});
