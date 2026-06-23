-- ════════════════════════════════════════════════════════════════════════════
-- RPC: update_driver_status
-- Project  : Casabe Konnect (exayifxbqduhsxmmsnxr)
-- Author   : Forge (Dev Lead)
-- Date     : 2026-06-10
-- Purpose  : Narrow SECURITY DEFINER function that allows authenticated drivers
--            to advance an order's status along the driver state machine.
--            Replaces the broad _db.upsert("orders", ...) call in index.html
--            driver flow, which would have required a wide UPDATE RLS policy
--            that exposed payment, customer, and assignment fields.
--
-- SECURITY MODEL:
--   SECURITY DEFINER — runs with function owner's rights, not caller's.
--   SET search_path = '' — prevents search_path injection.
--   Caller validation: is_member + get_user_role + can_access_order.
--   Only `data` (status key via jsonb_set) and `updated_at` columns are written.
--
-- JSONB NOTE (2026-06-10 — Jefe flag actioned):
--   `orders.status` is NOT a top-level relational column. Order status lives
--   inside `orders.data->>'status'`. This RPC was patched accordingly:
--     READ:  data->>'status' INTO v_current_status
--     WRITE: jsonb_set(data, '{status}', to_jsonb(p_new_status), false)
--   The `false` argument to jsonb_set means: do NOT create the 'status' key
--   if it is absent — that would indicate a data-integrity issue upstream,
--   not something to silently patch.
--   `updated_at` is assumed to be a real top-level column. Delta must confirm
--   via orders-column-check.sql; if absent, remove that SET line.
--   All other JSONB fields (payment, customer, assignedDriver, etc.) are
--   untouched — jsonb_set replaces only the 'status' key.
--
-- TRANSITION MAP (confirmed from index.html driver UI — 2026-06-10):
--   ready_pickup  → in_warehouse   (PickupListPage: "Picked Up (no receipt)")
--                 → attempted       (PickupListPage: "No Answer")
--   need_box      → box_dropped_off (DropOffListPage: "Box Delivered")
--                 → attempted       (DropOffListPage: "No Answer")
--   attempted     → ready_pickup    (DriverRoutePage: "Reschedule")
--
-- NOTE: in_warehouse and box_dropped_off are terminal states for drivers.
--   No driver UI button advances orders beyond those statuses.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_driver_status(
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
  -- Get caller identity
  v_driver_user_id := auth.uid();

  -- Validate caller is a driver member
  IF NOT public.is_member(
    (SELECT tenant_id FROM public.orders WHERE id = p_order_id LIMIT 1)
  ) THEN
    RAISE EXCEPTION 'unauthorized: not a tenant member';
  END IF;

  IF public.get_user_role() != 'driver' THEN
    RAISE EXCEPTION 'unauthorized: not a driver';
  END IF;

  -- Validate caller is assigned to this order
  IF NOT public.can_access_order(p_order_id) THEN
    RAISE EXCEPTION 'unauthorized: order not assigned to this driver';
  END IF;

  -- Fetch current status (from JSONB path) and tenant
  -- orders.status is stored in data->>'status', NOT as a top-level column.
  -- See: orders-column-check.sql for Delta verification query.
  SELECT data->>'status', tenant_id INTO v_current_status, v_tenant_id
  FROM public.orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_id;
  END IF;

  -- Validate allowed transitions
  -- Confirmed from index.html driver UI (PickupListPage, DropOffListPage, DriverRoutePage):
  --   ready_pickup  → in_warehouse   ("Picked Up (no receipt)", QR scan, Route "Dropped Off")
  --   ready_pickup  → attempted       ("No Answer")
  --   need_box      → box_dropped_off ("Box Delivered")
  --   need_box      → attempted       ("No Answer")
  --   attempted     → ready_pickup    ("Reschedule")
  IF NOT (
    (v_current_status = 'ready_pickup'  AND p_new_status IN ('in_warehouse', 'attempted')) OR
    (v_current_status = 'need_box'      AND p_new_status IN ('box_dropped_off', 'attempted')) OR
    (v_current_status = 'attempted'     AND p_new_status = 'ready_pickup')
  ) THEN
    RAISE EXCEPTION 'invalid transition: % -> %', v_current_status, p_new_status;
  END IF;

  -- Apply narrow update — write status into JSONB data column only.
  -- jsonb_set(data, '{status}', to_jsonb(p_new_status), false):
  --   - Replaces data.status with p_new_status.
  --   - `false` = do NOT create the key if absent (data integrity guard).
  --   - All other JSONB fields (payment, customer, assignedDriver, etc.) preserved.
  -- updated_at: top-level column assumed present. Delta must confirm via
  --   orders-column-check.sql. If absent, remove the updated_at line.
  UPDATE public.orders
  SET data       = jsonb_set(data, '{status}', to_jsonb(p_new_status), false),
      updated_at = NOW()
  WHERE id = p_order_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'success',    true,
    'order_id',   p_order_id,
    'new_status', p_new_status
  );
END;
$$;

-- Grant execution to authenticated users (role check enforced inside the function)
GRANT EXECUTE ON FUNCTION public.update_driver_status(TEXT, TEXT) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- Run if this RPC needs to be removed:
--   DROP FUNCTION IF EXISTS public.update_driver_status(TEXT, TEXT);
