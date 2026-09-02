// ============================================================================
// Supabase Edge Function: sms-inbound — v6 (Twilio Phase 1, T7)
// FILE-ONLY REVIEW ARTIFACT — do not deploy until the Phase 1 migration is
// applied (post-Pack-3) and the exact-diff review has passed.
//
// Deploy config: verify_jwt = false (Twilio cannot send a Supabase JWT; auth
// is the fail-closed Twilio signature below).
//
// BUNDLE v5 PATCH (Aug 24, owner-approved, Option A keyword ruling): one
// guard added — OptOutType present => empty TwiML, because Twilio Advanced
// Opt-Out owns live keyword replies and forwards the webhook after replying.
// No other behavior changed; ingest/consent path untouched.
//
// Changes vs v5 (sha256 a147f5fe...2cb02b), closing W-1..W-6:
//   W-1 FAIL-CLOSED: missing TWILIO_AUTH_TOKEN or TWILIO_WEBHOOK_URL => 403
//       for every request, no exceptions. v5 validated only when the token
//       happened to be set.
//   W-2 Signature is validated against the pinned TWILIO_WEBHOOK_URL ONLY.
//       The req.url fallback is removed.
//   W-3 MessageSid idempotency: replayed webhooks create no rows, no consent
//       writes, no duplicate replies (enforced transactionally in
//       public.ingest_inbound_message).
//   W-4 ALL inbound is persisted: registry-matched messages create-or-reuse a
//       thread (T2); unknown/inactive To-numbers persist as unmatched triage
//       with NO tenant assigned (T1) — never guessed, never dropped.
//   W-5 START and HELP handled alongside STOP (T4). STOP/START return empty
//       TwiML (Twilio Advanced Opt-Out owns those confirmations — no double
//       reply). HELP returns the static compliant response below.
//   W-6 Tenant resolution comes ONLY from public.messaging_numbers, inside
//       ingest_inbound_message — never from the webhook payload or heuristics.
//
// Env: TWILIO_AUTH_TOKEN (required), TWILIO_WEBHOOK_URL (required — the exact
// URL configured in the Twilio console). Auto-injected: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_WEBHOOK_URL = Deno.env.get("TWILIO_WEBHOOK_URL") ?? "";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
// A2P-compliant HELP response. Owner-selected copy 2026-08-20: bilingual
// EN/ES; brand token Casabe LLC PENDING confirmation against the A2P
// campaign registration (swap the leading token if the campaign is registered
// under a different brand). Accent-free Spanish keeps it GSM-7, one segment.
// NOTE for cutover: if Twilio Advanced Opt-Out is configured with its own
// HELP template, disable that template at console cutover so this is the
// single HELP reply (no double replies — T4).
const HELP_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Message>' +
  "Casabe LLC: Reply with your question / Responde aqui con tu pregunta. " +
  "casabekonnect.app. Msg&amp;Data rates may apply. Reply STOP to opt out." +
  "</Message></Response>";

function twiml(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/xml" } });
}

// Twilio signature: base64( HMAC-SHA1( authToken, url + sorted(key+value) ) )
async function computeTwilioSignature(url: string, params: Record<string, string>): Promise<string> {
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(TWILIO_AUTH_TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(args),
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

Deno.serve(async (req: Request) => {
  // W-1: FAIL-CLOSED. No token or no pinned URL => 403 for EVERYTHING.
  if (!TWILIO_AUTH_TOKEN || !TWILIO_WEBHOOK_URL) {
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  // Parse the form body. An unparseable body yields zero params, which can
  // never carry a valid signature — it falls through to the 403 below.
  const params: Record<string, string> = {};
  try {
    const form = await req.formData();
    for (const [k, v] of form.entries()) params[k] = String(v);
  } catch { /* fall through with empty params */ }

  // W-2: signature over the PINNED URL only. No req.url fallback, ever.
  const sig = req.headers.get("x-twilio-signature") ?? "";
  if (!sig) return new Response("forbidden", { status: 403 });
  const expected = await computeTwilioSignature(TWILIO_WEBHOOK_URL, params);
  if (!timingSafeEqual(expected, sig)) {
    return new Response("forbidden", { status: 403 });
  }

  const messageSid = (params["MessageSid"] ?? params["SmsSid"] ?? "").trim();
  const from = (params["From"] ?? "").trim();
  const to = (params["To"] ?? "").trim();
  const body = params["Body"] ?? "";

  if (!messageSid || !from || !to) {
    // Signed but not a message webhook shape; nothing to persist.
    return new Response("bad request", { status: 400 });
  }

  // W-3/W-4/W-6: transactional persist-all + registry resolution + consent.
  const { status, json } = await rpc("ingest_inbound_message", {
    p_provider_sid: messageSid,
    p_from: from,
    p_to: to,
    p_body: body,
  });

  if (status < 200 || status >= 300) {
    // Persistence failed: return 500 so Twilio retries (persist-all).
    console.error("sms-inbound: ingest failed", status, JSON.stringify(json).slice(0, 500));
    return new Response("ingest failed", { status: 500 });
  }

  const result = (json ?? {}) as { replayed?: boolean; action?: string };

  // Replays get no reply of any kind (no duplicate HELP responses).
  if (result.replayed) return twiml(EMPTY_TWIML);

  // v7 (staging finding, owner-approved Aug 28): Twilio Advanced Opt-Out
  // now owns the customer-facing HELP/STOP/START replies. Ingest above has
  // already run, so OptOutType webhooks return empty TwiML to avoid a second
  // reply attempt and Twilio 30007 filter noise.
  if (params["OptOutType"]) return twiml(EMPTY_TWIML);

  // W-5/T4: HELP_TWIML remains the fail-safe if a HELP arrives without
  // OptOutType (service-managed handling absent).
  if (result.action === "help") return twiml(HELP_TWIML);
  return twiml(EMPTY_TWIML);
});
