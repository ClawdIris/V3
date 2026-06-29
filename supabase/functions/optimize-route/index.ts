// optimize-route — Casabe Konnect Routes Slice 1
// Server-side route optimization via Google Routes API (computeRoutes with
// optimizeWaypointOrder). Reads GOOGLE_ROUTES_API_KEY from Edge secrets only.
//
// Request: POST {
//   route_id: string (uuid),
//   origin:   { lat, lng } | string,        // Tape Direct fixed origin
//   stops:    [{ order_id, lat, lng }],      // confirmed stops (address_confidence='high')
//   destination?: { lat, lng } | string      // optional manual end; defaults to origin
// }
// Response: { success, route_id, optimized_order: [order_id...],
//             distance_meters, duration_seconds }
//
// HARD RULE (plan Q1): on Routes API failure, return an error. Do NOT persist a
// fallback ordering. The caller leaves the last good route unchanged and retries.
// SECURITY: never echo the API key in any response/error.

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
function waypoint(p: LL | string) {
  return typeof p === "string"
    ? { address: p }
    : { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const API_KEY = Deno.env.get("GOOGLE_ROUTES_API_KEY");
  if (!API_KEY) return json({ error: "server_misconfigured" }, 500);

  let body: { route_id?: string; origin?: LL | string; stops?: Array<{ order_id: string } & LL>; destination?: LL | string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const { route_id, origin, stops, destination } = body;
  if (!route_id || !origin || !Array.isArray(stops) || stops.length === 0) {
    return json({ error: "missing_route_id_origin_or_stops" }, 400);
  }

  const intermediates = stops.map((s) => waypoint({ lat: s.lat, lng: s.lng }));
  const reqBody = {
    origin: waypoint(origin),
    destination: waypoint(destination ?? origin),
    intermediates,
    travelMode: "DRIVE",
    optimizeWaypointOrder: true,
  };

  let resp: Response;
  try {
    resp = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.optimizedIntermediateWaypointIndex",
      },
      body: JSON.stringify(reqBody),
    });
  } catch {
    return json({ error: "routes_api_unavailable" }, 502); // generic, no key leak
  }

  if (!resp.ok) {
    // Do NOT pass through Google's body (may include key context). Status only.
    return json({ error: "routes_api_failed", http_status: resp.status }, 502);
  }

  const data = await resp.json();
  const route = data.routes?.[0];
  if (!route) return json({ error: "no_route_returned" }, 502);

  // optimizedIntermediateWaypointIndex maps to the order of `stops` we sent.
  const order: string[] = (route.optimizedIntermediateWaypointIndex ?? stops.map((_, i) => i))
    .map((idx: number) => stops[idx]?.order_id)
    .filter(Boolean);

  const distance_meters = route.distanceMeters ?? null;
  const duration_seconds = route.duration ? parseInt(String(route.duration).replace("s", ""), 10) : null;

  return json({
    success: true,
    route_id,
    optimized_order: order,
    distance_meters,
    duration_seconds,
  });
});
