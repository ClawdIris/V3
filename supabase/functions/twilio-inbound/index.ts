// Supabase Edge Function: twilio-inbound
// Public Twilio webhook. verify_jwt=false required at deployment, but Twilio
// signature verification is mandatory and fails closed.

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
    Deno.env.get("TWILIO_INBOUND_WEBHOOK_URL"),
  );
  if (!ok) return new Response("forbidden", { status: 403 });

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  if (accountSid && params.get("AccountSid") !== accountSid) {
    return new Response("forbidden", { status: 403 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { error } = await supabase.rpc("twilio_ingest_inbound", {
    p_message_sid: params.get("MessageSid"),
    p_account_sid: params.get("AccountSid"),
    p_from: params.get("From"),
    p_to: params.get("To"),
    p_body: params.get("Body") || "",
    p_opt_out_type: params.get("OptOutType"),
    p_num_media: Number(params.get("NumMedia") || 0),
    p_raw: formToObject(params),
  });

  if (error) {
    console.error("twilio-inbound failed", {
      code: error.code,
      message: error.message,
      messageSid: params.get("MessageSid"),
    });
    return new Response("forbidden", { status: error.message === "twilio_unknown_to" ? 403 : 500 });
  }

  return twiml(200);
});
