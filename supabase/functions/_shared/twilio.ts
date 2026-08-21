const encoder = new TextEncoder();

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export function twiml(status = 200) {
  return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

export function normalizeE164(value: string | null): string | null {
  let v = String(value || "").replace(/[^0-9+]/g, "");
  if (!v) return null;
  if (!v.startsWith("+") && v.length === 10) v = "+1" + v;
  if (!v.startsWith("+")) v = "+" + v.replace(/[^0-9]/g, "");
  return /^\+[1-9][0-9]{7,14}$/.test(v) ? v : null;
}

function timingSafeEqual(a: string, b: string): boolean {
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  if (aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa[i] ^ bb[i];
  return out === 0;
}

async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function verifyTwilioSignature(params: URLSearchParams, signature: string | null, configuredUrl: string | undefined): Promise<boolean> {
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!token || !configuredUrl || !signature) return false;
  const sorted = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const base = configuredUrl + sorted.map(([k, v]) => k + v).join("");
  const expected = await hmacSha1Base64(token, base);
  return timingSafeEqual(expected, signature);
}

export function formToObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}
