// Supabase Edge Function: twilio-status-callback
// Public Twilio delivery callback. Signature required, idempotent, monotonic.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS, formToObject, twiml, verifyTwilioSignature } from "../_shared/twilio.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return new Response("unsupported_media_type", { status: 415 });
  }

  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const ok = await verifyTwilioSignature(
    params,
    req.headers.get("x-twilio-signature"),
    Deno.env.get("TWILIO_STATUS_CALLBACK_URL"),
  );
  if (!ok) return new Response("forbidden", { status: 403 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { error } = await supabase.rpc("twilio_apply_status_callback", {
    p_message_sid: params.get("MessageSid"),
    p_message_status: params.get("MessageStatus") || params.get("SmsStatus"),
    p_error_code: params.get("ErrorCode"),
    p_error_message: params.get("ErrorMessage"),
    p_raw: formToObject(params),
  });

  if (error) {
    console.error("twilio-status-callback failed", {
      code: error.code,
      message: error.message,
      messageSid: params.get("MessageSid"),
    });
    return new Response("status_callback_failed", { status: 500 });
  }

  return twiml(200);
});
