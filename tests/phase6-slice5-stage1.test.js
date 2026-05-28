const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');

describe('Phase 6 Slice 5 Stage 1 — Message Templates', () => {
  test('msg_templates in HQ validPages', () => expect(src).toMatch(/"msg_templates"/));
  test('msg_templates NOT in Driver validPages', () => {
    const m = src.match(/validPages\s*=.*?\[([^\]]+)\].*?\[([^\]]+)\].*?\[([^\]]+)\]/);
    const driverPages = m ? m[3] : '';
    expect(driverPages).not.toContain('msg_templates');
  });
  test('MessageTemplatesPage component exists', () => expect(src).toContain('var MessageTemplatesPage'));
  test('All 7 templates present', () => {
    ['ORDER_CONFIRMATION','PAYMENT_REQUEST','PICKUP_SCHEDULED','DELIVERY_IN_TRANSIT','DELIVERY_COMPLETED','TAPE_DIRECT_ALERT','DRIVER_ASSIGNMENT']
      .forEach(t => expect(src).toContain(t));
  });
  test('EN and ES variants present', () => { expect(src).toContain('body_en'); expect(src).toContain('body_es'); });
  test('EN/ES language selector exists', () => { expect(src).toContain('lang-en'); expect(src).toContain('lang-es'); });
  test('Preview interpolates variables (fillTemplate function)', () => expect(src).toContain('fillTemplate'));
  test('SMS/WhatsApp channel selector exists', () => { expect(src).toContain('chan-sms'); expect(src).toContain('chan-whatsapp'); });
  test('Send button disabled in Stage 1', () => { expect(src).toContain('send-disabled-btn'); expect(src).toContain('Stage 2'); });
  test('No Twilio API endpoint called', () => { expect(src).not.toContain('twilio.com/2010'); expect(src).not.toContain('AccountSid'); });
  test('No frontend Twilio secret/token', () => { expect(src).not.toMatch(/AC[a-f0-9]{32}/); });
  test('TAPE_DIRECT_ALERT is HQ-only', () => expect(src).toContain('hqOnly: true'));
  test('Driver access denied at render level', () => expect(src).toContain('roleKey === "driver"'));
  test('Preview only label present', () => expect(src).toMatch(/[Pp]review [Oo]nly/));
  test('Provider-not-configured badge present', () => expect(src).toMatch(/Stage 1|not configured|preview/i));
  test('sample vars: customer_name, order_id, tracking_url, amount, driver_name, company_name', () => {
    ['customer_name','order_id','tracking_url','amount','driver_name','company_name']
      .forEach(v => expect(src).toContain(v));
  });
  test('No missing runtime files referenced', () => {
    const scriptRefs = [...src.matchAll(/src="([^"]+\.js)"/g)].map(m => m[1]).filter(s => !s.startsWith('http'));
    scriptRefs.forEach(ref => expect(fs.existsSync(ref)).toBe(true));
  });
});

describe('Phase 6 Slice 5 Stage 2 — Provider Config', () => {
  test('ProviderConfigPage component exists', () => expect(src).toContain('var ProviderConfigPage'));
  test('msg_provider in HQ validPages', () => expect(src).toMatch(/"msg_provider"/));
  test('msg_provider NOT in Office validPages', () => {
    const m = src.match(/validPages\s*=.*?\[([^\]]+)\].*?\[([^\]]+)\].*?\[([^\]]+)\]/);
    expect(m ? m[2] : '').not.toContain('msg_provider');
  });
  test('msg_provider NOT in Driver validPages', () => {
    const m = src.match(/validPages\s*=.*?\[([^\]]+)\].*?\[([^\]]+)\].*?\[([^\]]+)\]/);
    expect(m ? m[3] : '').not.toContain('msg_provider');
  });
  test('HQ-only gate enforced at render level', () => expect(src).toContain('roleKey !== "hq"'));
  test('Status sourced from Edge Function only (no client secret)', () => expect(src).toContain('functions.invoke("sms-status")'));
  test('No Twilio AccountSID pattern in bundle', () => expect(src).not.toMatch(/AC[a-f0-9]{32}/));
  test('No Twilio Auth Token pattern in bundle', () => expect(src).not.toMatch(/SK[a-f0-9]{32}/));
  test('No direct twilio.com API call', () => { expect(src).not.toContain('api.twilio.com'); expect(src).not.toContain('twilio.com/2010'); });
  test('Test/send button disabled until Stage 4', () => { expect(src).toContain('run-test-btn'); expect(src).toContain('Stage 4'); });
  test('Security notice rendered', () => expect(src).toContain('provider-security-notice'));
  test('Variables shown as masked (server-side only)', () => expect(src).toContain('server-side only'));
  test('renderPage wired for msg_provider', () => expect(src).toContain('page === "msg_provider"'));
});
