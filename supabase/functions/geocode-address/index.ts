// geocode-address — Casabe Konnect Routes Slice 1
// Server-side geocoding. Reads GOOGLE_ROUTES_API_KEY from Edge Function secrets
// (NEVER baked into source / never sent to the browser). Classifies confidence
// from Google's location_type, then calls the narrow confirm_order_address RPC.
//
// Request:  POST { order_id: string, address: string }
// Response: { success, order_id, confidence, lat, lng, resolved_address }
//
// Confidence mapping (location_type -> address_confidence):
//   ROOFTOP | RANGE_INTERPOLATED  -> 'high'
//   GEOMETRIC_CENTER | APPROXIMATE -> 'low'
//   (no result)                    -> 'unresolvable'
//
// SECURITY: never echo the API key in any response or error body.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const API_KEY = Deno.env.get("GOOGLE_ROUTES_API_KEY");
  if (!API_KEY) return json({ error: "server_misconfigured" }, 500); // never name the secret

  let payload: { order_id?: string; address?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const { order_id, address } = payload;
  if (!order_id || !address) return json({ error: "missing_order_id_or_address" }, 400);

  // Forward the caller's JWT so the RPC runs as the authenticated HQ/Office user
  // (confirm_order_address enforces role + tenant; SECURITY DEFINER + manual checks).
  const authHeader = req.headers.get("Authorization") ?? "";
  const _hdrs: Record<string, string> = {};
  _hdrs["Authorization"] = authHeader;
  const clientOpts = { global: { headers: _hdrs } };
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    clientOpts,
  );

  // --- Google Geocoding ---
  let geo: Response;
  try {
    const url = "https://maps.googleapis.com/maps/api/geocode/json?address=" +
      encodeURIComponent(address) + "&key=" + encodeURIComponent(API_KEY);
    geo = await fetch(url);
  } catch {
    return json({ error: "geocoding_unavailable" }, 502); // generic, no key leak
  }
  const data = await geo.json();

  // Distinguish "address genuinely not found" (ZERO_RESULTS) from an API/config
  // error (REQUEST_DENIED, OVER_QUERY_LIMIT, etc.). Check status BEFORE results,
  // otherwise a REQUEST_DENIED (0 results) is mis-reported as 'unresolvable'.
  if (data.status === "ZERO_RESULTS") {
    return json({ success: false, order_id, confidence: "unresolvable" });
  }
  if (data.status !== "OK") {
    // Surface the Google status code (e.g. REQUEST_DENIED) so config problems are
    // diagnosable, but NEVER echo error_message (can contain key/referrer context).
    return json({ error: "geocoding_failed", status: data.status }, 502);
  }
  if (!data.results?.length) {
    return json({ success: false, order_id, confidence: "unresolvable" });
  }

  const top = data.results[0];
  const locType = top.geometry?.location_type as string | undefined;
  const confidence =
    locType === "ROOFTOP" || locType === "RANGE_INTERPOLATED" ? "high"
    : locType === "GEOMETRIC_CENTER" || locType === "APPROXIMATE" ? "low"
    : "low";
  const lat = top.geometry?.location?.lat ?? null;
  const lng = top.geometry?.location?.lng ?? null;
  const resolved_address = top.formatted_address ?? address;

  // --- Persist via narrow RPC (enforces HQ/Office + tenant) ---
  const { error: rpcErr } = await supabase.rpc("confirm_order_address", {
    p_order_id: order_id,
    p_address: resolved_address,
    p_lat: lat,
    p_lng: lng,
    p_confidence: confidence,
  });
  if (rpcErr) {
    return json({ error: "persist_failed", detail: rpcErr.message }, 403);
  }

  return json({ success: true, order_id, confidence, lat, lng, resolved_address });
});
