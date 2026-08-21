// Supabase Edge Function: sms-send
// Hardened Phase 1 outbound sender. Supports legacy {message_id} and the new
// inbox {thread_id, body, template_key, category} contract. All consent/scope
// checks happen in server-side RPCs; Twilio secrets stay server-side only.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function mapRpcError(message = "send_failed") {
  if (message.includes("consent_revoked")) {
    return {
      status: 403,
      body: {
        ok: false,
        error: "consent_revoked",
        message: "This customer has opted out of text messages. Ask them to opt in again before sending.",
      },
    };
  }
  if (message.includes("denied") || message.includes("required")) {
    return { status: 403, body: { ok: false, error: message } };
  }
  return { status: 400, body: { ok: false, error: message } };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const payload = await req.json().catch(() => ({}));
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
  const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  let messageId = payload.message_id;
  if (!messageId) {
    const { data, error } = await supabase.rpc("inbox_send_message", {
      p_thread_id: payload.thread_id,
      p_body: payload.body,
      p_template_key: payload.template_key ?? null,
      p_category: payload.category ?? "transactional",
    });
    if (error) {
      const mapped = mapRpcError(error.message);
      return json(mapped.body, mapped.status);
    }
    messageId = data?.message_id;
  }
  if (!messageId) return json({ ok: false, error: "message_id required" }, 400);

  const { data: msg, error: fetchErr } = await supabase
    .from("messages")
    .select("*, message_threads!inner(customer_phone_e164,provider_phone_e164,tenant_id,channel)")
    .eq("id", messageId)
    .single();
  if (fetchErr || !msg) return json({ ok: false, error: "Message not found or access denied" }, 404);
  if (!["queued", "draft"].includes(msg.status)) {
    return json({ ok: false, error: "Message is not queued", status: msg.status }, 409);
  }
  if (msg.direction && msg.direction !== "outbound") {
    return json({ ok: false, error: "Cannot send inbound message" }, 409);
  }

  const category = msg.metadata?.category || payload.category || "transactional";
  const { data: eligibility, error: eligErr } = await service.rpc("resolve_sms_eligibility", {
    p_tenant_id: msg.tenant_id,
    p_phone_e164: msg.recipient_phone_e164 || msg.recipient_phone,
    p_category: category,
  }).single();
  if (eligErr || !eligibility?.allowed) {
    const reason = eligibility?.reason || eligErr?.message || "consent_required";
    await service.from("messages").update({
      status: "blocked",
      error_message: reason === "consent_revoked"
        ? "This customer has opted out of text messages. Ask them to opt in again before sending."
        : reason,
      updated_at: new Date().toISOString(),
    }).eq("id", messageId);
    if (reason === "consent_revoked") {
      return json({
        ok: false,
        error: "consent_revoked",
        message: "This customer has opted out of text messages. Ask them to opt in again before sending.",
      }, 403);
    }
    return json({ ok: false, error: reason }, 403);
  }

  const claim = await service
    .from("messages")
    .update({ status: "sending", provider_status: "sending", updated_at: new Date().toISOString() })
    .eq("id", messageId)
    .in("status", ["queued", "draft"])
    .select("id")
    .maybeSingle();
  if (!claim.data) return json({ ok: true, changed: false, message_id: messageId, provider_status: msg.provider_status || msg.status }, 200);

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromSms = Deno.env.get("TWILIO_FROM_NUMBER");
  const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  const statusCallback = Deno.env.get("TWILIO_STATUS_CALLBACK_URL");
  if (!accountSid || !authToken || (!fromSms && !messagingServiceSid)) {
    await service.from("messages").update({
      status: "failed",
      provider_status: "failed",
      error_message: "Provider not configured",
      failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", messageId);
    return json({ ok: false, error: "Provider not configured" }, 503);
  }

  const body = new URLSearchParams({
    To: msg.recipient_phone_e164 || msg.recipient_phone,
    Body: msg.body || msg.rendered_body,
  });
  if (messagingServiceSid) body.set("MessagingServiceSid", messagingServiceSid);
  else body.set("From", msg.sender_phone_e164 || fromSms || "");
  if (statusCallback) body.set("StatusCallback", statusCallback);

  const twilioRes = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + accountSid + "/Messages.json", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(accountSid + ":" + authToken),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const twilioData = await twilioRes.json().catch(() => ({}));

  if (!twilioRes.ok) {
    await service.from("messages").update({
      status: "failed",
      provider_status: "failed",
      provider_error_code: twilioData.code ? String(twilioData.code) : null,
      provider_error_message: twilioData.message || "Twilio error",
      error_message: twilioData.message || "Twilio error",
      failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", messageId);
    return json({ ok: false, error: twilioData.message || "Twilio error" }, 502);
  }

  const providerStatus = twilioData.status || "accepted";
  await service.from("messages").update({
    status: providerStatus === "queued" ? "queued" : "accepted",
    provider_status: providerStatus,
    provider_message_id: twilioData.sid,
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", messageId);

  return json({ ok: true, changed: true, message_id: messageId, provider_message_id: twilioData.sid, provider_status: providerStatus });
});
