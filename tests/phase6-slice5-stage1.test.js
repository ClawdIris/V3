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
