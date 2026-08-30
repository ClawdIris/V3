// ============================================================================
// Supabase Edge Function: sms-send — v6 COMPANION, REVISION v2 (X-2)
//
// STATUS: NOT part of the T1-T10 acceptance criteria. Included because the
// Phase 1 messages restructure breaks live sms-send v5, which reads
// recipient_phone / rendered_body / provider_message_id and would fail on
// every invocation after the migration applies. If struck, an equivalent must
// ship in the same production window as the migration.
//
// Deploy config: verify_jwt = true (unchanged from v5).
//
// CHANGELOG v1 -> v2 (reviewer-mandated fix, pre-review finding 2026-08-19):
//   v1 DEFECT: accepted any Authorization header, then used the SERVICE ROLE
//   to fetch and transmit any queued message by id. No caller scope proof.
//   Any authenticated principal (including drivers) who obtained or guessed a
//   queued message UUID could trigger its transmission cross-tenant and
//   cross-office, and the 404/409 split leaked message existence and status
//   to unauthorized callers.
//
//   v2 FIX (required pattern):
//   1. A caller-scoped Supabase client is built from the incoming JWT.
//   2. The message row is read THROUGH THAT CLIENT. RLS SELECT policies
//      (hq tenant-wide, office via thread scope, drivers/anon: none) are the
//      scope proof. No row back = no authority, full stop.
//   3. The service role is used ONLY AFTER the scope proof succeeds, and only
//      for the atomic send claim and provider-result status writes that the
//      deny-all model reserves for it.
//   4. UNIFORM DENIAL: missing/invalid auth, malformed or missing message_id,
//      nonexistent id, cross-tenant, cross-office, driver, and anon all get
//      the byte-identical DENIAL_BODY 404 below. No existence or status
//      oracle crosses the scope boundary. Distinct errors
//      (message_not_sendable, send_in_progress, consent_revoked) are returned
//      ONLY to callers who already proved scope, mirroring the T6 RPC
//      ordering: scope first, state second.
//   5. Coverage: smoke S10 proves the exact scope query and the write
//      boundary under every fixture role; harness SEND-SCOPE section (live
//      mode) probes the deployed endpoint with out-of-scope tokens only.
//
//   v2 BUILDER ADDITION beyond the mandated fix — STRIKE-IF-UNWANTED block
//   marked below: an atomic send claim (compare-and-set on a dedicated
//   send_claimed_at column, WHERE status='queued' AND send_claimed_at IS
//   NULL, added to the migration for this purpose). Without it, two
//   concurrent calls for the same queued id both pass scope, both reach
//   Twilio, and the customer receives the SMS twice. Removing the marked
//   block leaves the mandated fix intact (drop the column too if struck).
//   Residuals if kept: a hard process kill between claim and any status
//   write leaves the row queued+claimed (operator nulls send_claimed_at via
//   service role); the final sent-update failing after a successful Twilio
//   send leaves queued+claimed with the SMS delivered (logged loudly).
//
// Retained from v1: column realignment (to_phone_e164 / body / provider_sid,
// From-number from the row with env fallback), T4 consent re-check at send
// time against canonical tracking_alert_consents (total block, distinct
// consent_revoked to scoped callers), StatusCallback wiring for
// sms-delivery-status via TWILIO_STATUS_WEBHOOK_URL.
// ============================================================================
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// One constant, one shape, byte-identical for every unauthorized or
// unresolvable case. Never add fields to this response.
const DENIAL_BODY = { error: "message_not_found" };
function denial(): Response { return json(404, DENIAL_BODY); }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return denial();

    let message_id: unknown;
    try { ({ message_id } = await req.json()); } catch { return denial(); }
    if (typeof message_id !== "string" || !UUID_RE.test(message_id)) return denial();

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

    // ------------------------------------------------------------------
    // STEP 1 — SCOPE PROOF. Read the row AS THE CALLER. RLS decides.
    // hq: tenant match + threaded. office: thread within own offices.
    // drivers, anon, cross-tenant, cross-office, triage rows: zero rows.
    // ------------------------------------------------------------------
    const caller = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: msg, error: scopeErr } = await caller
      .from("messages")
      .select("id, tenant_id, thread_id, direction, status, channel, from_phone_e164, to_phone_e164, body")
      .eq("id", message_id)
      .maybeSingle();
    if (scopeErr || !msg) return denial();

    // Scope proven. Distinct in-scope state errors are allowed from here on.
    if (msg.direction !== "out" || msg.status !== "queued") {
      return json(409, { error: "message_not_sendable", status: msg.status, direction: msg.direction });
    }

    // Service-role client: writes only, and only past this line.
    const admin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // ------------------------------------------------------------------
    // STEP 2 — ATOMIC SEND CLAIM. ==== STRIKE-IF-UNWANTED: BEGIN ====
    // Compare-and-set on send_claimed_at so exactly one invocation proceeds
    // to the provider for a given queued row. The column is service-role
    // writable only, deliberately outside the immutability freeze list;
    // status is untouched here so the transition whitelist is not engaged.
    // ------------------------------------------------------------------
    const { data: claimed, error: claimErr } = await admin
      .from("messages")
      .update({ send_claimed_at: new Date().toISOString() })
      .eq("id", message_id)
      .eq("status", "queued")
      .is("send_claimed_at", null)
      .select("id");
    if (claimErr || !claimed || claimed.length !== 1) {
      return json(409, { error: "send_in_progress" });
    }
    // ==== STRIKE-IF-UNWANTED: END ====

    // ------------------------------------------------------------------
    // STEP 3 — T4 defense-in-depth: total block on revoked numbers at send
    // time, canonical store only. Covers STOP landing between queue and send.
    // ------------------------------------------------------------------
    const { data: revoked } = await admin
      .from("tracking_alert_consents")
      .select("id").eq("phone_e164", msg.to_phone_e164).eq("status", "revoked").limit(1);
    const { data: active } = await admin
      .from("tracking_alert_consents")
      .select("id").eq("phone_e164", msg.to_phone_e164).eq("status", "active").limit(1);
    if ((revoked?.length ?? 0) > 0 && (active?.length ?? 0) === 0) {
      await admin.from("messages").update({
        status: "blocked",
        error_message: "consent_revoked at send time",
      }).eq("id", message_id);
      return json(409, { error: "consent_revoked" });
    }

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromSms = Deno.env.get("TWILIO_FROM_NUMBER");
    const fromWa = Deno.env.get("TWILIO_WHATSAPP_FROM");
    const statusCallback = Deno.env.get("TWILIO_STATUS_WEBHOOK_URL") ?? "";

    if (!accountSid || !authToken) {
      await admin.from("messages").update({
        status: "blocked",
        error_message: "Provider not configured — TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN missing.",
      }).eq("id", message_id);
      return json(503, { error: "Provider not configured" });
    }

    const isWhatsApp = msg.channel === "whatsapp";
    const from = isWhatsApp ? `whatsapp:${fromWa}` : (msg.from_phone_e164 || fromSms);
    const to = isWhatsApp ? `whatsapp:${msg.to_phone_e164}` : msg.to_phone_e164;

    const body = new URLSearchParams({ From: from ?? "", To: to, Body: msg.body });
    if (statusCallback) body.set("StatusCallback", statusCallback);

    let twilioRes: Response;
    let twilioData: { sid?: string; message?: string };
    try {
      twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        },
      );
      twilioData = await twilioRes.json();
    } catch (sendErr) {
      // Transport failure before/while awaiting the provider: terminal fail so
      // the claim never wedges the row. Failed send never shows sent.
      await admin.from("messages").update({
        status: "failed",
        error_message: `send_exception: ${String(sendErr)}`,
        failed_at: new Date().toISOString(),
      }).eq("id", message_id);
      return json(502, { ok: false, error: "provider_unreachable" });
    }

    if (!twilioRes.ok) {
      await admin.from("messages").update({
        status: "failed",
        error_message: twilioData.message ?? "Twilio error",
        failed_at: new Date().toISOString(),
      }).eq("id", message_id);
      return json(502, { ok: false, error: twilioData.message });
    }

    const sentAt = new Date().toISOString();
    const { error: sentErr } = await admin.from("messages").update({
      status: "sent",
      provider_sid: twilioData.sid,
      sent_at: sentAt,
    }).eq("id", message_id);
    if (sentErr) {
      // SMS is out but the record is queued+claimed. Loud, operator-visible.
      console.error("sms-send: sent-update failed after provider accept", message_id, sentErr);
      return json(500, { ok: false, error: "post_send_record_failed" });
    }

    return json(200, { ok: true, provider_sid: twilioData.sid, sent_at: sentAt });
  } catch (err) {
    return json(500, { error: String(err) });
  }
});
