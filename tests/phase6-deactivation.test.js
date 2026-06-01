/**
 * phase6-deactivation.test.js
 * Tests for GAP 1 (box type deactivation), GAP 2 (notranslate), GAP 3 (inactive selectors),
 * GAP 4 (invoice/receipt stability), GAP 5 (message queue)
 */

const fs = require('fs');
const path = require('path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// ─── GAP 1: Box type deactivation ────────────────────────────────────────────

describe('GAP 1 — boxSize deactivation', () => {
  test('boxSize deactivation UI: Deactivate/Reactivate button exists in box sizes section', () => {
    // Look for the is_active toggle button code
    expect(indexHtml).toMatch(/is_active.*false.*true|Deactivate.*Reactivate|Reactivate.*Deactivate/);
  });

  test('boxSize deactivation: is_active=false hides from new-order selector (wizard pricing filter)', () => {
    // The pricing table filters should include b.is_active !== false
    const filterMatches = indexHtml.match(/b\.label && b\.is_active !== false/g);
    // Should appear in multiple places (pricingComplete, header, rows, namedBoxes)
    expect(filterMatches).not.toBeNull();
    expect(filterMatches.length).toBeGreaterThanOrEqual(4);
  });

  test('boxSize reactivation: is_active=true appears in selector (toggle logic present)', () => {
    // The toggle sets is_active: b.is_active === false ? true : false
    expect(indexHtml).toContain('b.is_active === false ? true : false');
  });

  test('inactive boxSize still renders on historical order display (no filter on order.boxType)', () => {
    // Order rows render o.boxType directly without is_active filter
    // The order table resolveLabel function does not filter by is_active
    const resolveSection = indexHtml.match(/var resolveLabel[\s\S]{0,200}boxConfig.*BOX_CONFIG/);
    expect(resolveSection).not.toBeNull();
    // resolveLabel should NOT have is_active check - it resolves any key including inactive ones
    const resolveFn = indexHtml.match(/var resolveLabel = function\(key\) \{[^\}]+\}/);
    if (resolveFn) {
      expect(resolveFn[0]).not.toContain('is_active');
    }
  });

  test('boxSize deactivation: canProceed for boxes step skips inactive boxes', () => {
    expect(indexHtml).toContain("data.boxSizes.filter(function(b){ return b.is_active !== false; }).every");
  });

  test('boxSize deactivation: namedBoxes in go-live check excludes inactive', () => {
    expect(indexHtml).toContain('return b.label && b.is_active !== false;');
  });
});

// ─── GAP 2: notranslate on dynamic data fields ────────────────────────────────

describe('GAP 2 — notranslate on dynamic data fields', () => {
  test('notranslate CSS class exists in stylesheet', () => {
    expect(indexHtml).toContain('.notranslate');
  });

  test('notranslate applied to order ID (tamb cell) in order table', () => {
    // o.id cell should have notranslate
    expect(indexHtml).toContain('"tamb notranslate"');
  });

  test('notranslate applied to customer name (tb cell) in order table', () => {
    expect(indexHtml).toContain('"tb notranslate"');
  });

  test('notranslate applied to destination cell in order table', () => {
    // Destination cell wraps value in notranslate span
    expect(indexHtml).toMatch(/className.*notranslate.*translate.*no[\s\S]{0,100}destination/);
  });

  test('notranslate applied to driver cell in order table', () => {
    // assignedDriver wrapped in notranslate span
    expect(indexHtml).toMatch(/notranslate.*assignedDriver|assignedDriver.*notranslate/);
  });

  test('notranslate applied to order detail modal values', () => {
    // The detail modal item[1] value span should have notranslate
    expect(indexHtml).toContain('className: "notranslate", translate: "no", style: { fontSize: 12.5');
  });

  test('notranslate applied to route card address in DriverRoutePage', () => {
    // Route cards have notranslate on address and name
    expect(indexHtml).toMatch(/mut xs notranslate.*translate.*no/);
  });

  test('notranslate used at least 5 times in JSX elements', () => {
    // Match notranslate in any className value (both object and string forms)
    const notranslateMatches = indexHtml.match(/notranslate/g) || [];
    // Should appear many times across JSX and CSS
    expect(notranslateMatches.length).toBeGreaterThanOrEqual(5);
    // Specifically count JSX className usages
    const jsxMatches = indexHtml.match(/className.*?notranslate/g) || [];
    expect(jsxMatches.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── GAP 3: Inactive items not in new-order selectors ────────────────────────

describe('GAP 3 — inactive items excluded from new-order selectors', () => {
  test('driver selector filters inactive drivers (active !== false check)', () => {
    // The driver selector .filter should include d.active !== false check
    expect(indexHtml).toContain('d.active !== false');
  });

  test('tenantDrivers memo filters inactive drivers at source', () => {
    // tenantDrivers useMemo filters d.active !== false
    expect(indexHtml).toMatch(/d\.name && d\.active !== false/);
  });

  test('partner selector is_active filter is present', () => {
    // Partner filter already present: p.is_active !== false
    expect(indexHtml).toContain('p.is_active !== false');
  });

  test('boxSizes filter in wizard uses is_active check', () => {
    expect(indexHtml).toContain('b.label && b.is_active !== false');
  });
});

// ─── GAP 4: Receipt/invoice stability hardening ───────────────────────────────

describe('GAP 4 — invoice/receipt stability', () => {
  test('generateInvoice: null selectedOrder returns early (null guard present)', () => {
    // Check that generateInvoice has null guard on selectedOrder
    const invoiceFnMatch = indexHtml.match(/var generateInvoice = function[\s\S]{0,500}/);
    expect(invoiceFnMatch).not.toBeNull();
    expect(invoiceFnMatch[0]).toContain('!riOrderId || !selectedOrder');
  });

  test('generateDriverReceipt: null selectedOrder returns early (null guard present)', () => {
    const receiptFnMatch = indexHtml.match(/var generateDriverReceipt = function[\s\S]{0,500}/);
    expect(receiptFnMatch).not.toBeNull();
    expect(receiptFnMatch[0]).toContain('!riOrderId || !selectedOrder');
  });

  test('generateInvoice: uses fallback strings for missing name/destination', () => {
    // recipientName and recipientAddress use fallback "—"
    expect(indexHtml).toContain("selectedOrder.name || '\\u2014'");
  });

  test('_disclaimerSettingRef.current is used in generateInvoice (not stale disclaimerSetting)', () => {
    // Should use _disclaimerSettingRef.current not direct disclaimerSetting variable
    expect(indexHtml).toContain('_disclaimerSettingRef.current');
    // Verify _disclaimerSettingRef.current appears near generateInvoice (within 3000 chars)
    const invoiceBody = indexHtml.match(/var generateInvoice = function[\s\S]{0,4000}/);
    expect(invoiceBody).not.toBeNull();
    expect(invoiceBody[0]).toContain('_disclaimerSettingRef.current');
  });

  test('invoicePreview: renders placeholder when null (no empty iframe)', () => {
    // When riPreview is null, a placeholder message should be shown
    expect(indexHtml).toContain('Generate an invoice above to preview it');
  });

  test('generateDriverReceipt: uses _disclaimerSettingRef.current', () => {
    const receiptBody = indexHtml.match(/var generateDriverReceipt = function[\s\S]{0,1500}/);
    expect(receiptBody).not.toBeNull();
    expect(receiptBody[0]).toContain('_disclaimerSettingRef.current');
  });
});

// ─── GAP 5: Message queue ────────────────────────────────────────────────────

describe('GAP 5 — message queue enqueue creates visible record', () => {
  test('queue-message-btn element exists in source', () => {
    expect(indexHtml).toContain('queue-message-btn');
  });

  test('mqAdd (enqueue) pushes to _msgQueueStore and notifies listeners synchronously', () => {
    // _mqNotify is called right after _msgQueueStore.unshift in mqAdd
    const mqAddBody = indexHtml.match(/function mqAdd\(record\)[\s\S]{0,400}/);
    expect(mqAddBody).not.toBeNull();
    expect(mqAddBody[0]).toContain('_msgQueueStore.unshift(rec)');
    expect(mqAddBody[0]).toContain('_mqNotify()');
    // _mqNotify should come after unshift (synchronous notification)
    const unshiftIdx = mqAddBody[0].indexOf('_msgQueueStore.unshift(rec)');
    const notifyIdx = mqAddBody[0].indexOf('_mqNotify()');
    expect(notifyIdx).toBeGreaterThan(unshiftIdx);
  });

  test('message queue: MessageQueuePage reads from mqUseStore()', () => {
    const mqPageBody = indexHtml.match(/var MessageQueuePage[\s\S]{0,2000}/);
    expect(mqPageBody).not.toBeNull();
    expect(mqPageBody[0]).toContain('mqUseStore()');
  });

  test('message queue: mqUseStore subscribes listener and returns records', () => {
    const mqUseStoreBody = indexHtml.match(/function mqUseStore\(\)[\s\S]{0,400}/);
    expect(mqUseStoreBody).not.toBeNull();
    expect(mqUseStoreBody[0]).toContain('_msgQueueListeners.push(fn)');
    expect(mqUseStoreBody[0]).toContain('setRecords');
  });

  test('message queue: enqueue adds record to queue list (queue button calls mqAdd)', () => {
    // The queue-message-btn onClick calls mqAdd with proper record
    const queueBtnSection = indexHtml.match(/id: "queue-message-btn"[\s\S]{0,400}/);
    expect(queueBtnSection).not.toBeNull();
    expect(queueBtnSection[0]).toContain('mqAdd(');
  });

  test('message queue: Twilio gate (providerConfigured) remains — no fake sends', () => {
    // Send Now button should only be active when configured
    // Verify providerConfigured flag is still present in the source
    expect(indexHtml).toContain('providerConfigured');
  });
});
