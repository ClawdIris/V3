// ============================================================================
// Supabase Edge Function: payment-receipt (Ticket D, public receipt handler)
// Presentation revision: text/plain (shared supabase.co rewrites text/html).
// Security: unchanged from pack 3635d96f… — session_id + RPC required for paid.
// Deploy config: verify_jwt = FALSE (public receipt surface — no auth).
// READ-ONLY. Calls only get_public_payment_receipt (a STABLE read RPC).
// NEVER writes paid state; never calls merge/claim/finalize (SEC-1/1b).
// Return params are HINTS, not proof: paid is shown only when the DB
// (webhook-written) confirms settlement for the provided session_id.
// Bare ?number= shows a neutral state, never "paid" (D-D2).
// stripe-checkout is a separate function and stays verify_jwt=true.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function flat(s: string): string {
  return String(s).replace(/[\r\n\t]+/g, " ").trim();
}

function page(title: string, lines: string[]): Response {
  const body = ["Casabe Konnect", title, "", ...lines.filter(Boolean)].join("\n") + "\n";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function lookupReceipt(sessionId: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_payment_receipt`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ p_session_id: sessionId }),
  });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const sessionId = (url.searchParams.get("session_id") ?? "").trim();
  const number = (url.searchParams.get("number") ?? "").trim();

  // Paid confirmation requires a session_id and DB settlement (D-D2/D-D4).
  if (sessionId) {
    const r = await lookupReceipt(sessionId);
    if (r && r.found === true && r.paid === true) {
      const amt = typeof r.amount === "number" ? `$${(r.amount as number).toFixed(2)}` : "";
      const currency = flat(String(r.currency ?? "USD"));
      const orderRef = flat(String(r.order_ref ?? ""));
      return page("Payment received", [
        orderRef ? `Order: ${orderRef}` : "",
        amt ? `Amount: ${amt} ${currency}` : "",
        "Status: Paid",
        "",
        "Thank you. A confirmation for this shipment payment has been recorded. You can close this page.",
      ]);
    }
    // Session provided but not settled/known: neutral, never a false paid.
    return page("Payment status", [
      "We could not confirm a completed payment for this link yet. If you just paid, it may take a moment to process. This page never displays payment status that has not been confirmed by our system.",
    ]);
  }

  // Bare ?number= (or nothing): neutral tracking/return state, never "paid".
  const ref = number ? flat(number) : "";
  return page("Thanks for your return", [
    ref ? `Reference: ${ref}` : "",
    `We received your return to Casabe Konnect${ref ? ` for reference ${ref}` : ""}. Payment status is not shown here without a verified payment session. For questions, contact your Casabe office.`,
  ]);
});
