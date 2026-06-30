/**
 * authenticated-render.spec.js — Casabe Konnect per-role post-login white-screen gate
 *
 * P0 (Jeffrey, 2026-06-30): the unauthenticated smoke gate did NOT catch the white
 * screen because it only checks the login page. THIS gate logs in as each of the 4
 * Hermes roles and asserts the AUTHENTICATED app renders real content (not a blank
 * #root). It also fails if the top-level ErrorBoundary fallback appears or any
 * uncaught error fires, and exercises a scroll (the mobile white-screen trigger).
 *
 * Target: real prod by default; override with CASABE_TARGET_URL.
 * Creds: from .env.shipmenttester (source it first) or the CASABE_* env vars below.
 *
 * Run:
 *   source .env.shipmenttester
 *   CASABE_TARGET_URL=https://casabekonnect-app.netlify.app npx playwright test authenticated-render.spec.js
 */
const { test, expect, devices } = require('@playwright/test');

const BASE = process.env.CASABE_TARGET_URL || 'https://casabekonnect-app.netlify.app';
const PW = process.env.CASABE_TEST_PASSWORD || process.env.CASABE_LOGIN_PASSWORD || 'CasabeTest2026!';

const ROLES = [
  { role: 'hq',       email: process.env.CASABE_HQ_EMAIL       || 'hermes-hq@casabekonnect.test' },
  { role: 'office',   email: process.env.CASABE_OFFICE_EMAIL   || 'hermes-office@casabekonnect.test' },
  { role: 'driver',   email: process.env.CASABE_DRIVER_EMAIL   || 'hermes-driver@casabekonnect.test' },
  { role: 'customer', email: process.env.CASABE_CUSTOMER_EMAIL || 'hermes-customer@casabekonnect.test' },
];

// Both viewports — the white screen reproduced on mobile-scroll.
const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1280, height: 900 } },
  { name: 'mobile',  viewport: devices['iPhone 13'].viewport },
];

async function login(page, email, password) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[type="email"], input[placeholder*="casabexpress"]', { timeout: 20000 });
  const emailInput = page.locator('input[type="email"], input[placeholder*="casabexpress"]').first();
  const pwInput = page.locator('input[type="password"]').first();
  await emailInput.fill(email);
  await pwInput.fill(password);
  await page.locator('button:has-text("Sign In")').first().click();
  // Wait for the login form to go away (auth round-trip can be slow on a
  // proxy-less headless network). The button shows "Please wait…" while pending.
  await page.waitForFunction(
    () => !(document.body.innerText || '').includes('Sign in to your account'),
    { timeout: 60000 }
  ).catch(() => {});
}

for (const vp of VIEWPORTS) {
  for (const acct of ROLES) {
    test(`AUTH-${vp.name}-${acct.role}: ${acct.email} renders authenticated content (no white screen)`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: vp.viewport });
      const page = await context.newPage();

      const jsErrors = [];
      page.on('pageerror', (e) => jsErrors.push(String(e.message || e)));

      await login(page, acct.email, PW);

      // Wait for the auth gate to resolve past "Loading…" into real app content.
      // Poll #root for non-trivial content; fail on blank (white screen) or error fallback.
      await page.waitForFunction(() => {
        const root = document.getElementById('root');
        if (!root) return false;
        const txt = (root.innerText || '').trim();
        if (txt === 'Loading…' || txt === '') return false;
        return root.innerHTML.length > 500;
      }, { timeout: 30000 }).catch(() => {});

      // Assert NOT blank.
      const rootState = await page.evaluate(() => {
        const root = document.getElementById('root');
        return {
          htmlLen: root ? root.innerHTML.length : 0,
          textLen: root ? (root.innerText || '').trim().length : 0,
          text: root ? (root.innerText || '').trim().slice(0, 120) : '',
          errorBoundaryShown: !!(document.body.innerText || '').includes('Something went wrong'),
          stillLoading: root ? (root.innerText || '').trim() === 'Loading…' : false,
          appError: window.__APP_LAST_ERROR || null,
          onLoginScreen: (document.body.innerText || '').includes('Sign in to your account'),
        };
      });

      expect(rootState.errorBoundaryShown, 'ErrorBoundary fallback should not appear: ' + JSON.stringify(rootState.appError)).toBe(false);
      expect(rootState.stillLoading, 'app stuck on Loading… (slow membership query / auth hang)').toBe(false);
      expect(rootState.onLoginScreen, 'login failed — bounced back to login screen (check creds / auth schema)').toBe(false);
      expect(rootState.htmlLen, `WHITE SCREEN — #root blank after login as ${acct.role}`).toBeGreaterThan(500);

      // Exercise the mobile white-screen trigger: scroll the page, then re-assert.
      await page.evaluate(async () => {
        const page = document.querySelector('.page') || document.scrollingElement;
        for (const y of [200, 800, 1600]) {
          if (page) page.scrollTop = y;
          window.scrollTo(0, y);
          window.dispatchEvent(new Event('scroll'));
          await new Promise((r) => setTimeout(r, 120));
        }
      });
      await page.waitForTimeout(600);

      const afterScroll = await page.evaluate(() => {
        const root = document.getElementById('root');
        return {
          htmlLen: root ? root.innerHTML.length : 0,
          errorBoundaryShown: !!(document.body.innerText || '').includes('Something went wrong'),
        };
      });
      expect(afterScroll.errorBoundaryShown, 'ErrorBoundary appeared after scroll').toBe(false);
      expect(afterScroll.htmlLen, `WHITE SCREEN ON SCROLL — #root blanked after scrolling as ${acct.role} (${vp.name})`).toBeGreaterThan(500);

      // No uncaught JS errors (filter benign third-party noise).
      const appErrors = jsErrors.filter((e) => !/fonts\.googleapis|gstatic|favicon|net::ERR_|status of 4/i.test(e));
      expect(appErrors, 'uncaught app JS errors: ' + appErrors.join(' | ')).toEqual([]);

      await context.close();
    });
  }
}
