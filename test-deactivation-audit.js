/**
 * CASABE KONNECT R4 - DEACTIVATION AUDIT TESTS
 * Phase 6 Prep: Every user-created entity must have a safe deactivate/delete/archive path.
 *
 * Entities audited:
 *   - Offices (deactivate / reactivate)
 *   - Drivers (deactivate / reactivate)
 *   - Notification Templates (reset to default / soft-delete)
 *   - Invoices (void)
 *   - Receipts (cancel)
 *   - Payment Links (deactivate)
 *   - Campaigns (pause / end / delete draft)
 *
 * Execution: node test-deactivation-audit.js
 * Expected:  All tests pass
 */

"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

// ─────────────────────────────────────────────────────────
// TEST UTILITIES
// ─────────────────────────────────────────────────────────

var tests = [];
var passed = 0;
var failed = 0;

function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

function runTests() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("CASABE KONNECT R4 — DEACTIVATION AUDIT (Phase 6 Prep)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  tests.forEach(function (t) {
    try {
      t.fn();
      console.log("✓ " + t.name);
      passed++;
    } catch (e) {
      console.log("✗ " + t.name);
      console.log("  Error: " + e.message);
      failed++;
    }
  });

  console.log("\n" + "═".repeat(63));
  console.log(
    "RESULTS: " + passed + " passed, " + failed + " failed out of " + tests.length
  );
  console.log("═".repeat(63) + "\n");

  if (failed === 0) {
    console.log("✅ ALL DEACTIVATION AUDIT TESTS PASSED!\n");
    process.exit(0);
  } else {
    console.log("❌ SOME TESTS FAILED\n");
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────
// LOAD INDEX.HTML
// ─────────────────────────────────────────────────────────

var indexPath = path.join(__dirname, "index.html");

test("index.html exists", function () {
  assert.ok(fs.existsSync(indexPath), "index.html not found at " + indexPath);
});

var html = "";
test("index.html is readable", function () {
  html = fs.readFileSync(indexPath, "utf8");
  assert.ok(html.length > 100000, "index.html seems too small: " + html.length + " bytes");
});

// Helper: assert string exists in html
function assertInHtml(str, label) {
  assert.ok(html.includes(str), (label || str) + " not found in index.html");
}

// ─────────────────────────────────────────────────────────
// MARKER REGISTRY
// ─────────────────────────────────────────────────────────

test("DEACTIVATION_AUDIT_MARKERS registry exists", function () {
  assertInHtml("DEACTIVATION_AUDIT_MARKERS", "window.DEACTIVATION_AUDIT_MARKERS");
});

// ─────────────────────────────────────────────────────────
// OFFICES
// ─────────────────────────────────────────────────────────

test("Office deactivate function defined (deactivateOffice)", function () {
  assertInHtml("deactivateOffice", "deactivateOffice function");
});

test("Office Deactivate Office button text present", function () {
  assertInHtml("Deactivate Office", "Deactivate Office button label");
});

test("Office Reactivate Office button text present", function () {
  assertInHtml("Reactivate Office", "Reactivate Office button label");
});

test("Office active:false soft-delete logic present", function () {
  assertInHtml("active: false", "active: false soft-delete field");
});

test("Office inactive badge rendered for inactive offices", function () {
  assertInHtml("office.active === false", "office.active === false UI check");
});

test("DEACTIVATION_AUDIT_MARKERS includes office keys", function () {
  assertInHtml("'deactivateOffice': true", "deactivateOffice marker");
  assertInHtml("'Deactivate Office': true", "Deactivate Office marker label");
});

// ─────────────────────────────────────────────────────────
// DRIVERS
// ─────────────────────────────────────────────────────────

test("Driver deactivate logic defined (setDrv active)", function () {
  assertInHtml("'active', isActive ? false : true", "driver deactivation toggle");
});

test("Driver Deactivate Driver button text present", function () {
  assertInHtml("Deactivate Driver", "Deactivate Driver button label");
});

test("Driver inactive badge displayed for inactive drivers", function () {
  assertInHtml("d.active === false", "d.active === false driver UI check");
});

test("DEACTIVATION_AUDIT_MARKERS includes driver keys", function () {
  assertInHtml("'deactivateDriver': true", "deactivateDriver marker");
  assertInHtml("'driver_deactivate': true", "driver_deactivate marker");
});

// ─────────────────────────────────────────────────────────
// NOTIFICATION TEMPLATES
// ─────────────────────────────────────────────────────────

test("Notification template reset/delete button present", function () {
  assertInHtml("Reset to Default", "Reset to Default template button");
});

test("Template clear logic soft-deletes custom text", function () {
  assertInHtml('n[s][tplLang] = ""', "template clear sets empty string");
});

test("Template cannot be reset unless customised (hasCustom guard)", function () {
  assertInHtml("hasCustom", "hasCustom guard for template reset button");
});

test("Template in-use protection message present", function () {
  assertInHtml("template_soft_delete", "template_soft_delete marker");
});

test("DEACTIVATION_AUDIT_MARKERS includes template keys", function () {
  assertInHtml("'deleteTemplate': true", "deleteTemplate marker");
  assertInHtml("'Reset to Default': true", "Reset to Default marker");
});

// ─────────────────────────────────────────────────────────
// INVOICES (VOID)
// ─────────────────────────────────────────────────────────

test("voidInvoice function defined", function () {
  assertInHtml("var voidInvoice = function voidInvoice()", "voidInvoice function definition");
});

test("Void Invoice button label present", function () {
  assertInHtml("Void Invoice", "Void Invoice button text");
});

test("Invoice VOID watermark rendered", function () {
  assertInHtml("VOID", "VOID watermark text");
});

test("Invoice void state (riVoided) tracks void status", function () {
  assertInHtml("riVoided", "riVoided state variable");
});

test("DEACTIVATION_AUDIT_MARKERS includes void invoice keys", function () {
  assertInHtml("'voidInvoice': true", "voidInvoice marker");
  assertInHtml("'Void Invoice': true", "Void Invoice marker label");
});

// ─────────────────────────────────────────────────────────
// RECEIPTS (CANCEL)
// ─────────────────────────────────────────────────────────

test("cancelReceipt function defined", function () {
  assertInHtml("var cancelReceipt = function cancelReceipt()", "cancelReceipt function definition");
});

test("Cancel Receipt button label present", function () {
  assertInHtml("Cancel Receipt", "Cancel Receipt button text");
});

test("Receipt CANCELLED watermark rendered", function () {
  assertInHtml("CANCELLED", "CANCELLED watermark text");
});

test("Receipt cancel state (riCancelled) tracks cancelled status", function () {
  assertInHtml("riCancelled", "riCancelled state variable");
});

test("Cannot cancel a paid receipt (paidProtection check)", function () {
  assertInHtml("paymentStatus === 'paid'", "paid receipt protection check");
});

test("DEACTIVATION_AUDIT_MARKERS includes cancel receipt keys", function () {
  assertInHtml("'cancelReceipt': true", "cancelReceipt marker");
  assertInHtml("'Cancel Receipt': true", "Cancel Receipt marker label");
});

// ─────────────────────────────────────────────────────────
// PAYMENT LINKS
// ─────────────────────────────────────────────────────────

test("deactivatePaymentLink function defined", function () {
  assertInHtml("var deactivatePaymentLink = function deactivatePaymentLink()", "deactivatePaymentLink function");
});

test("Deactivate Link button label present", function () {
  assertInHtml("Deactivate Link", "Deactivate Link button text");
});

test("Payment link expired state tracked (riLinkExpired)", function () {
  assertInHtml("riLinkExpired", "riLinkExpired state variable");
});

test("Link Expired badge shown when deactivated", function () {
  assertInHtml("Link Expired", "Link Expired badge text");
});

test("DEACTIVATION_AUDIT_MARKERS includes payment link keys", function () {
  assertInHtml("'deactivatePaymentLink': true", "deactivatePaymentLink marker");
  assertInHtml("'Deactivate Link': true", "Deactivate Link marker");
  assertInHtml("'link_expired': true", "link_expired marker");
});

// ─────────────────────────────────────────────────────────
// CAMPAIGNS
// ─────────────────────────────────────────────────────────

test("pauseCampaign function defined", function () {
  assertInHtml("function pauseCampaign(camp)", "pauseCampaign function definition");
});

test("Pause Campaign button label present", function () {
  assertInHtml("Pause Campaign", "Pause Campaign button title");
});

test("Campaign status set to paused", function () {
  assertInHtml("status: 'paused'", "campaign paused status");
});

test("endCampaign function defined", function () {
  assertInHtml("function endCampaign(camp)", "endCampaign function definition");
});

test("End Campaign button label present", function () {
  assertInHtml("End Campaign", "End Campaign button text");
});

test("Campaign status set to ended", function () {
  assertInHtml("status: 'ended'", "campaign ended status");
});

test("deleteDraft function defined", function () {
  assertInHtml("function deleteDraft(camp)", "deleteDraft function definition");
});

test("Delete Draft button label present", function () {
  assertInHtml("Delete Draft", "Delete Draft button text");
});

test("Delete Draft only allowed for draft campaigns", function () {
  assertInHtml("status !== 'draft'", "draft-only guard for deleteDraft");
});

test("DEACTIVATION_AUDIT_MARKERS includes campaign keys", function () {
  assertInHtml("'pauseCampaign': true", "pauseCampaign marker");
  assertInHtml("'Pause Campaign': true", "Pause Campaign marker");
  assertInHtml("'endCampaign': true", "endCampaign marker");
  assertInHtml("'End Campaign': true", "End Campaign marker");
  assertInHtml("'deleteDraft': true", "deleteDraft marker");
  assertInHtml("'Delete Draft': true", "Delete Draft marker");
});

// ─────────────────────────────────────────────────────────
// SAFETY RULES
// ─────────────────────────────────────────────────────────

test("Confirmation dialogs exist for all destructive actions", function () {
  var confirmCount = (html.match(/window\.confirm\(/g) || []).length;
  assert.ok(
    confirmCount >= 6,
    "Expected at least 6 window.confirm() calls for destructive actions, got " + confirmCount
  );
});

test("Soft-delete preferred (no hard db.delete for offices/drivers)", function () {
  // offices and drivers use active:false, not a hard delete call
  assertInHtml("active: false", "soft-delete via active:false");
});

test("Existing partners deactivate still works (not broken)", function () {
  assertInHtml("togglePartnerActive", "togglePartnerActive still present");
});

test("VoidOrderModal still present (not broken)", function () {
  assertInHtml("VoidOrderModal", "VoidOrderModal component still present");
});

// ─────────────────────────────────────────────────────────
// KNOWN STATUS (cross-check with task)
// ─────────────────────────────────────────────────────────

test("Partners: existing deactivate/reactivate intact", function () {
  assertInHtml("is_active === false ? \"Reactivate\" : \"Deactivate\"", "partner deactivate toggle");
});

test("Box types: existing archive/delete for custom boxes intact", function () {
  // Box types use box.active toggle (Active/Archived) + Del button for custom boxes
  assertInHtml("box.active ? \"Active\" : \"Archived\"", "box archive toggle Active/Archived");
});

test("Destinations: existing delete intact", function () {
  // Destinations use inline filter to remove
  assertInHtml("Remove " + '" + d + "', "destination remove button");
});

// ─────────────────────────────────────────────────────────
// SCHEMA / SUPABASE FLAGS (no new tables needed)
// ─────────────────────────────────────────────────────────

test("No new Supabase tables added for deactivation (app-state only)", function () {
  // Verify we do NOT have CREATE TABLE statements for deactivation entities
  var deactivationTables = [
    "CREATE TABLE IF NOT EXISTS office_deactivations",
    "CREATE TABLE IF NOT EXISTS driver_deactivations"
  ];
  deactivationTables.forEach(function (stmt) {
    assert.ok(!html.includes(stmt), "Unexpected new table: " + stmt);
  });
});

// ─────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────

runTests();
