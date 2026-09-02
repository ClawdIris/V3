// ============================================================================
// Supabase Edge Function: sms-delivery-status — v1 (Twilio Phase 1, T8 / W-7)
// FILE-ONLY REVIEW ARTIFACT — do not deploy until the Phase 1 migration is
// applied (post-Pack-3) and the exact-diff review has passed.
//
// Purpose: dedicated Twilio StatusCallback receiver. The existing sms-status
// function is a config-status endpoint with verify_jwt=true and cannot
// receive Twilio callbacks (W-7); it is left untouched.
//
// Deploy config: verify_jwt = false. Auth is the fail-closed Twilio signature,
// identical in posture to sms-inbound v6 (T7):
//   * missing TWILIO_AUTH_TOKEN or missing TWILIO_STATUS_WEBHOOK_URL => 403
//     for every request;
//   * signature validated against the pinned TWILIO_STATUS_WEBHOOK_URL only —
//     no req.url fallback.
//
// Behavior (T8): updates ONLY existing outbound messages rows by provider_sid
// (status + provider timestamps) via public.apply_delivery_status. Unknown
// sid: logged no-op, creates nothing. Never touches consent or threads.
// Status transitions are whitelisted server-side (invariant 5: a failed send
// can never display as sent).
//
// Env: TWILIO_AUTH_TOKEN (required), TWILIO_STATUS_WEBHOOK_URL (required —
// the exact StatusCallback URL configured on sends / in the Twilio console).
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_STATUS_WEBHOOK_URL = Deno.env.get("TWILIO_STATUS_WEBHOOK_URL") ?? "";

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

Deno.serve(async (req: Request) => {
  // FAIL-CLOSED: unconfigured => 403 for everything (identical to T7).
  if (!TWILIO_AUTH_TOKEN || !TWILIO_STATUS_WEBHOOK_URL) {
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const params: Record<string, string> = {};
  try {
    const form = await req.formData();
    for (const [k, v] of form.entries()) params[k] = String(v);
  } catch { /* empty params can never carry a valid signature */ }

  const sig = req.headers.get("x-twilio-signature") ?? "";
  if (!sig) return new Response("forbidden", { status: 403 });
  const expected = await computeTwilioSignature(TWILIO_STATUS_WEBHOOK_URL, params);
  if (!timingSafeEqual(expected, sig)) {
    return new Response("forbidden", { status: 403 });
  }

  const providerSid = (params["MessageSid"] ?? params["SmsSid"] ?? "").trim();
  const messageStatus = (params["MessageStatus"] ?? params["SmsStatus"] ?? "").trim();
  const errorCode = (params["ErrorCode"] ?? "").trim();

  if (!providerSid || !messageStatus) {
    return new Response("bad request", { status: 400 });
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/apply_delivery_status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      p_provider_sid: providerSid,
      p_status: messageStatus,
      p_error: errorCode ? `twilio error ${errorCode}` : null,
    }),
  });

  if (!res.ok) {
    // DB-side failure: 500 so Twilio retries the callback.
    console.error("sms-delivery-status: apply failed", res.status);
    return new Response("apply failed", { status: 500 });
  }

  let result: { updated?: number; ignored?: boolean } = {};
  try { result = await res.json(); } catch { /* empty */ }
  if (result.ignored) {
    // Unknown sid or untracked/illegal transition: log the no-op (T8).
    console.log("sms-delivery-status: no-op", providerSid, messageStatus);
  }

  return new Response(null, { status: 204 });
});
