-- get_public_payment_receipt.sql
-- SOURCE-TRUTH ARTIFACT. NOT a migration. NOT an apply.
--
-- WHY THIS LIVES IN supabase/sql-artifacts/ AND NOT supabase/migrations/:
--   This function is ALREADY APPLIED on both projects. Production recorded it
--   as migration 20260901113950 get_public_payment_receipt_v2. Placing a second
--   copy under supabase/migrations/ with a NEW version number would mean a
--   later `supabase db push` re-executes CREATE OR REPLACE against a live money
--   path — which flatly contradicts "merging changes no database". This
--   directory is not on the migration execution path, so the repo records what
--   is deployed without ever replaying it.
--
-- LIVE HASHES (raw pg_get_functiondef — the canonical convention, see below):
--   staging zpqkhbhhgxaiallqvigr : db84153a1529124fe982d2568bcf06400e9f710bfca1140788f54cee6658621c
--   production exayifxbqduhsxmmsnxr: db84153a1529124fe982d2568bcf06400e9f710bfca1140788f54cee6658621c
--   Byte-identical on both projects, verified 2026-09-02.
--
-- HASH CONVENTION — read this before writing any checker:
--   Canonical = encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')
--   with NO post-processing. Earlier packs in this project used a rtrim'd
--   variant, which produced different-but-also-correct digits for the same
--   healthy function. Recording a bare hash without its convention is how a
--   future SQL-LOCK checker false-fails a function that never drifted. One
--   convention, stated, from here on.
--
-- Provenance: accepted receipt-rpc-prod-pack-20260902-v2 file
--   01_get_public_payment_receipt.sql sha256
--   3810d37c44bef68c61f2dde52bc6061a87028726888378ef49429925773f390a
--   The SQL core below is byte-identical to that accepted artifact.
--
-- SQL-LOCK checker (a verifier that compares deployed bodies against these
-- files) remains a SEPARATE TICKET. This pack records source truth only.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_payment_receipt(p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order record;
  v_paid_status text;
  v_amount numeric;
  v_session text;
BEGIN
  -- Reject empty/malformed session ids fast; uniform not-found.
  IF p_session_id IS NULL OR length(trim(p_session_id)) < 8
     OR p_session_id !~ '^cs_[A-Za-z0-9_]+$' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Look up the order whose STORED session id matches. The webhook wrote
  -- data->>'stripe_session_id'; we trust that, never the client param.
  SELECT o.id, o.data INTO v_order
    FROM public.orders o
   WHERE o.data->>'stripe_session_id' = p_session_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_paid_status := v_order.data->'payment'->>'status';
  v_session     := v_order.data->'payment'->>'stripe_session_id';
  v_amount      := (v_order.data->'payment'->>'paid')::numeric;

  -- Only confirm paid when our DB (webhook-written) says so AND the
  -- stored payment session matches the requested one.
  IF v_paid_status IS DISTINCT FROM 'paid' OR v_session IS DISTINCT FROM p_session_id THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Minimal disclosure: paid flag, amount, order reference. No PII, no
  -- tenant/office ids, no other fields.
  RETURN jsonb_build_object(
    'found', true,
    'paid', true,
    'order_ref', v_order.id,
    'amount', v_amount,
    'currency', 'USD'
  );
END;
$function$;

-- Grants: exact staging parity. See README finding R-1 on the anon grant.
REVOKE ALL ON FUNCTION public.get_public_payment_receipt(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_payment_receipt(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_payment_receipt(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_payment_receipt(text) TO service_role;

COMMIT;
