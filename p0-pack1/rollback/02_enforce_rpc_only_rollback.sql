-- P0 Pack 1 final-stage emergency rollback.
-- CRITICAL ORDER:
--   1. Restore the prior frontend that calls update_driver_status.
--   2. Confirm the prior frontend is live.
--   3. Run this SQL.
--
-- This intentionally restores the broad policy and legacy RPC exactly as they
-- existed before Pack 1. It reopens the P0 field-overwrite exposure and is only
-- an emergency bridge while the prior frontend is active.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_driver_status(
  p_order_id TEXT,
  p_new_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_status TEXT;
  v_driver_user_id UUID;
  v_tenant_id TEXT;
BEGIN
  v_driver_user_id := auth.uid();

  IF NOT public.is_member(
    (SELECT tenant_id FROM public.orders WHERE id = p_order_id LIMIT 1)
  ) THEN
    RAISE EXCEPTION 'unauthorized: not a tenant member';
  END IF;

  IF public.get_user_role() != 'driver' THEN
    RAISE EXCEPTION 'unauthorized: not a driver';
  END IF;

  IF NOT public.can_access_order(p_order_id) THEN
    RAISE EXCEPTION 'unauthorized: order not assigned to this driver';
  END IF;

  SELECT data->>'status', tenant_id INTO v_current_status, v_tenant_id
  FROM public.orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_id;
  END IF;

  IF NOT (
    (v_current_status = 'ready_pickup' AND p_new_status IN ('in_warehouse', 'attempted')) OR
    (v_current_status = 'need_box' AND p_new_status IN ('box_dropped_off', 'attempted')) OR
    (v_current_status = 'attempted' AND p_new_status = 'ready_pickup')
  ) THEN
    RAISE EXCEPTION 'invalid transition: % -> %', v_current_status, p_new_status;
  END IF;

  UPDATE public.orders
  SET data = jsonb_set(data, '{status}', to_jsonb(p_new_status), false),
      updated_at = NOW()
  WHERE id = p_order_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'new_status', p_new_status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_driver_status(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_driver_status(TEXT, TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS orders_driver_update_assigned ON public.orders;
CREATE POLICY orders_driver_update_assigned ON public.orders
  FOR UPDATE
  USING (
    is_member(tenant_id)
    AND (
      (
        data->>'assignedDriverUserId' = auth.uid()::TEXT
        AND (has_capability('origin_pickup') OR has_capability('origin_dropoff'))
      )
      OR
      (
        data->>'assignedDeliveryDriverUserId' = auth.uid()::TEXT
        AND has_capability('destination_delivery')
      )
    )
  )
  WITH CHECK (
    is_member(tenant_id)
    AND (
      (
        data->>'assignedDriverUserId' = auth.uid()::TEXT
        AND (has_capability('origin_pickup') OR has_capability('origin_dropoff'))
      )
      OR
      (
        data->>'assignedDeliveryDriverUserId' = auth.uid()::TEXT
        AND has_capability('destination_delivery')
      )
    )
  );

COMMIT;

SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'orders'
  AND policyname = 'orders_driver_update_assigned';

SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'update_driver_status';
