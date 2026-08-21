// Supabase Edge Function: sms-status
// Server-authorized provider readiness. Returns booleans only, never secrets.

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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: member, error: memberError } = await supabase.rpc("twilio_current_member").single();
  const role = String((member as any)?.role || "");
  if (memberError || !["hq", "admin", "owner", "office"].includes(role)) {
    return json({ error: "Forbidden" }, 403);
  }

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromSms = Deno.env.get("TWILIO_FROM_NUMBER");
  const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  const inboundUrl = Deno.env.get("TWILIO_INBOUND_WEBHOOK_URL");
  const statusUrl = Deno.env.get("TWILIO_STATUS_CALLBACK_URL");

  const authConfigured = Boolean(accountSid && authToken);
  const smsSenderConfigured = Boolean(fromSms || messagingServiceSid);
  const webhookConfigured = Boolean(inboundUrl && statusUrl);

  return json({
    configured: authConfigured && smsSenderConfigured,
    sms_configured: authConfigured && smsSenderConfigured,
    whatsapp_configured: Boolean(Deno.env.get("TWILIO_WHATSAPP_FROM") && authConfigured),
    auth_configured: authConfigured,
    sms_number_configured: Boolean(fromSms),
    messaging_service_configured: Boolean(messagingServiceSid),
    inbound_webhook_configured: Boolean(inboundUrl),
    status_callback_configured: Boolean(statusUrl),
    webhook_configured: webhookConfigured,
  });
});
