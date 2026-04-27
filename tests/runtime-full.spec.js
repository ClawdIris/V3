const { test, expect } = require('@playwright/test');

const TARGET_URL = 'file:///Users/joshua/Desktop/Cursor/index.html';

function shouldIgnoreRequestFailure(url) {
  return url.startsWith('data:') || url.startsWith('blob:');
}

test.describe('Runtime QA sweep', () => {
  for (const view of [
    { name: 'desktop', viewport: { width: 1440, height: 900 } },
    {
      name: 'mobile',
      viewport: { width: 390, height: 844 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true,
      hasTouch: true,
    },
  ]) {
    test(`full smoke - ${view.name}`, async ({ browser }) => {
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

      const clickable = page.locator('button:visible, [role=\"button\"]:visible, a:visible');
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

      console.log(
        JSON.stringify({
          view: view.name,
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
        })
      );

      await page.screenshot({
        path: `test-results/runtime-${view.name}.png`,
        fullPage: true,
      });

      await context.close();
    });
  }
});
