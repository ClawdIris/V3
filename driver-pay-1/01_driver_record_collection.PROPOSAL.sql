-- ═══════════════════════════════════════════════════════════════════════════
-- DRIVER-PAY-1 — PROPOSAL ONLY. FILE-ONLY DRAFT. DO NOT APPLY.
-- ═══════════════════════════════════════════════════════════════════════════
-- Deliberately NOT placed in supabase/migrations/ so that no migration runner
-- can pick it up. It has not been applied, not been executed, and not been
-- syntax-checked against a database. It is a contract for review.
--
-- WHY THIS EXISTS
--   A driver who collects cash at a pickup has no authorized write path today:
--     * driver_update_order_status(p_order_id, p_new_status, p_box_sub_id,
--       p_reason_code, p_reason_note) has no field for an amount or a method;
--     * the local SQL sources create no driver UPDATE policy on public.orders
--       (stripe-security-migration.sql lines 84-107 state this is deliberate),
--       so the frontend's _db.upsert("orders", ...) is expected to be refused
--       for an authenticated driver.
--   The UI defect DRIVER-UI-1 hid that: the write was fire-and-forget and the
--   receipt opened regardless. That is now surfaced instead of faked. This file
--   proposes the missing server contract.
--
-- WHAT IS DELIBERATELY NOT DECIDED HERE
--   Money semantics are the owner's. This draft records an amount and leaves
--   every judgement call to OPEN-D* below. It does NOT set payment.status, does
--   NOT decide over-collection, currency, refund interaction or commission
--   basis, and it invents no limit values.
--
-- OPEN DECISIONS (owner/reviewer, before this can be built)
--   OPEN-D1 Atomicity with the status change. A collection recorded without the
--           stop completing (or the reverse) is exactly the failure this ticket
--           came from. Recommended: ONE transaction that does both, which means
--           refactoring the transition validation in
--           driver_update_order_status into a shared internal function rather
--           than duplicating it. Alternative: money-only RPC called before the
--           status RPC, accepting a two-call window. NOT chosen here.
--   OPEN-D2 payment.status derivation ('paid' / 'deposit' / 'unpaid') and who
--           owns it. This draft writes only numbers, so a reader derives the
--           balance arithmetically. Until D2 is decided, no label is written.
--   OPEN-D3 Over-collection: refuse, accept and record a credit, or accept and
--           flag. No default is assumed.
--   OPEN-D4 Per-collection ceiling. Modelled on the existing deposit pattern
--           (tenant_settings config, fail closed when missing or invalid) so no
--           number is invented in code. The value itself is the owner's.
--   OPEN-D5 Currency. The order's own currency vs a tenant default, and whether
--           a mismatch refuses. Single-currency assumption NOT made.
--   OPEN-D6 Commission basis: whether a driver-collected amount feeds
--           commissionSnapshot.grossCollected, and at what moment. Interacts
--           with R3/P6 and is not settled.
--   OPEN-D7 Whether service_role also needs EXECUTE for back-office correction,
--           and what the correction/void path is (this draft has none: the
--           event table is append-only, so a mistake needs a reversal contract).
--
-- AUTHORIZATION INVENTORY (what already exists locally, reused not widened)
--   public.current_tenant_id()                      tenant resolution helper
--   public.members (user_id, tenant_id, active,
--                   app_role/role, metadata)         role + capability source
--   data.assignedDriverUserId                       origin-lane assignment
--   driver_update_order_status                      SECURITY DEFINER,
--     search_path '', REVOKE PUBLIC+anon,
--     GRANT authenticated                           the authorization shape
--                                                   this proposal copies
--   orders_driver_select (r1-rls-driver-fix.sql)     driver READ path
--   NO orders driver UPDATE policy                   the gap being closed
--   merge_stripe_payment_* (service_role only)      the only existing payment
--                                                   writers; webhook-driven,
--                                                   not reachable by a driver
--
-- AUDIT SCOPE, stated honestly: the refusal audit row commits in the SAME
-- ordinary transaction as the request (convention O1 from R1). That is NOT an
-- autonomous audit guarantee — an outer rollback or a later unhandled failure
-- still rolls it back. No dblink, no background connection, no autonomous shim.
--
-- Rollback: driver-pay-1/rollback/01_driver_record_collection_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Event store. One row per accepted collection, keyed for idempotent replay.
CREATE TABLE IF NOT EXISTS public.driver_collection_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT        NOT NULL,
  order_id          TEXT        NOT NULL,
  box_sub_id        TEXT,
  client_request_id UUID        NOT NULL,   -- minted by the client per tap
  driver_user_id    UUID        NOT NULL,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method            TEXT        NOT NULL,
  payload_hash      TEXT        NOT NULL,   -- detects a replay with changed content
  result            JSONB       NOT NULL,   -- the exact response first returned
  created_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- Retrying the same tap cannot duplicate the money.
  CONSTRAINT driver_collection_events_idem UNIQUE (tenant_id, order_id, client_request_id)
);

-- ── Append-only audit, including refusals.
CREATE TABLE IF NOT EXISTS public.driver_collection_audit (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      TEXT        NOT NULL,
  order_id       TEXT,
  actor_user_id  UUID,
  amount         NUMERIC(12,2),
  method         TEXT,
  outcome        TEXT        NOT NULL,      -- 'recorded' | 'replayed' | refusal reason
  detail         JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- ── No client role touches either table directly. RLS on with NO policies
--    denies everything; the SECURITY DEFINER function is the only writer.
ALTER TABLE public.driver_collection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_collection_audit  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_collection_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.driver_collection_audit  FROM PUBLIC, anon, authenticated;

-- ── The contract.
--    Returns JSONB, never raises for an expected refusal (O1), so the refusal
--    audit row commits with the request. Clients MUST check success === true;
--    HTTP success is never application success.
CREATE OR REPLACE FUNCTION public.driver_record_collection(
  p_order_id          TEXT,
  p_client_request_id UUID,
  p_collected_amount  NUMERIC,
  p_method            TEXT,
  p_box_sub_id        TEXT DEFAULT NULL,
  p_note              TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_tenant_id    TEXT;
  v_role         TEXT;
  v_display_name TEXT;
  v_metadata     JSONB := '{}'::JSONB;
  v_origin_cap   BOOLEAN := FALSE;
  v_data         JSONB;
  v_payment      JSONB := '{}'::JSONB;
  v_paid         NUMERIC := 0;
  v_amount       NUMERIC;
  v_method       TEXT := NULLIF(BTRIM(LOWER(COALESCE(p_method, ''))), '');
  v_cap_text     TEXT;
  v_cap          NUMERIC;
  v_hash         TEXT;
  v_existing     public.driver_collection_events;
  v_result       JSONB;
  v_now          TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- Every refusal below uses a stable, non-disclosing code and writes its own
  -- audit row inline (plpgsql has no nested function declarations).
  -- Requires pgcrypto for digest()/gen_random_uuid() — list_extensions must be
  -- checked before this is built, not assumed.
  IF v_uid IS NULL THEN
    RETURN JSONB_BUILD_OBJECT('success', FALSE, 'changed', FALSE, 'reason', 'collection_denied');
  END IF;

  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN JSONB_BUILD_OBJECT('success', FALSE, 'changed', FALSE, 'reason', 'collection_denied');
  END IF;

  -- Same membership and role test as driver_update_order_status. No new role,
  -- no global role, no implicit service-role elevation.
  SELECT COALESCE(m.app_role, m.role), m.display_name, COALESCE(m.metadata, '{}'::JSONB)
    INTO v_role, v_display_name, v_metadata
  FROM public.members m
  WHERE m.user_id = v_uid
    AND m.tenant_id = v_tenant_id
    AND m.active = TRUE
  ORDER BY m.created_at
  LIMIT 1;

  IF NOT FOUND OR v_role IS DISTINCT FROM 'driver' THEN
    INSERT INTO public.driver_collection_audit (tenant_id, order_id, actor_user_id, amount, method, outcome)
    VALUES (v_tenant_id, p_order_id, v_uid, p_collected_amount, v_method, 'not_driver');
    RETURN JSONB_BUILD_OBJECT('success', FALSE, 'changed', FALSE, 'reason', 'collection_denied');
  END IF;

  v_origin_cap := CASE
    WHEN v_metadata ? 'capabilities' THEN
      COALESCE(v_metadata->'capabilities' ? 'origin_pickup', FALSE)
      OR COALESCE(v_metadata->'capabilities' ? 'origin_dropoff', FALSE)
    ELSE TRUE   -- same production fallback as the status RPC
  END;

  IF p_client_request_id IS NULL THEN
    RETURN JSONB_BUILD_OBJECT('success', FALSE, 'changed', FALSE, 'reason', 'request_id_required');
  END IF;

  -- Amount validation. Non-numeric, zero, negative and >2dp are refused.
  v_amount := ROUND(p_collected_amount, 2);
  IF p_collected_amount IS NULL OR v_amount <= 0 OR v_amount <> p_collected_amount THEN
    INSERT INTO public.driver_collection_audit (tenant_id, order_id, actor_user_id, amount, method, outcome)
    VALUES (v_tenant_id, p_order_id, v_uid, p_collected_amount, v_method, 'amount_invalid');
    RETURN JSONB_BUILD_OBJECT('success', FALSE, 'changed', FALSE, 'reason', 'amount_invalid');
  END IF;

  -- OPEN-D4: ceiling comes from configuration and FAILS CLOSED when absent or
  -- malformed, mirroring depositAmount handling in the status RPC. No literal
  -- limit is invented in this file.
  SELECT NULLIF(BTRIM(ts.data->>'driverCollectionMax'), '')
    INTO v_cap_text
  FROM public.tenant_settings ts
  WHERE ts.tenant_id = v_tenant_id AND ts.config_key = 'main'
  LIMIT 1;

  IF v_cap_text IS NULL OR v_cap_text !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
    INSERT INTO public.driver_collection_audit (tenant_id, order_id, actor_user_id, amount, method, outcome)
    VALUES (v_tenant_id, p_order_id, v_uid, v_amount, v_method, 'collection_config_invalid');
    RETURN JSONB_BUILD_OBJECT('success', FALSE, 'changed', FALSE, 'reason', 'collection_config_invalid');
  END IF;
  v_cap := v_cap_text::NUMERIC;
  IF v_amount > v_cap THEN
    INSERT INTO public.driver_collection_audit (tenant_id, order_id, actor_user_id, amount, method, outcome)
    VALUES (v_tenant_id, p_order_id, v_uid, v_amount, v_method, 'amount_over_cap');
    RETURN JSONB_BUILD_OBJECT('success', FALSE, 'changed', FALSE, 'reason', 'amount_over_cap');
  END IF;

  -- OPEN-D5: method allow-list is owner-defined. Left as a config lookup in the
  -- built version rather than a hardcoded list here.

  -- The tenant predicate makes cross-tenant and nonexistent ids
  -- indistinguishable. The row lock serialises concurrent taps.
  SELECT COALESCE(o.data, '{}'::JSONB)
    INTO v_data
  FROM public.orders o
  WHERE o.id = p_order_id
    AND o.tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.driver_collection_audit (tenant_id, order_id, actor_user_id, amount, method, outcome)
    VALUES (v_tenant_id, p_order_id, v_uid, v_amount, v_method, 'order_not_found');
    RETURN JSONB_BUILD_OBJECT('success', FALSE, 'changed', FALSE, 'reason', 'collection_denied');
  END IF;

  -- Origin-lane assignment, identical to the status RPC's origin test.
  IF NOT (v_origin_cap AND COALESCE(v_data->>'assignedDriverUserId', '') = v_uid::TEXT) THEN
    INSERT INTO public.driver_collection_audit (tenant_id, order_id, actor_user_id, amount, method, outcome)
    VALUES (v_tenant_id, p_order_id, v_uid, v_amount, v_method, 'not_assigned');
    RETURN JSONB_BUILD_OBJECT('success', FALSE, 'changed', FALSE, 'reason', 'collection_denied');
  END IF;

  -- Idempotency. Same request id + same content -> return the stored result and
  -- write nothing. Same request id + different content -> conflict, never a
  -- silent change.
  v_hash := ENCODE(public.digest(
    COALESCE(p_order_id, '') || '|' || COALESCE(p_box_sub_id, '') || '|' ||
    v_amount::TEXT || '|' || COALESCE(v_method, '') || '|' || COALESCE(p_note, ''),
    'sha256'), 'hex');

  SELECT * INTO v_existing
  FROM public.driver_collection_events e
  WHERE e.tenant_id = v_tenant_id
    AND e.order_id = p_order_id
    AND e.client_request_id = p_client_request_id;

  IF FOUND THEN
    IF v_existing.payload_hash IS DISTINCT FROM v_hash THEN
      INSERT INTO public.driver_collection_audit (tenant_id, order_id, actor_user_id, amount, method, outcome)
      VALUES (v_tenant_id, p_order_id, v_uid, v_amount, v_method, 'request_id_conflict');
      RETURN JSONB_BUILD_OBJECT('success', FALSE, 'changed', FALSE, 'reason', 'request_id_conflict');
    END IF;
    INSERT INTO public.driver_collection_audit (tenant_id, order_id, actor_user_id, amount, method, outcome)
    VALUES (v_tenant_id, p_order_id, v_uid, v_amount, v_method, 'replayed');
    RETURN v_existing.result || JSONB_BUILD_OBJECT('changed', FALSE, 'replayed', TRUE);
  END IF;

  -- Accept. Numbers only: payment.paid is incremented exactly as the existing
  -- deposit credit in driver_update_order_status does. payment.status is NOT
  -- written (OPEN-D2), so a reader derives the balance arithmetically instead of
  -- trusting a label.
  v_payment := CASE WHEN JSONB_TYPEOF(v_data->'payment') = 'object' THEN v_data->'payment' ELSE '{}'::JSONB END;
  IF COALESCE(v_payment->>'paid', '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN
    v_paid := (v_payment->>'paid')::NUMERIC;
  END IF;

  -- OPEN-D3: over-collection is not decided, so the built version must branch
  -- here on the owner's answer instead of silently accepting.

  v_payment := JSONB_SET(v_payment, '{paid}', TO_JSONB(ROUND(v_paid + v_amount, 2)), TRUE);
  v_payment := JSONB_SET(v_payment, '{method}', TO_JSONB(v_method), TRUE);
  v_data := JSONB_SET(v_data, '{payment}', v_payment, TRUE);
  v_data := JSONB_SET(v_data, '{history}',
    CASE WHEN JSONB_TYPEOF(v_data->'history') = 'array' THEN v_data->'history' ELSE '[]'::JSONB END
    || JSONB_BUILD_ARRAY(JSONB_STRIP_NULLS(JSONB_BUILD_OBJECT(
         'kind', 'collection', 'amount', v_amount, 'method', v_method,
         'ts', v_now, 'by', 'driver', 'byUserId', v_uid, 'byName', v_display_name,
         'subId', p_box_sub_id, 'note', p_note))), TRUE);

  UPDATE public.orders
  SET data = v_data, updated_at = v_now
  WHERE id = p_order_id AND tenant_id = v_tenant_id;

  v_result := JSONB_BUILD_OBJECT(
    'success', TRUE, 'changed', TRUE,
    'order_id', p_order_id, 'amount', v_amount, 'method', v_method,
    'order_data', v_data
  );

  INSERT INTO public.driver_collection_events
    (tenant_id, order_id, box_sub_id, client_request_id, driver_user_id, amount, method, payload_hash, result)
  VALUES
    (v_tenant_id, p_order_id, p_box_sub_id, p_client_request_id, v_uid, v_amount, v_method, v_hash, v_result);

  INSERT INTO public.driver_collection_audit (tenant_id, order_id, actor_user_id, amount, method, outcome)
  VALUES (v_tenant_id, p_order_id, v_uid, v_amount, v_method, 'recorded');

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.driver_record_collection(TEXT, UUID, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.driver_record_collection(TEXT, UUID, NUMERIC, TEXT, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.driver_record_collection(TEXT, UUID, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

ROLLBACK;  -- PROPOSAL: this file ends in ROLLBACK on purpose. It cannot apply.

-- TESTS THIS CONTRACT WOULD NEED (none written, none run):
--   unassigned driver refused; cross-tenant order indistinguishable from absent;
--   non-driver role refused; disabled member refused; missing/invalid cap config
--   fails closed; amount 0 / negative / 3dp refused; concurrent duplicate taps
--   with the same request id -> one row, one credit; same request id with a
--   changed amount -> conflict; distinct request ids -> two credits; refusals
--   visible in the audit; no client role can write either table; orders row
--   untouched on every refusal.
