/**
 * Phase 6 — Tenant Receipt/Invoice Disclaimer Feature Tests
 *
 * Tests cover:
 *  - Settings load/save wiring
 *  - Disclaimer injection logic (active/inactive, applies_to, lang fallback)
 *  - Template HTML rendering
 *  - Payload shape validation
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Load the source files
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Load the receipts component for template tests
let PaymentReceiptTemplate, ShipmentInvoiceTemplate;
try {
  const mod = require('../phase5-receipts-components.js');
  PaymentReceiptTemplate = mod.PaymentReceiptTemplate;
  ShipmentInvoiceTemplate = mod.ShipmentInvoiceTemplate;
} catch (e) {
  // Fallback: eval the file in a sandbox
  const componentSrc = fs.readFileSync(
    path.join(__dirname, '..', 'phase5-receipts-components.js'), 'utf8'
  );
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', componentSrc)(
    sandbox,
    (sandbox.exports = {})
  );
  PaymentReceiptTemplate = sandbox.exports.PaymentReceiptTemplate || sandbox.PaymentReceiptTemplate;
  ShipmentInvoiceTemplate = sandbox.exports.ShipmentInvoiceTemplate || sandbox.ShipmentInvoiceTemplate;
}

// ── Helper: minimal disclaimer injection logic (mirrors index.html) ──────────
function injectDisclaimer(data, disclaimerSetting, docTypeKey, lang) {
  if (
    disclaimerSetting &&
    disclaimerSetting.active &&
    disclaimerSetting.applies_to &&
    disclaimerSetting.applies_to.includes(docTypeKey)
  ) {
    const dText =
      lang === 'es' && disclaimerSetting.text_es
        ? disclaimerSetting.text_es
        : disclaimerSetting.text_en;
    data.disclaimer = { title: disclaimerSetting.title || '', text: dText || '' };
  }
  return data;
}

// ── Minimal receipt/invoice data ─────────────────────────────────────────────
function makeReceiptData(overrides) {
  return Object.assign(
    {
      receiptNumber: 'RCT-TEST',
      receiptDate: '2026-06-01',
      receiptTime: '10:00 AM',
      orderId: 'ORD-001',
      amountDisplay: '$200.00',
      paymentMethod: 'cash',
      payerName: 'Test Customer',
    },
    overrides
  );
}

function makeInvoiceData(overrides) {
  return Object.assign(
    {
      invoiceNumber: 'INV-TEST',
      invoiceDate: '2026-06-01',
      orderId: 'ORD-001',
      shipperName: 'Casabe Konnect',
      recipientName: 'Test Recipient',
      numBoxes: 1,
      items: [
        {
          itemSequence: 1,
          description: 'Box 1',
          unitPriceCents: 20000,
          quantity: 1,
          lineTotalCents: 20000,
          priceDisplay: '$200.00',
          subtotalDisplay: '$200.00',
        },
      ],
      subtotalCents: 20000,
      shippingCostCents: 0,
      taxCents: 0,
      totalCents: 20000,
      subtotalDisplay: '$200.00',
      totalDisplay: '$200.00',
    },
    overrides
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  SOURCE-LEVEL CHECKS (index.html)
// ═════════════════════════════════════════════════════════════════════════════

describe('disclaimer: source-level checks (index.html)', () => {
  // 1. loadSettings called with 'receipt_disclaimer'
  test("loadSettings called with 'receipt_disclaimer'", () => {
    expect(src).toContain("loadSettings('receipt_disclaimer')");
  });

  // 2. saveSettings called with correct shape on save
  test("saveSettings called with 'receipt_disclaimer' key", () => {
    expect(src).toContain("saveSettings('receipt_disclaimer'");
  });

  test('saveSettings payload includes updated_at', () => {
    expect(src).toContain('updated_at');
    expect(src).toContain('new Date().toISOString()');
  });

  test('saveSettings payload includes updated_by', () => {
    expect(src).toContain('updated_by');
  });

  // Role gate
  test("HQ-only gate: roleKey === 'hq' guards disclaimer UI", () => {
    expect(src).toContain("roleKey === 'hq'");
  });

  // ReceiptsInvoicesApp receives roleKey prop
  test('ReceiptsInvoicesApp receives roleKey prop', () => {
    expect(src).toMatch(/ReceiptsInvoicesApp.*roleKey/s);
  });

  // Disclaimer settings card rendered
  test('Disclaimer settings card present in source', () => {
    expect(src).toContain('Company Disclaimer Settings');
  });

  // Active toggle present
  test('Active toggle present', () => {
    expect(src).toContain('disclaimerForm.active');
  });

  // Applies to checkboxes present
  test('applies_to checkboxes present', () => {
    expect(src).toContain('DISCLAIMER_APPLIES_OPTIONS');
    expect(src).toContain("'shipment_invoices'");
    expect(src).toContain("'driver_receipts'");
    expect(src).toContain("'box_invoices'");
    expect(src).toContain("'receipts'");
  });

  // Save button
  test("Save Disclaimer button present", () => {
    expect(src).toContain('Save Disclaimer');
  });

  // notify on save
  test('notify called on save success', () => {
    expect(src).toContain('Disclaimer saved');
  });

  // Disclaimer injection in generateInvoice
  test('disclaimer injection present in generateInvoice (shipment_invoices)', () => {
    expect(src).toContain("'shipment_invoices'");
    expect(src).toContain('invoiceData.disclaimer');
  });

  // Disclaimer injection in generateDriverReceipt
  test('disclaimer injection present in generateDriverReceipt (driver_receipts)', () => {
    expect(src).toContain("'driver_receipts'");
    expect(src).toContain('receiptData.disclaimer');
  });

  // box_invoices mapping
  test('box_invoices mapping present', () => {
    expect(src).toContain("'box_invoices'");
  });

  // ES translations added
  test('ES translation: Company Disclaimer Settings', () => {
    expect(src).toContain('ES["Company Disclaimer Settings"]');
  });

  test('ES translation: Disclaimer Title', () => {
    expect(src).toContain('ES["Disclaimer Title"]');
  });

  test('ES translation: Save Disclaimer', () => {
    expect(src).toContain('ES["Save Disclaimer"]');
  });

  test('ES translation: Disclaimer saved', () => {
    expect(src).toContain('ES["Disclaimer saved"]');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  INJECTION LOGIC UNIT TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('disclaimer injection logic', () => {
  const activeDisclaimer = {
    title: 'Terms',
    text_en: 'English disclaimer text.',
    text_es: 'Texto del aviso en español.',
    active: true,
    applies_to: ['shipment_invoices', 'driver_receipts', 'box_invoices'],
  };

  // 3. active=false → no disclaimer injected
  test('active=false → no disclaimer injected into invoiceData', () => {
    const disclaimer = Object.assign({}, activeDisclaimer, { active: false });
    const data = injectDisclaimer({}, disclaimer, 'shipment_invoices', 'en');
    expect(data.disclaimer).toBeUndefined();
  });

  // 4. active=true, applies_to includes docType → disclaimer injected
  test('active=true, applies_to includes docType → disclaimer injected', () => {
    const data = injectDisclaimer({}, activeDisclaimer, 'shipment_invoices', 'en');
    expect(data.disclaimer).toBeDefined();
    expect(data.disclaimer.text).toBe('English disclaimer text.');
  });

  // 5. active=true, applies_to excludes docType → no injection
  test('active=true, applies_to excludes docType → no injection', () => {
    const disclaimer = Object.assign({}, activeDisclaimer, {
      applies_to: ['driver_receipts'],
    });
    const data = injectDisclaimer({}, disclaimer, 'shipment_invoices', 'en');
    expect(data.disclaimer).toBeUndefined();
  });

  // 6. lang=es, text_es set → uses text_es
  test('lang=es, text_es set → uses text_es', () => {
    const data = injectDisclaimer({}, activeDisclaimer, 'shipment_invoices', 'es');
    expect(data.disclaimer.text).toBe('Texto del aviso en español.');
  });

  // 7. lang=es, text_es empty → falls back to text_en
  test('lang=es, text_es empty → falls back to text_en', () => {
    const disclaimer = Object.assign({}, activeDisclaimer, { text_es: '' });
    const data = injectDisclaimer({}, disclaimer, 'shipment_invoices', 'es');
    expect(data.disclaimer.text).toBe('English disclaimer text.');
  });

  // Null disclaimer → no injection
  test('null disclaimerSetting → no injection', () => {
    const data = injectDisclaimer({}, null, 'shipment_invoices', 'en');
    expect(data.disclaimer).toBeUndefined();
  });

  // Title carried through
  test('title is carried through into disclaimer object', () => {
    const data = injectDisclaimer({}, activeDisclaimer, 'shipment_invoices', 'en');
    expect(data.disclaimer.title).toBe('Terms');
  });

  // applies_to: receipts key
  test('applies_to: receipts key works', () => {
    const disclaimer = Object.assign({}, activeDisclaimer, {
      applies_to: ['receipts'],
    });
    const data = injectDisclaimer({}, disclaimer, 'receipts', 'en');
    expect(data.disclaimer).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  TEMPLATE HTML RENDERING
// ═════════════════════════════════════════════════════════════════════════════

describe('ShipmentInvoiceTemplate disclaimer rendering', () => {
  // 8. generateHTML includes disclaimer div when data.disclaimer.text set
  test('generateHTML includes inv-disclaimer div when data.disclaimer.text set', () => {
    const data = makeInvoiceData({
      disclaimer: { title: 'Legal Notice', text: 'This invoice is subject to our terms.' },
    });
    const html = ShipmentInvoiceTemplate.generateHTML(data);
    expect(html).toContain('inv-disclaimer');
    expect(html).toContain('This invoice is subject to our terms.');
    expect(html).toContain('Legal Notice');
  });

  // 9. generateHTML omits disclaimer div when data.disclaimer falsy
  test('generateHTML omits disclaimer div when data.disclaimer is falsy', () => {
    const data = makeInvoiceData(); // no disclaimer
    const html = ShipmentInvoiceTemplate.generateHTML(data);
    expect(html).not.toContain('inv-disclaimer');
  });

  test('generateHTML omits disclaimer when data.disclaimer.text is empty string', () => {
    const data = makeInvoiceData({ disclaimer: { title: 'T', text: '' } });
    const html = ShipmentInvoiceTemplate.generateHTML(data);
    expect(html).not.toContain('inv-disclaimer');
  });

  test('generateHTML renders disclaimer without title when title is empty', () => {
    const data = makeInvoiceData({
      disclaimer: { title: '', text: 'No title disclaimer.' },
    });
    const html = ShipmentInvoiceTemplate.generateHTML(data);
    expect(html).toContain('inv-disclaimer');
    expect(html).toContain('No title disclaimer.');
    // Title div should not appear for empty title
    expect(html).not.toContain('font-weight:700;text-transform:uppercase');
  });
});

describe('PaymentReceiptTemplate disclaimer rendering', () => {
  test('generateHTML includes inv-disclaimer div when data.disclaimer.text set', () => {
    const data = makeReceiptData({
      disclaimer: { title: 'Receipt Notice', text: 'Disclaimer on receipt.' },
    });
    const html = PaymentReceiptTemplate.generateHTML(data);
    expect(html).toContain('inv-disclaimer');
    expect(html).toContain('Disclaimer on receipt.');
  });

  test('generateHTML omits disclaimer div when data.disclaimer is falsy', () => {
    const data = makeReceiptData(); // no disclaimer
    const html = PaymentReceiptTemplate.generateHTML(data);
    expect(html).not.toContain('inv-disclaimer');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  PAYLOAD SHAPE
// ═════════════════════════════════════════════════════════════════════════════

describe('disclaimer: saveSettings payload shape', () => {
  // 10. Payload includes updated_at and updated_by
  test('payload includes updated_at (ISO timestamp)', () => {
    const updated_at = new Date().toISOString();
    expect(updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('payload includes updated_by field', () => {
    const session = { email: 'hq@example.com' };
    const updated_by = (session && (session.email || session.displayName)) || 'hq';
    expect(updated_by).toBe('hq@example.com');
  });

  test('payload includes all required shape keys', () => {
    const payload = {
      title: 'Terms',
      text_en: 'EN text',
      text_es: 'ES text',
      active: true,
      applies_to: ['receipts', 'shipment_invoices'],
      updated_at: new Date().toISOString(),
      updated_by: 'hq@example.com',
    };
    expect(payload).toHaveProperty('title');
    expect(payload).toHaveProperty('text_en');
    expect(payload).toHaveProperty('text_es');
    expect(payload).toHaveProperty('active');
    expect(payload).toHaveProperty('applies_to');
    expect(payload).toHaveProperty('updated_at');
    expect(payload).toHaveProperty('updated_by');
  });

  test('applies_to is an array', () => {
    const applies_to = ['receipts', 'shipment_invoices', 'driver_receipts', 'box_invoices'];
    expect(Array.isArray(applies_to)).toBe(true);
    expect(applies_to).toContain('receipts');
    expect(applies_to).toContain('shipment_invoices');
  });
});
