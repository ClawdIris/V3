const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const schemaSrc = fs.readFileSync('phase6-slice5-stage3-schema.sql', 'utf8');

describe('Phase 6 Slice 5 Stage 3 — Message Queue', () => {
  test('MessageQueuePage component exists', () => expect(src).toContain('var MessageQueuePage'));
  test('msg_queue in HQ validPages', () => expect(src).toMatch(/"msg_queue"/));
  test('msg_queue in Office validPages', () => {
    const m = src.match(/validPages\s*=.*?\[([^\]]+)\].*?\[([^\]]+)\].*?\[([^\]]+)\]/);
    expect(m ? m[2] : '').toContain('msg_queue');
  });
  test('msg_queue NOT in Driver validPages', () => {
    const m = src.match(/validPages\s*=.*?\[([^\]]+)\].*?\[([^\]]+)\].*?\[([^\]]+)\]/);
    expect(m ? m[3] : '').not.toContain('msg_queue');
  });
  test('Driver blocked at render level in MessageQueuePage', () => expect(src).toContain('roleKey === "driver"'));
  test('All 6 status values present', () => {
    ['draft','queued','blocked','sent','failed','cancelled'].forEach(s => expect(src).toContain(s));
  });
  test('mqAdd function exists (queue write)', () => expect(src).toContain('function mqAdd'));
  test('mqCancel function exists (archive action)', () => expect(src).toContain('function mqCancel'));
  test('Queue message button exists in Templates', () => expect(src).toContain('queue-message-btn'));
  test('"Queued only — no message sent" label present', () => expect(src).toMatch(/[Qq]ueued only/));
  test('Cancel/archive action exists (cancel-btn)', () => expect(src).toContain('cancel-btn-'));
  test('Confirm cancel modal exists', () => expect(src).toContain('cancel-confirm-modal'));
  test('renderPage wired for msg_queue', () => expect(src).toContain('page === "msg_queue"'));

  // Security
  test('No Twilio API call in bundle', () => { expect(src).not.toContain('api.twilio.com'); expect(src).not.toContain('twilio.com/2010'); });
  test('No Twilio credential pattern in bundle', () => expect(src).not.toMatch(/AC[a-f0-9]{32}/));
  test('No real send call from queue', () => expect(src).not.toMatch(/fetch.*twilio|axios.*twilio/i));

  // Schema
  test('Schema file exists', () => expect(fs.existsSync('phase6-slice5-stage3-schema.sql')).toBe(true));
  test('Schema has RLS enabled', () => expect(schemaSrc).toContain('ENABLE ROW LEVEL SECURITY'));
  test('Schema has deny-delete policy', () => expect(schemaSrc).toContain('USING (FALSE)'));
  test('Schema has HQ select policy', () => expect(schemaSrc).toContain('hq_messages_select'));
  test('Schema has Office select policy scoped to orders', () => expect(schemaSrc).toContain('office_messages_select'));
  test('Schema: no inverted permissive driver/anon policy in active SQL', () => {
    const activeSQL = schemaSrc.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    expect(activeSQL).not.toContain('driver_messages_deny');
    expect(activeSQL).not.toContain('anon_messages_deny');
    expect(activeSQL).not.toMatch(/NOT IN.*driver|NOT IN.*anon/i);
  });
  test('Schema: driver/anon blocked by implicit deny (no permissive match)', () => {
    // HQ + Office policies require get_user_role() = hq/office — drivers get no matching policy
    expect(schemaSrc).toContain("public.get_user_role() = 'hq'");
    expect(schemaSrc).toContain("public.get_user_role() = 'office'");
  });
  test('Schema has no USING (TRUE)', () => expect(schemaSrc).not.toMatch(/USING\s*\(\s*TRUE\s*\)/i));
  test('Schema has no user_profiles reference', () => expect(schemaSrc).not.toContain('user_profiles'));
  test('SECURITY DEFINER function sets search_path', () => expect(schemaSrc).toContain("SET search_path = ''"));
  test('Schema marked APPLIED after review', () => expect(schemaSrc).toContain('STATUS: APPLIED'));
  test('Schema uses text tenant ids', () => expect(schemaSrc).toMatch(/tenant_id\s+TEXT\s+NOT NULL/));
  test('Schema uses composite order FK', () => {
    expect(schemaSrc).toContain('FOREIGN KEY (order_id, tenant_id) REFERENCES orders(id, tenant_id)');
  });
  test('HQ update has WITH CHECK', () => {
    const activeSQL = schemaSrc.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    expect(activeSQL).toMatch(/CREATE POLICY "hq_messages_update"[\s\S]*FOR UPDATE[\s\S]*WITH CHECK/);
  });
});

describe('Phase 6 Slice 5 Stage 4 — Real Send (Edge Function)', () => {
  const efSrc = fs.readFileSync('supabase/functions/sms-send/index.ts', 'utf8');
  test('Edge Function file exists', () => expect(fs.existsSync('supabase/functions/sms-send/index.ts')).toBe(true));
  test('EF reads Twilio secrets from Deno.env only', () => expect(efSrc).toContain('Deno.env.get("TWILIO_ACCOUNT_SID")'));
  test('EF calls api.twilio.com server-side', () => expect(efSrc).toContain('api.twilio.com'));
  test('EF uses caller JWT for RLS', () => expect(efSrc).toContain('Authorization: authHeader'));
  test('EF guards queued-only sends', () => expect(efSrc).toContain('msg.status !== "queued"'));
  test('EF marks failed on Twilio error', () => expect(efSrc).toContain('status: "failed"'));
  test('EF marks sent + stores provider_message_id', () => expect(efSrc).toContain('provider_message_id: twilioData.sid'));
  test('EF no hardcoded Twilio credential', () => { expect(efSrc).not.toMatch(/AC[a-f0-9]{32}/); });
  test('UI: no direct api.twilio.com call in browser bundle', () => expect(src).not.toContain('api.twilio.com'));
  test('UI: no Twilio credential in browser bundle', () => expect(src).not.toMatch(/AC[a-f0-9]{32}/));
  test('UI: send invokes Edge Function (not Twilio directly)', () => expect(src).toContain('functions.invoke("sms-send"'));
  test('UI: Send Now button is HQ-only', () => expect(src).toContain('roleKey === "hq"'));
  test('UI: in-flight disabled state (no double-send)', () => expect(src).toContain('_sendingId === r.id'));
});
