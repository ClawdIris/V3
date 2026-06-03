// Supabase Edge Function: sms-send — R6
// Reads a queued message from the messages table (respects RLS),
// enforces messaging consent (sms_opted_in / whatsapp_opted_in),
// enforces rate limits (3/day per phone, 20/hour per tenant),
// sends via Twilio API server-side, updates status + provider_message_id.
// No Twilio credentials are exposed to the browser.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    // 1. Auth — caller must be authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // 2. Parse body
    const payload = await req.json();
    const { message_id } = payload;
    if (!message_id) {
      return new Response(JSON.stringify({ error: "message_id required" }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // 3. Supabase client — uses caller's JWT so RLS applies
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // 4. Read message — RLS enforces HQ/Office scope; driver/anon gets no rows
    const { data: msg, error: fetchErr } = await supabase
      .from("messages")
      .select("*")
      .eq("id", message_id)
      .single();

    if (fetchErr || !msg) {
      return new Response(JSON.stringify({ error: "Message not found or access denied" }), {
        status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // 5. Status guard — only send queued messages
    if (msg.status !== "queued") {
      return new Response(JSON.stringify({ error: "Message is not in queued status", status: msg.status }), {
        status: 409, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── Item 4b: Messaging Consent Check ─────────────────────────────────
    const channel = msg.channel as string; // "sms" or "whatsapp"
    const consentField = channel === "whatsapp" ? "whatsapp_opted_in" : "sms_opted_in";

    if (msg.order_id) {
      const { data: orderConsent } = await supabase
        .from("orders")
        .select(`id, ${consentField}`)
        .eq("id", msg.order_id)
        .single();

      if (!orderConsent || !orderConsent[consentField]) {
        await supabase.from("messages").update({
          status: "blocked",
          error_message: `Recipient has not opted in to ${channel} messages`,
          updated_at: new Date().toISOString(),
        }).eq("id", message_id);

        return new Response(JSON.stringify({ error: "No consent" }), {
          status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    // ── Item 5: Rate Limiting ─────────────────────────────────────────────
    // Per-recipient daily cap: max 3 messages per phone per day
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    const { count: todayCount } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("recipient_phone", msg.recipient_phone)
      .eq("status", "sent")
      .gte("created_at", `${today}T00:00:00Z`);

    if ((todayCount ?? 0) >= 3) {
      await supabase.from("messages").update({
        status: "blocked",
        error_message: "Rate limit exceeded: max 3 messages/day per recipient",
        updated_at: new Date().toISOString(),
      }).eq("id", message_id);

      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Per-tenant hourly cap: max 20 messages/hour per tenant
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count: tenantHourCount } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", msg.tenant_id)
      .eq("status", "sent")
      .gte("created_at", oneHourAgo);

    if ((tenantHourCount ?? 0) >= 20) {
      await supabase.from("messages").update({
        status: "blocked",
        error_message: "Rate limit exceeded: tenant hourly cap reached",
        updated_at: new Date().toISOString(),
      }).eq("id", message_id);

      return new Response(JSON.stringify({ error: "Tenant rate limit exceeded" }), {
        status: 429, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // 6. Read Twilio secrets from server environment (never from client)
    const accountSid  = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken   = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromSms     = Deno.env.get("TWILIO_FROM_NUMBER");
    const fromWa      = Deno.env.get("TWILIO_WHATSAPP_FROM");

    if (!accountSid || !authToken) {
      // Mark as blocked — provider not configured
      await supabase.from("messages").update({
        status: "blocked",
        error_message: "Provider not configured — TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN missing.",
        updated_at: new Date().toISOString(),
      }).eq("id", message_id);

      return new Response(JSON.stringify({ error: "Provider not configured" }), {
        status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // 7. Build Twilio request
    const isWhatsApp = msg.channel === "whatsapp";
    const from = isWhatsApp ? `whatsapp:${fromWa}` : fromSms;
    const to   = isWhatsApp ? `whatsapp:${msg.recipient_phone}` : msg.recipient_phone;

    const body = new URLSearchParams({
      From: from ?? "",
      To:   to,
      Body: msg.rendered_body,
    });

    // 8. Call Twilio — server-side only, never reaches browser
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    );

    const twilioData = await twilioRes.json();

    if (!twilioRes.ok) {
      // Mark failed
      await supabase.from("messages").update({
        status: "failed",
        error_message: twilioData.message ?? "Twilio error",
        updated_at: new Date().toISOString(),
      }).eq("id", message_id);

      return new Response(JSON.stringify({ ok: false, error: twilioData.message }), {
        status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // 9. Mark sent
    const sentAt = new Date().toISOString();
    await supabase.from("messages").update({
      status: "sent",
      provider_message_id: twilioData.sid,
      sent_at: sentAt,
      updated_at: sentAt,
    }).eq("id", message_id);

    return new Response(JSON.stringify({ ok: true, provider_message_id: twilioData.sid, sent_at: sentAt }), {
      status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
