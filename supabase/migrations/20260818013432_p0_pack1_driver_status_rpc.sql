-- P0 Pack 1, stage 1: transactional driver status RPC.
-- FILE-ONLY DRAFT. Do not apply until exact-diff review and N1-N14 QA pass.
--
-- Product decisions:
--   * p_box_sub_id present: update one scanned box (Scan Mode).
--   * p_box_sub_id absent: update every box on the order-level stop
--     (Delivery Queue and legacy order-level driver actions).
--   * A legacy order without depositAmountSnapshot snapshots the current
--     tenant depositAmount at first credit. It must be numeric and within
--     0..500 inclusive; missing/invalid configuration fails closed.
--   * Deposits are order-level in the current pricing model. The first changed
--     child reaching in_warehouse returns the one order deposit, even if the
--     parent remains mixed until sibling boxes arrive.
--
-- Rollback: p0-pack1/rollback/01_driver_status_rpc_rollback.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.driver_update_order_status(
  p_order_id TEXT,
  p_new_status TEXT,
  p_box_sub_id TEXT DEFAULT NULL,
  p_reason_code TEXT DEFAULT NULL,
  p_reason_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant_id TEXT;
  v_role TEXT;
  v_display_name TEXT;
  v_metadata JSONB := '{}'::JSONB;
  v_explicit_caps BOOLEAN := FALSE;
  v_origin_cap BOOLEAN := FALSE;
  v_destination_cap BOOLEAN := FALSE;
  v_origin_authorized BOOLEAN := FALSE;
  v_destination_authorized BOOLEAN := FALSE;
  v_attempt_lane_ok BOOLEAN := FALSE;
  v_target_current_status TEXT;
  v_lane TEXT;
  v_allowed_from TEXT[];
  v_transition_ok BOOLEAN := FALSE;
  v_data JSONB;
  v_current_status TEXT;
  v_parent_status TEXT;
  v_boxes JSONB := '[]'::JSONB;
  v_new_boxes JSONB := '[]'::JSONB;
  v_box_sub_id TEXT := NULLIF(BTRIM(COALESCE(p_box_sub_id, '')), '');
  v_reason_code TEXT := NULLIF(BTRIM(LOWER(COALESCE(p_reason_code, ''))), '');
  v_reason_note TEXT := NULLIF(BTRIM(COALESCE(p_reason_note, '')), '');
  v_reason_text TEXT := '';
  v_changed BOOLEAN := FALSE;
  v_target_found BOOLEAN := FALSE;
  v_distinct_statuses INTEGER := 0;
  v_single_status TEXT;
  v_history JSONB := '[]'::JSONB;
  v_history_entry JSONB;
  v_payment JSONB := '{}'::JSONB;
  v_paid NUMERIC := 0;
  v_deposit_amount NUMERIC := 0;
  v_deposit_text TEXT;
  v_deposit_credit NUMERIC := 0;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'driver_status_denied';
  END IF;

  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'driver_status_denied';
  END IF;

  SELECT COALESCE(m.app_role, m.role), m.display_name, COALESCE(m.metadata, '{}'::JSONB)
    INTO v_role, v_display_name, v_metadata
  FROM public.members m
  WHERE m.user_id = v_uid
    AND m.tenant_id = v_tenant_id
    AND m.active = TRUE
  ORDER BY m.created_at
  LIMIT 1;

  IF NOT FOUND OR v_role IS DISTINCT FROM 'driver' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'driver_status_denied';
  END IF;

  v_explicit_caps := v_metadata ? 'capabilities';
  IF v_explicit_caps THEN
    v_origin_cap := COALESCE(v_metadata->'capabilities' ? 'origin_pickup', FALSE)
                 OR COALESCE(v_metadata->'capabilities' ? 'origin_dropoff', FALSE);
    v_destination_cap := COALESCE(v_metadata->'capabilities' ? 'destination_delivery', FALSE);
  ELSE
    -- Production fallback table: a plain driver is origin-capable only.
    v_origin_cap := TRUE;
    v_destination_cap := FALSE;
  END IF;

  IF p_new_status = 'attempted' THEN
    -- "No answer" exists on both origin pickup/drop-off surfaces and the
    -- destination Delivery Queue. Authorization still requires assignment
    -- in at least one capability-matching lane.
    v_lane := 'either';
    v_allowed_from := ARRAY['need_box', 'ready_pickup', 'out_for_delivery'];
  ELSIF p_new_status = ANY (ARRAY['box_dropped_off', 'need_box', 'picked_up', 'in_warehouse']) THEN
    v_lane := 'origin';
    v_allowed_from := CASE p_new_status
      WHEN 'box_dropped_off' THEN ARRAY['need_box', 'attempted']
      WHEN 'need_box' THEN ARRAY['order_placed', 'attempted']
      WHEN 'picked_up' THEN ARRAY['ready_pickup', 'attempted']
      WHEN 'in_warehouse' THEN ARRAY['picked_up', 'ready_pickup']
    END;
  ELSIF p_new_status = ANY (ARRAY['out_for_delivery', 'delivered', 'rerouted']) THEN
    v_lane := 'destination';
    v_allowed_from := CASE p_new_status
      WHEN 'out_for_delivery' THEN ARRAY['sorting', 'customs_released', 'in_warehouse', 'attempted', 'rerouted']
      WHEN 'delivered' THEN ARRAY['out_for_delivery']
      WHEN 'rerouted' THEN ARRAY['out_for_delivery']
    END;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'driver_status_invalid';
  END IF;

  -- The tenant predicate intentionally makes cross-tenant and nonexistent IDs
  -- indistinguishable. The row lock serializes duplicate scans and deposit credit.
  SELECT COALESCE(o.data, '{}'::JSONB)
    INTO v_data
  FROM public.orders o
  WHERE o.id = p_order_id
    AND o.tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'driver_status_denied';
  END IF;

  v_origin_authorized := v_origin_cap
    AND COALESCE(v_data->>'assignedDriverUserId', '') = v_uid::TEXT;
  v_destination_authorized := v_destination_cap
    AND COALESCE(v_data->>'assignedDeliveryDriverUserId', '') = v_uid::TEXT;

  IF v_lane = 'origin' THEN
    IF NOT v_origin_authorized THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'driver_status_denied';
    END IF;
  ELSIF v_lane = 'destination' THEN
    IF NOT v_destination_authorized THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'driver_status_denied';
    END IF;
  ELSE
    IF NOT (v_origin_authorized OR v_destination_authorized) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'driver_status_denied';
    END IF;
  END IF;

  IF LENGTH(COALESCE(v_reason_note, '')) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'driver_status_reason_invalid';
  END IF;

  IF p_new_status = 'attempted' THEN
    IF v_reason_code IS NULL OR v_reason_code <> ALL (ARRAY[
      'no_answer', 'customer_not_home', 'bad_address_access',
      'customer_reschedule', 'other'
    ]) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'driver_status_reason_invalid';
    END IF;
    IF v_reason_code = 'other' AND v_reason_note IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'driver_status_reason_invalid';
    END IF;
    v_reason_text := CASE v_reason_code
      WHEN 'no_answer' THEN 'No answer'
      WHEN 'customer_not_home' THEN 'Customer not home'
      WHEN 'bad_address_access' THEN 'Bad address/access issue'
      WHEN 'customer_reschedule' THEN 'Customer requested reschedule'
      WHEN 'other' THEN v_reason_note
    END;
    IF v_reason_code <> 'other' AND v_reason_note IS NOT NULL THEN
      v_reason_text := v_reason_text || ' · ' || v_reason_note;
    END IF;
  ELSIF p_new_status = 'rerouted' THEN
    IF v_reason_code IS DISTINCT FROM 'rerouted' OR v_reason_note IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'driver_status_reason_invalid';
    END IF;
    v_reason_text := v_reason_note;
  ELSIF v_reason_code IS NOT NULL OR v_reason_note IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'driver_status_reason_invalid';
  END IF;

  v_current_status := COALESCE(v_data->>'status', '');
  v_boxes := CASE
    WHEN JSONB_TYPEOF(v_data->'boxes') = 'array' THEN v_data->'boxes'
    ELSE '[]'::JSONB
  END;

  -- attempted is available in both workflows, but the current phase decides
  -- which assignment lane authorizes it. An origin assignment cannot authorize
  -- an out_for_delivery attempt, and a destination assignment cannot authorize
  -- a need_box/ready_pickup attempt. For an order-level action every child must
  -- satisfy its own lane; a repeat attempted no-op accepts either assigned lane.
  IF p_new_status = 'attempted' THEN
    IF JSONB_ARRAY_LENGTH(v_boxes) = 0 THEN
      v_attempt_lane_ok := CASE
        WHEN v_current_status IN ('need_box', 'ready_pickup') THEN v_origin_authorized
        WHEN v_current_status = 'out_for_delivery' THEN v_destination_authorized
        WHEN v_current_status = 'attempted' THEN v_origin_authorized OR v_destination_authorized
        ELSE TRUE
      END;
    ELSIF v_box_sub_id IS NULL THEN
      SELECT COALESCE(BOOL_AND(CASE
               WHEN COALESCE(e.box->>'orderStatus', e.box->>'status', '') IN ('need_box', 'ready_pickup')
                 THEN v_origin_authorized
               WHEN COALESCE(e.box->>'orderStatus', e.box->>'status', '') = 'out_for_delivery'
                 THEN v_destination_authorized
               WHEN COALESCE(e.box->>'orderStatus', e.box->>'status', '') = 'attempted'
                 THEN v_origin_authorized OR v_destination_authorized
               ELSE TRUE
             END), FALSE)
        INTO v_attempt_lane_ok
      FROM JSONB_ARRAY_ELEMENTS(v_boxes) AS e(box);
    ELSE
      SELECT COALESCE(e.box->>'orderStatus', e.box->>'status', '')
        INTO v_target_current_status
      FROM JSONB_ARRAY_ELEMENTS(v_boxes) AS e(box)
      WHERE e.box->>'subId' = v_box_sub_id
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'driver_status_box_invalid';
      END IF;
      v_attempt_lane_ok := CASE
        WHEN v_target_current_status IN ('need_box', 'ready_pickup') THEN v_origin_authorized
        WHEN v_target_current_status = 'out_for_delivery' THEN v_destination_authorized
        WHEN v_target_current_status = 'attempted' THEN v_origin_authorized OR v_destination_authorized
        ELSE TRUE
      END;
    END IF;

    IF NOT COALESCE(v_attempt_lane_ok, FALSE) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'driver_status_denied';
    END IF;
  END IF;

  IF JSONB_ARRAY_LENGTH(v_boxes) = 0 THEN
    IF v_box_sub_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'driver_status_box_invalid';
    END IF;
    v_transition_ok := v_current_status = p_new_status OR v_current_status = ANY (v_allowed_from);
    IF NOT v_transition_ok THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'driver_status_transition_invalid';
    END IF;
    v_changed := v_current_status IS DISTINCT FROM p_new_status;
    v_parent_status := p_new_status;
    v_new_boxes := v_boxes;
  ELSIF v_box_sub_id IS NULL THEN
    -- Order-level stop: all boxes move together.
    SELECT COALESCE(BOOL_AND(
             COALESCE(e.box->>'orderStatus', e.box->>'status', '') = p_new_status
             OR COALESCE(e.box->>'orderStatus', e.box->>'status', '') = ANY (v_allowed_from)
           ), FALSE),
           COALESCE(BOOL_OR(COALESCE(e.box->>'orderStatus', e.box->>'status', '') IS DISTINCT FROM p_new_status), FALSE)
             OR v_current_status IS DISTINCT FROM p_new_status,
           JSONB_AGG(
             e.box || JSONB_BUILD_OBJECT(
               'orderStatus', p_new_status,
               'status', p_new_status,
               'statusUpdatedAt', v_now,
               'statusUpdatedBy', COALESCE(v_display_name, v_uid::TEXT)
             ) ORDER BY e.ord
           )
      INTO v_transition_ok, v_changed, v_new_boxes
    FROM JSONB_ARRAY_ELEMENTS(v_boxes) WITH ORDINALITY AS e(box, ord);
    IF NOT v_transition_ok THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'driver_status_transition_invalid';
    END IF;
    v_parent_status := p_new_status;
  ELSE
    -- Scan Mode: only the scanned child changes.
    SELECT COALESCE(BOOL_OR(e.box->>'subId' = v_box_sub_id), FALSE),
           COALESCE(BOOL_AND(
             CASE WHEN e.box->>'subId' = v_box_sub_id THEN
               COALESCE(e.box->>'orderStatus', e.box->>'status', '') = p_new_status
               OR COALESCE(e.box->>'orderStatus', e.box->>'status', '') = ANY (v_allowed_from)
             ELSE TRUE END
           ), FALSE),
           COALESCE(BOOL_OR(
             e.box->>'subId' = v_box_sub_id
             AND COALESCE(e.box->>'orderStatus', e.box->>'status', '') IS DISTINCT FROM p_new_status
           ), FALSE),
           JSONB_AGG(
             CASE WHEN e.box->>'subId' = v_box_sub_id THEN
               e.box || JSONB_BUILD_OBJECT(
                 'orderStatus', p_new_status,
                 'status', p_new_status,
                 'statusUpdatedAt', v_now,
                 'statusUpdatedBy', COALESCE(v_display_name, v_uid::TEXT)
               )
             ELSE e.box END ORDER BY e.ord
           )
      INTO v_target_found, v_transition_ok, v_changed, v_new_boxes
    FROM JSONB_ARRAY_ELEMENTS(v_boxes) WITH ORDINALITY AS e(box, ord);

    IF NOT v_target_found THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'driver_status_box_invalid';
    END IF;
    IF NOT v_transition_ok THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'driver_status_transition_invalid';
    END IF;

    SELECT COUNT(DISTINCT COALESCE(e.box->>'orderStatus', e.box->>'status', '')),
           MIN(COALESCE(e.box->>'orderStatus', e.box->>'status', ''))
      INTO v_distinct_statuses, v_single_status
    FROM JSONB_ARRAY_ELEMENTS(v_new_boxes) AS e(box);
    v_parent_status := CASE WHEN v_distinct_statuses = 1 THEN v_single_status ELSE 'mixed' END;
  END IF;

  IF NOT v_changed THEN
    RETURN JSONB_BUILD_OBJECT(
      'success', TRUE,
      'changed', FALSE,
      'order_id', p_order_id,
      'new_status', p_new_status,
      'parent_status', v_current_status,
      'box_sub_id', v_box_sub_id,
      'deposit_credited_amount', 0,
      'order_data', v_data
    );
  END IF;

  v_data := JSONB_SET(v_data, '{status}', TO_JSONB(v_parent_status), TRUE);
  IF JSONB_ARRAY_LENGTH(v_boxes) > 0 THEN
    v_data := JSONB_SET(v_data, '{boxes}', v_new_boxes, TRUE);
  END IF;

  v_history := CASE
    WHEN JSONB_TYPEOF(v_data->'history') = 'array' THEN v_data->'history'
    ELSE '[]'::JSONB
  END;
  v_history_entry := JSONB_STRIP_NULLS(JSONB_BUILD_OBJECT(
    'status', p_new_status,
    'parentStatus', v_parent_status,
    'ts', v_now,
    'note', v_reason_text,
    'reasonCode', v_reason_code,
    'reasonNote', v_reason_note,
    'by', 'driver',
    'byUserId', v_uid,
    'byName', v_display_name,
    'subId', v_box_sub_id,
    'backward', CASE WHEN p_new_status IN ('attempted', 'rerouted') THEN TRUE ELSE NULL END
  ));
  v_data := JSONB_SET(v_data, '{history}', v_history || JSONB_BUILD_ARRAY(v_history_entry), TRUE);

  IF p_new_status = 'in_warehouse'
     AND LOWER(COALESCE(v_data->>'boxDeposit', 'false')) = 'true'
     AND LOWER(COALESCE(v_data->>'depositCredited', 'false')) <> 'true' THEN
    v_deposit_text := NULLIF(BTRIM(v_data->>'depositAmountSnapshot'), '');

    IF v_deposit_text IS NULL THEN
      SELECT NULLIF(BTRIM(ts.data->>'depositAmount'), '')
        INTO v_deposit_text
      FROM public.tenant_settings ts
      WHERE ts.tenant_id = v_tenant_id
        AND ts.config_key = 'main'
      LIMIT 1;
    END IF;

    IF v_deposit_text IS NULL OR v_deposit_text !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'driver_status_deposit_config_invalid';
    END IF;
    v_deposit_amount := v_deposit_text::NUMERIC;
    IF v_deposit_amount < 0 OR v_deposit_amount > 500 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'driver_status_deposit_config_invalid';
    END IF;

    v_payment := CASE
      WHEN JSONB_TYPEOF(v_data->'payment') = 'object' THEN v_data->'payment'
      ELSE '{}'::JSONB
    END;
    IF COALESCE(v_payment->>'paid', '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN
      v_paid := (v_payment->>'paid')::NUMERIC;
    END IF;
    v_payment := JSONB_SET(v_payment, '{paid}', TO_JSONB(ROUND(v_paid + v_deposit_amount, 2)), TRUE);
    v_data := JSONB_SET(v_data, '{payment}', v_payment, TRUE);
    v_data := JSONB_SET(v_data, '{depositAmountSnapshot}', TO_JSONB(v_deposit_amount), TRUE);
    v_data := JSONB_SET(v_data, '{depositCredited}', 'true'::JSONB, TRUE);
    v_deposit_credit := v_deposit_amount;
  END IF;

  UPDATE public.orders
  SET data = v_data,
      updated_at = v_now
  WHERE id = p_order_id
    AND tenant_id = v_tenant_id;

  RETURN JSONB_BUILD_OBJECT(
    'success', TRUE,
    'changed', TRUE,
    'order_id', p_order_id,
    'new_status', p_new_status,
    'parent_status', v_parent_status,
    'box_sub_id', v_box_sub_id,
    'deposit_credited_amount', v_deposit_credit,
    'order_data', v_data
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.driver_update_order_status(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.driver_update_order_status(TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.driver_update_order_status(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'driver_update_order_status'
      AND pg_get_function_identity_arguments(p.oid) =
          'p_order_id text, p_new_status text, p_box_sub_id text, p_reason_code text, p_reason_note text'
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'P0 Pack 1: driver_update_order_status signature/security mismatch';
  END IF;

  IF has_function_privilege('anon', 'public.driver_update_order_status(text,text,text,text,text)', 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       WHERE n.nspname = 'public'
         AND p.proname = 'driver_update_order_status'
         AND pg_get_function_identity_arguments(p.oid) =
             'p_order_id text, p_new_status text, p_box_sub_id text, p_reason_code text, p_reason_note text'
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR NOT has_function_privilege('authenticated', 'public.driver_update_order_status(text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'P0 Pack 1: driver_update_order_status ACL mismatch';
  END IF;
END;
$$;

COMMIT;

-- Post-commit proof (expect one row: SECURITY DEFINER, anon=false,
-- authenticated=true, public=false).
SELECT p.proname,
       p.prosecdef,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       EXISTS (
         SELECT 1
         FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
         WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
       ) AS public_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'driver_update_order_status';
