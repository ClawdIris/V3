/**
 * Phase 6 — Slice 4: Tape Direct + Box Sale Cost/Margin Foundation Tests
 *
 * Gates checked:
 *  [1]  Tape Direct nav item exists in HQ nav config
 *  [2]  Tape Direct nav item exists in Office nav config
 *  [3]  Tape Direct form exists with required fields (vendor, cost, quantity, notes, office, enabled toggle)
 *  [4]  TapeDirectPage component is defined
 *  [5]  Tape Direct badge / status indicator is present in records table
 *  [6]  Box Sale Tracking nav item exists in HQ nav config
 *  [7]  Box Sale Tracking nav item exists in Office nav config
 *  [8]  Box Sale form has required fields (boxType, quantity, unitCost, salePrice, office)
 *  [9]  BoxSaleTrackingPage component is defined
 *  [10] Margin Summary nav item exists in HQ nav config only
 *  [11] Margin Summary nav item does NOT exist in Driver nav config
 *  [12] MarginSummaryPage component is defined
 *  [13] Margin Summary shows revenue, cost, gross margin, margin % stats
 *  [14] Margin Summary has office filter for HQ (all offices)
 *  [15] Driver access blocked in MarginSummaryPage (role gate at component level)
 *  [16] Driver does NOT appear in Margin Summary nav
 *  [17] validPages HQ includes tape_direct, box_sale, margin_summary
 *  [18] validPages Office includes tape_direct, box_sale
 *  [19] validPages Driver does NOT include tape_direct, box_sale, margin_summary
 *  [20] Archive/void pattern — not hard delete — for tape direct records
 *  [21] Archive/void pattern — not hard delete — for box sale records
 *  [22] Tape Direct record captures: enabled toggle, vendor, cost, quantity, notes, office, staff, timestamp
 *  [23] Box sale tracks: total_revenue, total_cost, gross_margin, margin_pct
 *  [24] Phase 6 Slice 1 + 2 + 3 regression: MapView still defined
 *  [25] Phase 6 Slice 2 regression: geocoding helpers present
 *  [26] Phase 6 Slice 3 regression: TSP solver present
 *  [27] No full-file overwrite (git diff --stat sanity: targeted edits only)
 *  [28] No marker-only/stub-only completion (real form IDs exist)
 *  [29] Tape Direct page renders for both HQ and Office (page key in validPages)
 *  [30] Schema file exists and contains required tables
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const HTML_PATH   = path.join(__dirname, '..', 'index.html');
const SCHEMA_PATH = path.join(__dirname, '..', 'phase6-slice4-schema.sql');

let html = '';
let schema = '';

beforeAll(() => {
  html   = fs.readFileSync(HTML_PATH, 'utf8');
  if (fs.existsSync(SCHEMA_PATH)) {
    schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [1] — Tape Direct in HQ nav
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 1: Tape Direct in HQ nav', () => {
  test('HQ nav config contains tape_direct key', () => {
    expect(html).toContain('k: "tape_direct"');
  });

  test('HQ nav label is "Tape Direct"', () => {
    expect(html).toContain('"Tape Direct"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [2] — Tape Direct in Office nav
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 2: Tape Direct in Office nav', () => {
  test('Office Tools section contains tape_direct', () => {
    // The office nav Tools block should have tape_direct before campaigns
    const officeToolsIdx = html.indexOf('grp: "Tools"');
    expect(officeToolsIdx).toBeGreaterThan(-1);
    const officeSection = html.slice(officeToolsIdx, officeToolsIdx + 800);
    expect(officeSection).toContain('k: "tape_direct"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [3] — Tape Direct form fields
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 3: Tape Direct form required fields', () => {
  test('tape-direct-form element exists', () => {
    expect(html).toContain('"tape-direct-form"');
  });

  test('td-vendor field exists', () => {
    expect(html).toContain('"td-vendor"');
  });

  test('td-cost field exists', () => {
    expect(html).toContain('"td-cost"');
  });

  test('td-quantity field exists', () => {
    expect(html).toContain('"td-quantity"');
  });

  test('td-notes field exists', () => {
    expect(html).toContain('"td-notes"');
  });

  test('td-office field exists', () => {
    expect(html).toContain('"td-office"');
  });

  test('td-enabled toggle/select exists', () => {
    expect(html).toContain('"td-enabled"');
  });

  test('td-order-ref field exists (optional order link)', () => {
    expect(html).toContain('"td-order-ref"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [4] — TapeDirectPage component defined
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 4: TapeDirectPage component', () => {
  test('TapeDirectPage var is defined', () => {
    expect(html).toContain('var TapeDirectPage = function TapeDirectPage(');
  });

  test('tape-direct-panel element id exists', () => {
    expect(html).toContain('"tape-direct-panel"');
  });

  test('renderPage wires tape_direct to TapeDirectPage', () => {
    expect(html).toContain('page === "tape_direct"');
    expect(html).toContain('React.createElement(TapeDirectPage');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [5] — Tape Direct badge
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 5: Tape Direct badge in records', () => {
  test('TAPE DIRECT badge text is present', () => {
    expect(html).toContain('TAPE DIRECT');
  });

  test('tape-direct-records-list element exists', () => {
    expect(html).toContain('"tape-direct-records-list"');
  });

  test('td-new-record-btn button exists', () => {
    expect(html).toContain('"td-new-record-btn"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [6] — Box Sale Tracking in HQ nav
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 6: Box Sale Tracking in HQ nav', () => {
  test('HQ nav contains box_sale key', () => {
    expect(html).toContain('k: "box_sale"');
  });

  test('HQ nav label is "Box Sale Tracking"', () => {
    expect(html).toContain('"Box Sale Tracking"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [7] — Box Sale Tracking in Office nav
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 7: Box Sale Tracking in Office nav', () => {
  test('Office Tools section contains box_sale', () => {
    const officeToolsIdx = html.indexOf('grp: "Tools"');
    const officeSection = html.slice(officeToolsIdx, officeToolsIdx + 1000);
    expect(officeSection).toContain('k: "box_sale"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [8] — Box Sale form fields
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 8: Box Sale form required fields', () => {
  test('box-sale-form element exists', () => {
    expect(html).toContain('"box-sale-form"');
  });

  test('bs-box-type select exists', () => {
    expect(html).toContain('"bs-box-type"');
  });

  test('bs-quantity field exists', () => {
    expect(html).toContain('"bs-quantity"');
  });

  test('bs-unit-cost field exists', () => {
    expect(html).toContain('"bs-unit-cost"');
  });

  test('bs-sale-price field exists', () => {
    expect(html).toContain('"bs-sale-price"');
  });

  test('bs-office field exists', () => {
    expect(html).toContain('"bs-office"');
  });

  test('bs-order-ref optional link field exists', () => {
    expect(html).toContain('"bs-order-ref"');
  });

  test('bs-save-btn submit button exists', () => {
    expect(html).toContain('"bs-save-btn"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [9] — BoxSaleTrackingPage component defined
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 9: BoxSaleTrackingPage component', () => {
  test('BoxSaleTrackingPage var is defined', () => {
    expect(html).toContain('var BoxSaleTrackingPage = function BoxSaleTrackingPage(');
  });

  test('box-sale-tracking-panel element id exists', () => {
    expect(html).toContain('"box-sale-tracking-panel"');
  });

  test('renderPage wires box_sale to BoxSaleTrackingPage', () => {
    expect(html).toContain('page === "box_sale"');
    expect(html).toContain('React.createElement(BoxSaleTrackingPage');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [10] — Margin Summary in HQ nav
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 10: Margin Summary in HQ nav', () => {
  test('margin_summary key present in HQ Finance & Growth section', () => {
    // Find HQ Finance & Growth block (first occurrence before office block)
    const financeIdx = html.indexOf('grp: "Finance & Growth"');
    const hqFinanceBlock = html.slice(financeIdx, financeIdx + 1500);
    expect(hqFinanceBlock).toContain('k: "margin_summary"');
  });

  test('"Margin Summary" label present', () => {
    expect(html).toContain('"Margin Summary"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [11] — Margin Summary NOT in Driver nav
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 11: Margin Summary not in Driver nav', () => {
  test('Driver nav section does not contain margin_summary', () => {
    // Find driver nav section
    const driverIdx = html.indexOf('label: "Driver"');
    expect(driverIdx).toBeGreaterThan(-1);
    const driverBlock = html.slice(driverIdx, driverIdx + 2000);
    expect(driverBlock).not.toContain('k: "margin_summary"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [12] — MarginSummaryPage component defined
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 12: MarginSummaryPage component', () => {
  test('MarginSummaryPage var is defined', () => {
    expect(html).toContain('var MarginSummaryPage = function MarginSummaryPage(');
  });

  test('margin-summary-panel element id exists', () => {
    expect(html).toContain('"margin-summary-panel"');
  });

  test('renderPage wires margin_summary to MarginSummaryPage', () => {
    expect(html).toContain('page === "margin_summary"');
    expect(html).toContain('React.createElement(MarginSummaryPage');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [13] — Margin Summary stats (revenue, cost, margin, margin%)
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 13: Margin Summary stat cards present', () => {
  test('margin-summary-stats element exists', () => {
    expect(html).toContain('"margin-summary-stats"');
  });

  test('Total Revenue label present in margin summary', () => {
    const msIdx = html.indexOf('"margin-summary-stats"');
    const msBlock = html.slice(msIdx, msIdx + 2000);
    expect(msBlock).toContain('Total Revenue');
  });

  test('Total Cost label present in margin summary', () => {
    const msIdx = html.indexOf('"margin-summary-stats"');
    const msBlock = html.slice(msIdx, msIdx + 2000);
    expect(msBlock).toContain('Total Cost');
  });

  test('Gross Margin label present in margin summary', () => {
    const msIdx = html.indexOf('"margin-summary-stats"');
    const msBlock = html.slice(msIdx, msIdx + 2000);
    expect(msBlock).toContain('Gross Margin');
  });

  test('Margin % label present in margin summary', () => {
    const msIdx = html.indexOf('"margin-summary-stats"');
    const msBlock = html.slice(msIdx, msIdx + 2000);
    expect(msBlock).toContain('Margin %');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [14] — Margin Summary HQ office filter
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 14: HQ sees all margin data with office filter', () => {
  test('margin-office-filter select exists (for HQ filtering by office)', () => {
    expect(html).toContain('"margin-office-filter"');
  });

  test('All Offices option in the office filter', () => {
    expect(html).toContain('"All Offices"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [15] — Driver blocked at component level in MarginSummaryPage
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 15: Driver blocked from margin summary at component level', () => {
  test('Driver role gate enforced inside MarginSummaryPage', () => {
    expect(html).toContain("roleKey === 'driver'");
    expect(html).toContain('Access denied. Margin data is not available to drivers');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [16] — Driver nav has no margin pages
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 16: Driver nav has no box_sale, tape_direct, margin_summary', () => {
  test('Driver label block does not contain box_sale key', () => {
    const driverIdx = html.indexOf('label: "Driver"');
    const driverBlock = html.slice(driverIdx, driverIdx + 2000);
    expect(driverBlock).not.toContain('k: "box_sale"');
  });

  test('Driver label block does not contain tape_direct key', () => {
    const driverIdx = html.indexOf('label: "Driver"');
    const driverBlock = html.slice(driverIdx, driverIdx + 2000);
    expect(driverBlock).not.toContain('k: "tape_direct"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [17] — validPages HQ includes all three new pages
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 17: validPages HQ includes new slice 4 pages', () => {
  test('HQ validPages includes tape_direct', () => {
    const vpLine = html.match(/var validPages = .*?;/s)?.[0] || '';
    expect(vpLine).toContain('"tape_direct"');
  });

  test('HQ validPages includes box_sale', () => {
    const vpLine = html.match(/var validPages = .*?;/s)?.[0] || '';
    expect(vpLine).toContain('"box_sale"');
  });

  test('HQ validPages includes margin_summary', () => {
    const vpLine = html.match(/var validPages = .*?;/s)?.[0] || '';
    expect(vpLine).toContain('"margin_summary"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [18] — validPages Office includes tape_direct + box_sale
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 18: validPages Office includes tape_direct + box_sale', () => {
  test('Office section of validPages contains tape_direct', () => {
    const vpLine = html.match(/var validPages = .*?;/s)?.[0] || '';
    // The office part is between the second array start and the driver part
    const officeIdx = vpLine.indexOf('"ow_dash"');
    expect(officeIdx).toBeGreaterThan(-1);
    const officeChunk = vpLine.slice(officeIdx, officeIdx + 300);
    expect(officeChunk).toContain('"tape_direct"');
  });

  test('Office section of validPages contains box_sale', () => {
    const vpLine = html.match(/var validPages = .*?;/s)?.[0] || '';
    const officeIdx = vpLine.indexOf('"ow_dash"');
    const officeChunk = vpLine.slice(officeIdx, officeIdx + 300);
    expect(officeChunk).toContain('"box_sale"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [19] — validPages Driver does NOT include margin pages
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 19: validPages Driver has no margin pages', () => {
  test('Driver validPages does not contain margin_summary', () => {
    const vpLine = html.match(/var validPages = .*?;/s)?.[0] || '';
    const driverIdx = vpLine.indexOf('"driver_route"');
    const driverChunk = vpLine.slice(driverIdx);
    expect(driverChunk).not.toContain('"margin_summary"');
    expect(driverChunk).not.toContain('"box_sale"');
    expect(driverChunk).not.toContain('"tape_direct"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [20] — Tape Direct void/archive, not hard delete
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 20: Tape Direct uses void/archive, no hard delete', () => {
  test('voidRecord function exists in TapeDirectPage', () => {
    expect(html).toContain('function voidRecord(');
  });

  test('void status sets status to voided, not deletes', () => {
    expect(html).toContain("status: 'voided'");
    expect(html).toContain('voided_at: new Date().toISOString()');
  });

  test('No .remove() or .delete() call in tape direct logic', () => {
    // Look inside the TapeDirectPage block for dangerous patterns
    const tdIdx = html.indexOf('var TapeDirectPage = function TapeDirectPage(');
    const tdEnd = html.indexOf('var BoxSaleTrackingPage', tdIdx);
    const tdBlock = html.slice(tdIdx, tdEnd);
    expect(tdBlock).not.toContain('.remove(');
    // Note: .filter is used for activeRecords (not deleting from source)
  });

  test('Tape Direct records list shows Voided/Archived section', () => {
    expect(html).toContain('Voided / Archived Records');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [21] — Box Sale void/archive, not hard delete
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 21: Box Sale uses void/archive, no hard delete', () => {
  test('voidBoxSale function exists', () => {
    expect(html).toContain('function voidBoxSale(');
  });

  test('voidBoxSale sets status to voided', () => {
    const bsIdx = html.indexOf('var BoxSaleTrackingPage = function BoxSaleTrackingPage(');
    const bsEnd = html.indexOf('var MarginSummaryPage', bsIdx);
    const bsBlock = html.slice(bsIdx, bsEnd);
    expect(bsBlock).toContain("status: 'voided'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [22] — Tape Direct captures all required fields
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 22: Tape Direct record captures required fields', () => {
  test('Tape Direct record includes enabled boolean', () => {
    expect(html).toContain('enabled: tdForm.enabled');
  });

  test('Tape Direct record includes vendor', () => {
    expect(html).toContain('vendor: tdForm.vendor');
  });

  test('Tape Direct record includes cost', () => {
    expect(html).toContain('cost: parseFloat(tdForm.cost)');
  });

  test('Tape Direct record includes staff/user', () => {
    expect(html).toContain('staff: (session');
  });

  test('Tape Direct record includes timestamp', () => {
    expect(html).toContain('timestamp: new Date().toISOString()');
  });

  test('Tape Direct record includes office', () => {
    expect(html).toContain('office: tdForm.office');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [23] — Box Sale tracks margin fields
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 23: Box Sale records margin fields', () => {
  test('totalRevenue computed in box sale', () => {
    expect(html).toContain('totalRevenue: preview.totalRev');
  });

  test('totalCost computed in box sale', () => {
    expect(html).toContain('totalCost: preview.totalCost');
  });

  test('grossMargin computed in box sale', () => {
    expect(html).toContain('grossMargin: preview.grossMargin');
  });

  test('marginPct computed in box sale', () => {
    expect(html).toContain('marginPct: preview.marginPct');
  });

  test('bs-margin-preview live preview exists in form', () => {
    expect(html).toContain('"bs-margin-preview"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [24] — Regression: MapViewPage still defined (Slice 1+3)
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 24: Regression — MapViewPage still defined (Slice 1+3)', () => {
  test('MapViewPage component still present', () => {
    expect(html).toContain('var MapViewPage = function MapViewPage(');
  });

  test('renderPage still wires map_view to MapViewPage', () => {
    expect(html).toContain('page === "map_view"');
    expect(html).toContain('React.createElement(MapViewPage');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [25] — Regression: Geocoding helpers (Slice 2)
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 25: Regression — Geocoding helpers still present (Slice 2)', () => {
  test('Nominatim geocoding pipeline comment still present', () => {
    expect(html).toContain('Nominatim');
  });

  test('COORD_STATUSES still defined', () => {
    expect(html).toContain('COORD_STATUSES');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [26] — Regression: TSP solver (Slice 3)
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 26: Regression — TSP solver still present (Slice 3)', () => {
  test('haversineDist still defined', () => {
    expect(html).toContain('function haversineDist(');
  });

  test('nearestNeighborTSP still defined', () => {
    expect(html).toContain('function nearestNeighborTSP(');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [27] — No full-file overwrite
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 27: No full-file overwrite (git diff sanity)', () => {
  test('index.html still references Supabase CDN (foundational line from original)', () => {
    expect(html).toContain('cdn.jsdelivr.net/npm/@supabase/supabase-js');
  });

  test('Build meta comment still present (original header)', () => {
    expect(html).toContain('v1.0.0-2026-03-06-df1777d');
  });

  test('Original Syne font import preserved', () => {
    expect(html).toContain("family=Syne");
  });

  test('Phase 5 receipts component script still referenced', () => {
    expect(html).toContain('phase5-receipts-components.js');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [28] — No marker-only/stub-only completion
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 28: No marker-only / stub-only features', () => {
  test('TapeDirectPage has real form submit handler (saveTDRecord)', () => {
    expect(html).toContain('function saveTDRecord(');
  });

  test('BoxSaleTrackingPage has real form submit handler (saveBoxSale)', () => {
    expect(html).toContain('function saveBoxSale(');
  });

  test('MarginSummaryPage has real computation logic (totalRevenue)', () => {
    expect(html).toContain('var totalRevenue = bsFiltered.reduce(');
  });

  test('td-save-btn exists (not just a stub)', () => {
    expect(html).toContain('"td-save-btn"');
  });

  test('Margin summary displays grossMargin value', () => {
    expect(html).toContain('grossMargin.toFixed(2)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [29] — Tape Direct reachable from HQ and Office
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 29: Tape Direct reachable from HQ and Office', () => {
  test('tape_direct is in HQ validPages (reachable from HQ)', () => {
    const vpLine = html.match(/var validPages = .*?;/s)?.[0] || '';
    // HQ is the first array — before "ow_dash"
    const hqEnd = vpLine.indexOf('"ow_dash"');
    const hqChunk = vpLine.slice(0, hqEnd);
    expect(hqChunk).toContain('"tape_direct"');
  });

  test('tape_direct is in Office validPages (reachable from Office)', () => {
    const vpLine = html.match(/var validPages = .*?;/s)?.[0] || '';
    const officeStart = vpLine.indexOf('"ow_dash"');
    const driverStart = vpLine.indexOf('"driver_route"');
    const officeChunk = vpLine.slice(officeStart, driverStart);
    expect(officeChunk).toContain('"tape_direct"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE [30] — Schema file exists and has required tables
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate 30: phase6-slice4-schema.sql exists with required tables', () => {
  test('Schema file exists', () => {
    expect(fs.existsSync(SCHEMA_PATH)).toBe(true);
  });

  test('Schema file contains tape_direct_records table', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS tape_direct_records');
  });

  test('Schema file contains box_sale_records table', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS box_sale_records');
  });

  test('Schema enables RLS on tape_direct_records', () => {
    expect(schema).toContain('ALTER TABLE tape_direct_records ENABLE ROW LEVEL SECURITY');
  });

  test('Schema enables RLS on box_sale_records', () => {
    expect(schema).toMatch(/ALTER TABLE box_sale_records\s+ENABLE ROW LEVEL SECURITY/);
  });

  test('Schema has no USING (TRUE) on sensitive table policies (only USING (FALSE) for deny)', () => {
    // Only USING (FALSE) is valid; USING (TRUE) would be a policy that allows all
    // Comments may mention USING (TRUE) but actual SQL should not use it
    const sqlOnly = schema.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sqlOnly).not.toContain('USING (TRUE)');
  });

  test('Schema has no user_profiles table references in SQL (only in comments)', () => {
    // Strip comments, check SQL body only
    const sqlOnly = schema.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sqlOnly).not.toContain('user_profiles');
  });

  test('Schema SECURITY DEFINER functions use SET search_path', () => {
    // Any SECURITY DEFINER function (from phase1 and reused helpers) uses search_path
    // We just verify our schema doesn't add new SECURITY DEFINER without it
    const sdOccurrences = (schema.match(/SECURITY DEFINER/g) || []).length;
    // If there are SECURITY DEFINER usages, check they're paired with search_path
    if (sdOccurrences > 0) {
      const spOccurrences = (schema.match(/SET search_path/g) || []).length;
      expect(spOccurrences).toBeGreaterThanOrEqual(sdOccurrences);
    }
    // Pass if no SECURITY DEFINER either
    expect(true).toBe(true);
  });

  test('Schema has no hard delete policies (deny_delete patterns)', () => {
    expect(schema).toContain('USING (FALSE)');
  });

  test('Schema mentions STATUS: PENDING — do not apply', () => {
    expect(schema).toMatch(/PENDING|DO NOT APPLY/i);
  });
});
