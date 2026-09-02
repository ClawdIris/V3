-- fc1_merge_guard_r3.sql
-- SOURCE-TRUTH ARTIFACT. NOT a migration. NOT an apply.
--
-- WHY THIS LIVES IN supabase/sql-artifacts/ AND NOT supabase/migrations/:
--   Already applied on both projects — staging as 20260901031709
--   fc1_merge_guard_r3, production as 20260901120932 fc1_merge_guard_prod_r3.
--   A copy under supabase/migrations/ with a new version number would let a
--   later `supabase db push` CREATE OR REPLACE the settlement guard on a live
--   payments path. This directory does not execute.
--
-- LIVE HASHES (raw pg_get_functiondef — canonical convention):
--   staging zpqkhbhhgxaiallqvigr : cbbaacc8eeb7fd0583d5d1c91badcb81a9abc1bfed328ef44ffe9a523bfcc33c
--   production exayifxbqduhsxmmsnxr: cbbaacc8eeb7fd0583d5d1c91badcb81a9abc1bfed328ef44ffe9a523bfcc33c
--   Byte-identical on both projects, verified 2026-09-02.
--
-- HISTORICAL NOTE — three conventions, one function, all correct:
--   raw pg_get_functiondef            cbbaacc8...  <-- CANONICAL, use this
--   rtrim(pg_get_functiondef,'\n')    4d8ee67e...  <-- used by earlier F-C1 packs
--   inner $function$ body only        e16623f3...
--   The F-C1 evidence chain quotes 4d8ee67e...; that value is NOT wrong, it is
--   the rtrim'd form. Any checker computing the canonical form will see
--   cbbaacc8... A bare hash with no convention attached is the actual defect,
--   and it is fixed by naming the convention here.
--
-- Provenance: accepted prod-fc1-settlement-guard-pack-20260901-v1 file
--   01_fc1_merge_guard_prod.sql sha256
--   a4a1b6c636d3dc740015ab76f00e1e85aa6cbd9fd616632b38c2df2c5f138a79
--   The SQL core below is byte-identical to that accepted artifact.
--
-- Guard behavior: an order already paid whose stored session IS DISTINCT FROM
-- the incoming session never has its paid state overwritten; the attempt is
-- appended to data.payment_duplicates and a WARNING is raised. A NULL stored
-- session is DISTINCT from any session, so manually-paid rows are guarded too.
--
-- SQL-LOCK checker remains a SEPARATE TICKET. Source truth only.

BEGIN;

CREATE OR REPLACE FUNCTION public.merge_stripe_payment_completed(p_order_id text, p_tenant_id text, p_session_id text, p_payment_status text, p_payment_method text, p_amount_paid numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_existing_status text;
  v_existing_session text;
BEGIN
  -- P1-R4-5: Reject zero or negative amounts — do not mark paid with no payment.
  IF p_amount_paid <= 0 THEN
    RAISE EXCEPTION
      'merge_stripe_payment_completed: p_amount_paid must be > 0, got % for order %',
      p_amount_paid, p_order_id;
  END IF;

  SELECT o.data->'payment'->>'status',
         COALESCE(o.data->'payment'->>'stripe_session_id', o.data->>'stripe_session_id')
    INTO v_existing_status, v_existing_session
    FROM public.orders o
   WHERE o.id = p_order_id AND o.tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'merge_stripe_payment_completed: order % not found for tenant %',
      p_order_id, p_tenant_id;
  END IF;

  -- F-C1 settlement guard (r3): already paid and the incoming session is not
  -- the stored one -> never overwrite the settled state; append the duplicate
  -- for operator review. NULL stored session (e.g. manually-paid cash/Zelle
  -- rows) is DISTINCT from any incoming session, so those rows are guarded
  -- too. Same-session replay stays idempotent (not distinct -> falls through).
  IF v_existing_status = 'paid'
     AND v_existing_session IS DISTINCT FROM p_session_id THEN
    UPDATE public.orders
       SET data = data || jsonb_build_object(
             'payment_duplicates',
             COALESCE(data->'payment_duplicates', '[]'::jsonb)
               || jsonb_build_array(jsonb_build_object(
                    'session_id', p_session_id,
                    'amount', (p_amount_paid / 100.0),
                    'method', p_payment_method,
                    'observed_at', now()::text,
                    'note', 'F-C1 duplicate settlement — paid state preserved'))
           )
     WHERE id = p_order_id AND tenant_id = p_tenant_id;
    RAISE WARNING 'F-C1 duplicate settlement on order % (kept session %, duplicate %)',
      p_order_id, v_existing_session, p_session_id;
    RETURN;
  END IF;

  UPDATE public.orders
  SET data = data
    || jsonb_build_object('stripe_session_id', p_session_id)
    || jsonb_build_object(
         'payment', COALESCE(data->'payment', '{}'::jsonb)
           || jsonb_build_object(
                'status',            p_payment_status,
                'method',            p_payment_method,
                'stripe_session_id', p_session_id,
                'paid',              (p_amount_paid / 100.0)  -- P1-R4-5: cents → dollars
              )
       )
  WHERE id        = p_order_id
    AND tenant_id = p_tenant_id;
END;
$function$;

COMMIT;
