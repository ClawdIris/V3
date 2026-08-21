#!/usr/bin/env node
/*
 * Twilio Phase 1 hostile test harness.
 * Static/file-only harness: verifies required protections are present before
 * any deployment, and can be extended to hit a local Supabase stack.
 */
const fs = require("fs");
const assert = require("assert");

function read(file) {
  return fs.readFileSync(file, "utf8");
}
function has(file, pattern, label) {
  const src = read(file);
  assert(pattern.test(src), label + " missing in " + file);
}

const migration = read("supabase/migrations/20260819000100_twilio_phase1_inbox.sql");

[
  ["zero-row assertion", /twilio_phase1_zero_row_assertion_failed/],
  ["anon revoke", /REVOKE ALL ON public\.messaging_numbers, public\.message_threads, public\.messages FROM anon/],
  ["driver no inbox policy", /RETURN false;\s*END;\s*\$\$/],
  ["canonical eligibility", /CREATE OR REPLACE FUNCTION public\.resolve_sms_eligibility/],
  ["consent revoked reason", /consent_revoked/],
  ["idempotent provider SID", /ux_messages_provider_message_id/],
  ["unknown inbound triage", /Unknown\/unmatched inbound rows remain HQ triage|twilio_unknown_to/],
  ["office server scope", /v_member\.role = 'office'|p_thread\.office_id = v\.office_id/],
  ["service-only webhook RPC", /REVOKE EXECUTE ON FUNCTION public\.twilio_ingest_inbound/],
].forEach(([label, pattern]) => assert(pattern.test(migration), label));

has("supabase/functions/twilio-inbound/index.ts", /verifyTwilioSignature/, "inbound signature verification");
has("supabase/functions/twilio-inbound/index.ts", /TWILIO_INBOUND_WEBHOOK_URL/, "inbound canonical URL");
has("supabase/functions/twilio-inbound/index.ts", /twilio_ingest_inbound/, "inbound durable RPC");
has("supabase/functions/twilio-status-callback/index.ts", /TWILIO_STATUS_CALLBACK_URL/, "status canonical URL");
has("supabase/functions/twilio-status-callback/index.ts", /twilio_apply_status_callback/, "status callback RPC");
has("supabase/functions/sms-send/index.ts", /inbox_send_message/, "send RPC path");
has("supabase/functions/sms-send/index.ts", /resolve_sms_eligibility/, "send consent check");
has("supabase/functions/sms-send/index.ts", /StatusCallback/, "send status callback");
has("supabase/functions/sms-send/index.ts", /This customer has opted out of text messages\. Ask them to opt in again before sending\./, "required opted-out UI copy");
has("index.html", /msg_inbox/, "inbox UI route");

console.log("Twilio Phase 1 hostile harness passed");
