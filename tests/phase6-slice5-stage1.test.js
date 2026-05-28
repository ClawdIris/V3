/**
 * Phase 6 — Slice 5 Stage 1: Message Template Library
 * Tests for nav, validPages, template data, role-gating, and safety checks.
 */

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'index.html');
let html;

beforeAll(() => {
  html = fs.readFileSync(htmlPath, 'utf8');
});

// ── validPages ────────────────────────────────────────────────
describe('validPages', () => {
  test('msg_templates is in HQ validPages', () => {
    const match = html.match(/var validPages = r === "hq" \? \[([^\]]+)\]/);
    expect(match).not.toBeNull();
    expect(match[1]).toContain('"msg_templates"');
  });

  test('msg_templates is in Office validPages', () => {
    const match = html.match(/r === "office" \? \[([^\]]+)\]/);
    expect(match).not.toBeNull();
    expect(match[1]).toContain('"msg_templates"');
  });

  test('msg_templates is NOT in Driver validPages', () => {
    const match = html.match(/: \["driver_route", "driver_proof"\]/);
    expect(match).not.toBeNull();
    expect(match[0]).not.toContain('msg_templates');
  });
});

// ── Nav entries ───────────────────────────────────────────────
describe('nav entries', () => {
  test('msg_templates nav key exists in HQ nav section', () => {
    const hqNavIdx = html.indexOf('k: "margin_summary"');
    expect(hqNavIdx).toBeGreaterThan(0);
    const hqNavSection = html.substring(hqNavIdx, hqNavIdx + 200);
    expect(hqNavSection).toContain('"msg_templates"');
  });

  test('msg_templates label is Message Templates (HQ)', () => {
    expect(html).toContain('msg_templates: "Message Templates"');
  });
});

// ── Template IDs ──────────────────────────────────────────────
describe('template IDs', () => {
  const expectedIds = [
    'ORDER_CONFIRMATION',
    'PAYMENT_REQUEST',
    'DELIVERY_IN_TRANSIT',
    'DELIVERY_COMPLETED',
    'DRIVER_ASSIGNMENT',
    'TAPE_DIRECT_ALERT',
  ];

  expectedIds.forEach(id => {
    test(`template ID ${id} is present in index.html`, () => {
      expect(html).toContain(`"${id}"`);
    });
  });
});

// ── TAPE_DIRECT_ALERT hqOnly ──────────────────────────────────
describe('TAPE_DIRECT_ALERT', () => {
  test('TAPE_DIRECT_ALERT is marked hqOnly: true', () => {
    const idx = html.indexOf('"TAPE_DIRECT_ALERT"');
    expect(idx).toBeGreaterThan(0);
    const block = html.substring(idx, idx + 750);
    expect(block).toContain('hqOnly: true');
  });
});

// ── No Twilio in MessageTemplatesPage ────────────────────────
describe('security checks', () => {
  test('no Twilio API calls inside MessageTemplatesPage component', () => {
    const startIdx = html.indexOf('Phase 6 \u2014 Slice 5 Stage 1: MessageTemplatesPage');
    const endIdx   = html.indexOf('END Phase 6 Slice 5 Stage 1: MessageTemplatesPage');
    expect(startIdx).toBeGreaterThan(0);
    expect(endIdx).toBeGreaterThan(startIdx);
    const component = html.substring(startIdx, endIdx);
    // Must not contain Twilio require/import or API endpoint calls
    expect(component).not.toMatch(/require\s*\(\s*['"]twilio/i);
    expect(component).not.toMatch(/import.*from.*twilio/i);
    expect(component).not.toMatch(/api\.twilio\.com/i);
    expect(component).not.toMatch(/TWILIO_ACCOUNT_SID/i);
  });

  test('no messaging API fetch calls in MessageTemplatesPage', () => {
    const startIdx = html.indexOf('Phase 6 \u2014 Slice 5 Stage 1: MessageTemplatesPage');
    const endIdx   = html.indexOf('END Phase 6 Slice 5 Stage 1: MessageTemplatesPage');
    expect(startIdx).toBeGreaterThan(0);
    expect(endIdx).toBeGreaterThan(startIdx);
    const component = html.substring(startIdx, endIdx);
    expect(component).not.toMatch(/fetch\s*\(\s*['"]https?:\/\/api\.(twilio|messagebird|vonage)/i);
  });
});

// ── renderPage wiring ─────────────────────────────────────────
describe('renderPage wiring', () => {
  test('msg_templates is handled in renderPage', () => {
    expect(html).toContain('page === "msg_templates"');
    expect(html).toContain('React.createElement(MessageTemplatesPage');
  });

  test('MessageTemplatesPage component is defined', () => {
    expect(html).toContain('var MessageTemplatesPage = function MessageTemplatesPage');
  });
});

// ── Disabled send button ──────────────────────────────────────
describe('Stage 1 send gate', () => {
  test('send button is disabled and labelled Stage 2', () => {
    expect(html).toContain('send-disabled-btn');
    expect(html).toContain('disabled: true');
    expect(html).toMatch(/Sending disabled.*Stage 2/);
  });
});
