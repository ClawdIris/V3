// Supabase Edge Function: sms-status
// Returns the status of the SMS/WhatsApp provider configuration.
// Used by UI to display whether the provider is ready to send messages.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    // 1. Auth — caller must be authenticated (HQ role enforced client-side)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // 2. Check Twilio secrets from server environment
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromSms = Deno.env.get("TWILIO_FROM_NUMBER");
    const fromWa = Deno.env.get("TWILIO_WHATSAPP_FROM");

    // 3. Return configuration status
    const configured = Boolean(accountSid && authToken && fromSms && fromWa);

    return new Response(JSON.stringify({
      configured,
      sms_number_configured: Boolean(fromSms),
      whatsapp_configured: Boolean(fromWa),
      auth_configured: Boolean(accountSid && authToken),
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
