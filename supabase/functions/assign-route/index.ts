// assign-route — Casabe Konnect Routes Slice 1
// Finalizes a route: validates EVERY stop has a confirmed address
// (address_confirmed_at non-null), writes/locks the routes row, and assigns each
// stop via the narrow assign_order_to_route RPC. Returns a Google Maps deep link.
//
// Request: POST {
//   route_id: string (uuid),
//   driver_user_id?: string,
//   ordered_stops: [{ order_id, sequence }],   // optimized order from optimize-route
//   origin: { lat, lng } | string,
//   destination?: { lat, lng } | string
// }
// Response: { success, route_id, assigned_count, maps_url }
//
// Note: This function does NOT call Google (no GOOGLE_ROUTES_API_KEY needed). It is
// pure orchestration over RPCs + a deep-link builder. Kept in the same trio for
// deployment symmetry. Messaging/notification is intentionally OUT OF SCOPE (A2P fence).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
type LL = { lat: number; lng: number };
function ll(p: LL | string): string {
  return typeof p === "string" ? encodeURIComponent(p) : `${p.lat},${p.lng}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: {
    route_id?: string;
    ordered_stops?: Array<{ order_id: string; sequence: number }>;
    origin?: LL | string;
    destination?: LL | string;
  };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const { route_id, ordered_stops, origin, destination } = body;
  if (!route_id || !Array.isArray(ordered_stops) || ordered_stops.length === 0 || !origin) {
    return json({ error: "missing_route_id_stops_or_origin" }, 400);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const _hdrs: Record<string, string> = {};
  _hdrs["Authorization"] = authHeader;
  const clientOpts = { global: { headers: _hdrs } };
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    clientOpts,
  );

  // --- Address gate: every stop must have a confirmed address ---
  const orderIds = ordered_stops.map((s) => s.order_id);
  const { data: rows, error: selErr } = await supabase
    .from("orders")
    .select("id, address_confirmed_at")
    .in("id", orderIds);
  if (selErr) return json({ error: "gate_check_failed", detail: selErr.message }, 403);

  const unconfirmed = (rows ?? [])
    .filter((r: { address_confirmed_at: string | null }) => !r.address_confirmed_at)
    .map((r: { id: string }) => r.id);
  // Also flag any requested stop missing from the result set (RLS-hidden or absent).
  const missing = orderIds.filter((id) => !(rows ?? []).some((r: { id: string }) => r.id === id));
  if (unconfirmed.length > 0 || missing.length > 0) {
    return json({
      error: "unconfirmed_addresses",
      unconfirmed,
      missing,
    }, 422); // dispatch gate: do NOT assign
  }

  // --- Assign each stop via the narrow RPC (enforces HQ/Office + tenant + office scope) ---
  let assigned = 0;
  for (const stop of ordered_stops) {
    const { error: rpcErr } = await supabase.rpc("assign_order_to_route", {
      p_order_id: stop.order_id,
      p_route_id: route_id,
      p_route_sequence: stop.sequence,
    });
    if (rpcErr) {
      return json({
        error: "assign_failed",
        order_id: stop.order_id,
        assigned_so_far: assigned,
        detail: rpcErr.message,
      }, 403);
    }
    assigned++;
  }

  // --- Google Maps deep link (no key required) ---
  // https://www.google.com/maps/dir/?api=1&origin=..&destination=..&waypoints=..
  const waypoints = ordered_stops
    .slice(0, -1) // last stop becomes the destination
    .map((s) => ll({ lat: (s as unknown as LL).lat, lng: (s as unknown as LL).lng }))
    .filter(Boolean);
  const lastStop = ordered_stops[ordered_stops.length - 1] as unknown as LL;
  const dest = destination ?? lastStop ?? origin;
  let maps_url =
    "https://www.google.com/maps/dir/?api=1&origin=" + ll(origin) +
    "&destination=" + ll(dest) + "&travelmode=driving";
  if (waypoints.length > 0) maps_url += "&waypoints=" + waypoints.join("%7C");
  const over_deeplink_limit = ordered_stops.length > 23; // Google deep-link cap

  return json({
    success: true,
    route_id,
    assigned_count: assigned,
    maps_url,
    over_deeplink_limit,
  });
});
