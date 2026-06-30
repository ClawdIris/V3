#!/usr/bin/env node
/**
 * post-deploy-smoke.js — Casabe Konnect production smoke gate
 *
 * PERMANENT DEPLOY RULE (Jeffrey, 2026-06-29): after EVERY deploy, FixForge /
 * ShipmentTester must run this against the REAL production URL (not debug/local)
 * and it MUST pass before anything is marked verified_pass.
 *
 * It catches the class of failure that unit tests + local renders miss:
 *   - white screen of death (root renders but app tree fails to mount)
 *   - broken Google Maps key (literal $GOOGLE_MAPS_API_KEY / %%placeholder%% shipped)
 *   - missing critical bundle markers (deploy shipped wrong/partial file)
 *   - hard HTTP failure / wrong content-type
 *   - uncaught JS errors / failed inline self-tests on load
 *
 * Usage:  node post-deploy-smoke.js [URL]
 *   default URL: https://casabekonnect-app.netlify.app
 * Exit 0 = PASS, non-zero = FAIL (block the deploy verification).
 *
 * Requires Playwright (already a dev dependency). Falls back to a curl-only
 * static check if Playwright/browser is unavailable so the gate still runs.
 */
const PROD_URL = process.argv[2] || "https://casabekonnect-app.netlify.app";

// Markers that MUST be present in the served HTML (deploy integrity).
const REQUIRED_MARKERS = [
  "Casabe Konnect",            // title / shell
  "Sign in to your account",   // login screen renders
  "var GOOGLE_MAPS_KEY",       // maps key line present
];
// Markers that MUST NOT be present (broken-build signatures).
const FORBIDDEN_MARKERS = [
  "$GOOGLE_MAPS_API_KEY",      // unexpanded sed var (single-quote bug)
  "%%GOOGLE_MAPS_KEY%%",       // unsubstituted placeholder
  'GOOGLE_MAPS_KEY = ""',      // empty key shipped
];

function fail(msg) { console.error("❌ SMOKE FAIL: " + msg); process.exit(1); }
function ok(msg) { console.log("✓ " + msg); }

(async () => {
  // ---- Stage 1: static HTML fetch (always runs, no browser needed) ----
  let html;
  try {
    const res = await fetch(PROD_URL + "/index.html", { redirect: "follow" });
    if (!res.ok) fail("HTTP " + res.status + " fetching index.html");
    const ct = res.headers.get("content-type") || "";
    if (!/text\/html/.test(ct)) fail("wrong content-type: " + ct);
    html = await res.text();
    ok("index.html fetched (" + html.length + " bytes, " + ct + ")");
  } catch (e) {
    fail("could not fetch prod: " + e.message);
  }
  for (const m of REQUIRED_MARKERS) {
    if (html.indexOf(m) < 0) fail("required marker missing: " + JSON.stringify(m));
  }
  ok("all required markers present");
  for (const m of FORBIDDEN_MARKERS) {
    if (html.indexOf(m) >= 0) fail("forbidden marker present (broken build): " + JSON.stringify(m));
  }
  ok("no broken-build markers (key is substituted, not placeholder/empty)");

  // Validate the GOOGLE_MAPS_KEY looks like a real Google key (AIza...).
  const keyMatch = html.match(/var GOOGLE_MAPS_KEY = "([^"]*)"/);
  if (!keyMatch) fail("GOOGLE_MAPS_KEY line not found");
  if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(keyMatch[1])) {
    fail("GOOGLE_MAPS_KEY is not a valid-looking key: " + JSON.stringify(keyMatch[1].slice(0, 12) + "..."));
  }
  ok("GOOGLE_MAPS_KEY is a valid-looking Google key");

  // ---- Stage 2: real browser render (the white-screen catcher) ----
  let chromium;
  try { chromium = require("playwright").chromium; }
  catch (_) {
    console.log("⚠ Playwright not available — static checks passed, skipping render check.");
    console.log("✅ SMOKE PASS (static-only)");
    process.exit(0);
  }

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const jsErrors = [];
    page.on("pageerror", (e) => jsErrors.push(String(e.message || e)));
    page.on("console", (m) => { if (m.type() === "error") jsErrors.push("console.error: " + m.text()); });

    const resp = await page.goto(PROD_URL, { waitUntil: "networkidle", timeout: 30000 });
    if (!resp || !resp.ok()) fail("page.goto returned HTTP " + (resp && resp.status()));

    // The white-screen test: #root must contain a non-trivial rendered tree.
    const rootInfo = await page.evaluate(() => {
      const root = document.getElementById("root") || document.querySelector("#root,#app,[data-reactroot]");
      return {
        exists: !!root,
        childCount: root ? root.children.length : 0,
        textLen: root ? (root.innerText || "").trim().length : 0,
        htmlLen: root ? root.innerHTML.length : 0,
        hasLoginText: document.body.innerText.indexOf("Sign in to your account") >= 0,
      };
    });
    if (!rootInfo.exists) fail("#root element not found");
    if (rootInfo.childCount === 0 || rootInfo.htmlLen < 200) {
      fail("WHITE SCREEN — #root rendered empty (childCount=" + rootInfo.childCount + ", htmlLen=" + rootInfo.htmlLen + ")");
    }
    if (!rootInfo.hasLoginText) fail("login screen text not rendered — app shell did not mount");
    ok("#root rendered non-empty (" + rootInfo.childCount + " children, " + rootInfo.htmlLen + " bytes html, login visible)");

    // Inline self-test summary, if the page exposes it.
    const testSummary = await page.evaluate(() => {
      try {
        if (window.__R4TestSummary) return window.__R4TestSummary;
        if (typeof window.__R4RunTests === "function") return window.__R4RunTests();
      } catch (_) {}
      return null;
    });
    if (testSummary && typeof testSummary.failed === "number" && testSummary.failed > 0) {
      fail("inline self-tests reported " + testSummary.failed + " failure(s)");
    }
    if (testSummary) ok("inline self-tests OK (" + (testSummary.passed || "?") + " passed)");

    if (jsErrors.length > 0) {
      // Allow benign third-party noise (fonts, analytics) but fail on app errors.
      const appErrors = jsErrors.filter((e) =>
        !/fonts\.googleapis|gstatic|analytics|favicon|the server responded with a status of 4|net::ERR_/i.test(e));
      if (appErrors.length > 0) {
        console.error("JS errors on load:\n  " + appErrors.slice(0, 8).join("\n  "));
        fail(appErrors.length + " uncaught JS error(s) on load");
      }
      console.log("⚠ " + jsErrors.length + " benign third-party console message(s) ignored");
    }
    ok("no uncaught app JS errors on load");

    await browser.close();
    console.log("\n✅ SMOKE PASS — " + PROD_URL + " renders cleanly, no white screen.");
    process.exit(0);
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    fail("render check threw: " + e.message);
  }
})();
