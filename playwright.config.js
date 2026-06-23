// playwright.config.js — Casabe Konnect runtime QA harness
// ─────────────────────────────────────────────────────────────────────────────
// Scopes Playwright to *.spec.js ONLY so it never collides with the Jest unit
// suite (tests/*.test.js, run via `npm test`). Emits machine-readable JSON to
// test-results/results.json so an automated agent (ShipmentTester / FixForge)
// can map a test_id -> pass/fail without scraping stdout.
//
// Target under test defaults to the in-repo index.html (the real build), and is
// overridable with CASABE_TARGET_URL for debug-branch previews or a local serve.
//   e.g.  CASABE_TARGET_URL="https://debug--casabe.netlify.app" npm run test:e2e
// ─────────────────────────────────────────────────────────────────────────────
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js', // Jest owns *.test.js; Playwright owns *.spec.js
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  // Machine-readable pass/fail + human list. JSON is the contract for agents.
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  outputDir: 'test-results/artifacts',
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
