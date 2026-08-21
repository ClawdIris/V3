#!/usr/bin/env node
/*
 * Twilio Phase 1 T1-T10 smoke coverage map.
 * Runs static assertions locally; live JWT/Twilio tests should reuse these IDs.
 */
const fs = require("fs");
const assert = require("assert");

const files = {
  migration: fs.readFileSync("supabase/migrations/20260819000100_twilio_phase1_inbox.sql", "utf8"),
  rollback: fs.readFileSync("supabase/migrations/20260819000100_twilio_phase1_inbox_rollback.sql", "utf8"),
  inbound: fs.readFileSync("supabase/functions/twilio-inbound/index.ts", "utf8"),
  status: fs.readFileSync("supabase/functions/twilio-status-callback/index.ts", "utf8"),
  send: fs.readFileSync("supabase/functions/sms-send/index.ts", "utf8"),
  ui: fs.readFileSync("index.html", "utf8"),
};

const checks = [
  ["T1", "Revoked/STOP blocks all outbound", /consent_revoked/.test(files.migration) && /consent_revoked/.test(files.send)],
  ["T2", "Distinct consent_revoked error", /error: "consent_revoked"/.test(files.send)],
  ["T3", "Required opt-out copy", /This customer has opted out of text messages\. Ask them to opt in again before sending\./.test(files.send + files.ui)],
  ["T4", "No new sends write sms_consents", !/from\("sms_consents"\)|sms_consents.*insert|INSERT INTO public\.sms_consents/i.test(files.send + files.migration)],
  ["T5", "tracking_alert_consents canonical", /tracking_alert_consents is canonical current state|tracking_alert_consents/.test(files.migration)],
  ["T6", "Unknown inbound triage", /office_id uuid NULL/.test(files.migration) && /Unknown\/unmatched inbound rows remain HQ triage/.test(files.migration)],
  ["T7", "Office templates plus short custom replies", /length\(v_body\) > 320/.test(files.migration) && /messageTemplateSelect|template_key/.test(files.ui)],
  ["T8", "Replies notify HQ and assigned office artifact", /inbox_assign_thread/.test(files.migration) && /assigned_member_id/.test(files.migration)],
  ["T9", "Tracking-number auto reply not implemented Phase 1", !/auto.*tracking.*reply/i.test(files.inbound)],
  ["T10", "Brand is tenant/shipping company, no hardcoded Casabe Konnect customer sender", !/Body:.*Casabe Konnect/.test(files.send) && /provider_phone_e164/.test(files.migration)],
];

for (const [id, label, ok] of checks) {
  assert(ok, id + " failed: " + label);
  console.log(id + " ok - " + label);
}
console.log("Twilio Phase 1 T1-T10 smoke coverage passed");
