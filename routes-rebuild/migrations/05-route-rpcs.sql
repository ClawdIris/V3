-- ============================================================================
-- Migration 05 — narrow route RPCs (confirm_order_address, assign_order_to_route)
-- Routes Rebuild · Phase 3 / Slice 1
-- ----------------------------------------------------------------------------
-- WHY: The geocode-address and assign-route Edge Functions call these RPCs.
--      Both are SECURITY DEFINER + narrow (write only geocoding/route fields) so
--      the driver UPDATE policy never needs widening. Cross-tenant guard is
--      manual because SECURITY DEFINER bypasses RLS.
--
-- DEPENDS ON: migration 04 (geocoding + route columns must exist first).
--
-- FIX vs plan draft (Section 3.5): the plan called get_user_office_id() (singular)
-- which DOES NOT EXIST in this DB. Live catalog only has get_user_office_ids()
-- returning uuid[]. Corrected here to office_id = ANY(public.get_user_office_ids()).
-- ============================================================================
BEGIN;

-- ── confirm_order_address: HQ/Office writes geocoding fields after gate ──────
CREATE OR REPLACE FUNCTION public.confirm_order_address(
  p_order_id    TEXT,
  p_address     TEXT,
  p_lat         DECIMAL,
  p_lng         DECIMAL,
  p_confidence  TEXT          -- 'high' | 'low' | 'unresolvable'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id     TEXT;
  v_role          TEXT;
  v_caller_tenant TEXT;
BEGIN
  v_role := public.get_user_role();
  IF v_role NOT IN ('hq', 'admin', 'office') THEN
    RAISE EXCEPTION 'unauthorized: only hq/office may confirm addresses';
  END IF;

  IF p_confidence NOT IN ('high', 'low', 'unresolvable') THEN
    RAISE EXCEPTION 'invalid confidence value: %', p_confidence;
  END IF;

  SELECT tenant_id INTO v_tenant_id
  FROM public.orders WHERE id = p_order_id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_id;
  END IF;

  -- Cross-tenant guard (SECURITY DEFINER bypasses RLS — enforce manually).
  SELECT tenant_id INTO v_caller_tenant
  FROM public.members WHERE user_id = auth.uid() LIMIT 1;
  IF v_caller_tenant IS DISTINCT FROM v_tenant_id THEN
    RAISE EXCEPTION 'unauthorized: order belongs to a different tenant';
  END IF;

  UPDATE public.orders
  SET delivery_address     = p_address,
      geocoded_lat         = p_lat,
      geocoded_lng         = p_lng,
      address_confidence   = p_confidence,
      address_confirmed_at = NOW(),
      address_confirmed_by = auth.uid(),
      updated_at           = NOW()
  WHERE id = p_order_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'confidence', p_confidence);
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_order_address(TEXT, TEXT, DECIMAL, DECIMAL, TEXT)
  TO authenticated;

-- ── assign_order_to_route: HQ/Office assigns an order to a route + sequence ──
CREATE OR REPLACE FUNCTION public.assign_order_to_route(
  p_order_id        TEXT,
  p_route_id        UUID,
  p_route_sequence  SMALLINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id     TEXT;
  v_role          TEXT;
  v_caller_tenant TEXT;
BEGIN
  v_role := public.get_user_role();
  IF v_role NOT IN ('hq', 'admin', 'office') THEN
    RAISE EXCEPTION 'unauthorized: only hq/office may assign routes';
  END IF;

  SELECT tenant_id INTO v_tenant_id
  FROM public.orders WHERE id = p_order_id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_id;
  END IF;

  -- Cross-tenant guard (must precede any UPDATE).
  SELECT tenant_id INTO v_caller_tenant
  FROM public.members WHERE user_id = auth.uid() LIMIT 1;
  IF v_caller_tenant IS DISTINCT FROM v_tenant_id THEN
    RAISE EXCEPTION 'unauthorized: caller is not a member of this tenant';
  END IF;

  -- Office caller: the target route must belong to one of the caller's offices.
  -- FIX: get_user_office_ids() (plural, uuid[]) — singular form does not exist.
  IF v_role = 'office' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.routes
      WHERE id = p_route_id
        AND office_id = ANY(public.get_user_office_ids())
    ) THEN
      RAISE EXCEPTION 'unauthorized: office user cannot assign to this route';
    END IF;
  END IF;

  -- Route must belong to the same tenant as the order (defense in depth).
  IF NOT EXISTS (
    SELECT 1 FROM public.routes WHERE id = p_route_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'route % does not belong to order tenant', p_route_id;
  END IF;

  UPDATE public.orders
  SET route_id       = p_route_id,
      route_sequence = p_route_sequence,
      updated_at     = NOW()
  WHERE id = p_order_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id,
                            'route_id', p_route_id, 'sequence', p_route_sequence);
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_order_to_route(TEXT, UUID, SMALLINT)
  TO authenticated;

COMMIT;

-- POST-APPLY VERIFY:
-- SELECT routine_name FROM information_schema.routines
--   WHERE routine_schema='public'
--   AND routine_name IN ('confirm_order_address','assign_order_to_route');
-- Expected: 2 rows.

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.confirm_order_address(TEXT, TEXT, DECIMAL, DECIMAL, TEXT);
-- DROP FUNCTION IF EXISTS public.assign_order_to_route(TEXT, UUID, SMALLINT);
