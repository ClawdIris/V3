// test-mobile-dashboard.js
// Tests: Spanish dashboard labels, English absent in ES mode, notranslate on dynamic data,
// Mobile CSS stacking rules, no old cramped 3-column mobile layout.

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");

let passed = 0;
let failed = 0;
function pass(name) { console.log("  PASS:", name); passed++; }
function fail(name, detail) { console.error("  FAIL:", name, detail || ""); failed++; }

// ── 1. Spanish dashboard stat-card translations present ───────────────────
const esLabels = [
  ["Total de Órdenes", "ES: Total Orders"],
  ["Todo el tiempo", "ES: All time"],
  ["Activo en Sistema", "ES: Active in System"],
  ["En tránsito/almacén", "ES: In transit/warehouse"],
  ["Completado", "ES: Completed"],
  ["Entregado", "ES: Delivered"],
  ["Ingresos Netos", "ES: Net Revenue"],
  ["Después de comisiones", "ES: After commissions"],
];
console.log("\n[1] Spanish label translations present in ES dict:");
for (const [term, label] of esLabels) {
  src.includes('"' + term + '"') ? pass(label) : fail(label, `"${term}" not found`);
}

// ── 2. Stat card labels wrapped in t() ────────────────────────────────────
console.log("\n[2] Stat card labels wrapped in t():");
const tWraps = [
  ['t("Total Orders"', "t() wrap: Total Orders"],
  ['t("All time"', "t() wrap: All time"],
  ['t("Active in System"', "t() wrap: Active in System"],
  ['t("In transit/warehouse"', "t() wrap: In transit/warehouse"],
  ['t("Completed"', "t() wrap: Completed"],
  ['t("Delivered"', "t() wrap: Delivered"],
];
for (const [snippet, label] of tWraps) {
  src.includes(snippet) ? pass(label) : fail(label, `${snippet} not found`);
}

// ── 3. English labels NOT appearing bare (unwrapped) in HQ Dashboard stat cards ────────
console.log("\n[3] Bare hardcoded English labels absent from HQ Dashboard stat card object:");
// These were the bare strings before the fix in the HQ dashboard; after fix they should
// only appear inside t(). We use context-specific patterns tied to the HQ dashboard component.
const bareEnglish = [
  // These patterns are specific to the HQ dashboard (use 📦 emoji + sc-a combo as anchor):
  // d: "All time" would appear with the Total Orders card (sc-a)
  ['d: "All time"', "bare: All time in HQ sc-a card"],
  // Active in System + sc-b combo
  ['l: "Active in System"', "bare: Active in System (HQ dashboard)"],
  // In transit/warehouse was only in HQ dashboard card
  ['d: "In transit/warehouse"', "bare: In transit/warehouse"],
  // After fix: HQ top card Delivered has t() wrap + sc-p context check
  // The specific multiline pattern unique to the HQ top-4 card block
  ['l: "Delivered",\n    v: delivered,\n    d: "Completed"', "bare: HQ Delivered+Completed card block"],
  ['d: "Completed",\n    i: "\u2705"', "bare: Completed delta in HQ sc-p card"],
];
for (const [snippet, label] of bareEnglish) {
  !src.includes(snippet) ? pass(label) : fail(label, `Still found: ${snippet}`);
}

// ── 4. notranslate present on dynamic data ────────────────────────────────
console.log("\n[4] notranslate class present on dynamic data elements:");
src.includes("notranslate") ? pass("notranslate class exists in codebase") : fail("notranslate class not found");
src.includes(".notranslate{") ? pass(".notranslate CSS rule defined") : fail(".notranslate CSS not defined");

// ── 5. Mobile CSS stacking rules present ─────────────────────────────────
console.log("\n[5] Mobile CSS dashboard stacking rules:");
const mobileCss = [
  ["max-width:480px", "480px breakpoint exists"],
  ["max-width:390px", "390px breakpoint exists"],
  [".g21{grid-template-columns:1fr!important}", "g21 → 1col at 480px"],
  [".g2{grid-template-columns:1fr!important}", "g2 → 1col at 480px"],
  [".g3{grid-template-columns:1fr!important}", "g3 → 1col at 480px"],
];
for (const [snippet, label] of mobileCss) {
  src.includes(snippet) ? pass(label) : fail(label, `Not found: ${snippet}`);
}

// ── 6. No old cramped 3-column mobile layout ─────────────────────────────
console.log("\n[6] No cramped 3-col mobile layout at phone widths:");
// The 420px block previously only had sg4 and sg3 rules; g21/g2/g3 were not touched.
// Verify g21 is now handled at ≤480px (already checked above).
// Also verify table min-width is not forcing horizontal scroll without overflow-x:auto wrapper.
src.includes(".tbl{overflow-x:auto") ? pass("Table overflow-x:auto wrapper present") : fail("Table overflow-x:auto wrapper missing");
src.includes(".g21{grid-template-columns:1fr!important}") ? pass("g21 collapses on mobile (no 2fr 1fr squeeze)") : fail("g21 still 2fr 1fr on small screens");

// ── 7. Dashboard lower section — no 3-col mobile layout ──────────────────
console.log("\n[7] Dashboard lower section — 3-col collapse rules:");
const collapseChecks = [
  [".g21 .g2{grid-template-columns:1fr!important}", "g21 inner g2 collapses at 480px"],
  ["max-width:480px", "480px breakpoint exists"],
  ["max-width:390px", "390px breakpoint exists"],
];
for (const [snippet, label] of collapseChecks) {
  src.includes(snippet) ? pass(label) : fail(label, `Not found: ${snippet}`);
}
// Also confirm g3 collapses at 480px
src.includes(".g3{grid-template-columns:1fr!important}") || src.includes(".g3{grid-template-columns:1fr 1fr!important}") ? pass("g3 has mobile collapse rule") : fail("g3 mobile collapse rule missing");

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n── Summary: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
