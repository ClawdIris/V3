-- =============================================================================
-- Migration 02 — delivery_address Column on orders + Tape Direct Guard Trigger
-- Project: Casabe Konnect R4
-- Author: Forge (prepared for Delta review — NOT APPLIED)
-- Status: V2 DRAFT — Tape Direct trigger added — DO NOT APPLY without Jeffrey approval
-- HOLD: Do not apply until Migration 01 v3 is applied and Jeffrey approves this file.
-- =============================================================================
-- Purpose:
--   Add delivery_address TEXT to public.orders so that:
--     • The confirm_order_address RPC can persist a verified customer address
--     • The address correction flow can write back to the order record
--     • HQ Operations and Office order views both read the same corrected address
--
-- Additionally (V2 addition):
--   Create check_no_tape_direct_stop() and trg_route_stops_no_tape_direct
--   to prevent any route_stops insert where the associated order's delivery_address
--   matches the Tape Direct warehouse address. Placed here because these objects
--   reference orders.delivery_address, which is added by this migration.
--
-- Prereq: public.orders table must exist. Migration 01 (routes schema) must be applied.
-- This migration does NOT remove or alter any existing columns.
-- Do NOT apply until Delta confirms orders table column compatibility.
-- =============================================================================

-- RELOCATION NOTE: check_no_tape_direct_stop() and trg_route_stops_no_tape_direct
-- were originally authored in Migration 01 v1/v2 but removed in Migration 01 v3
-- (Codex audit finding) because they referenced orders.delivery_address before
-- it existed. They are placed here (after ADD COLUMN delivery_address) to guarantee
-- the column is present when the trigger is created.

BEGIN;

-- ---------------------------------------------------------------------------
-- Add delivery_address column (idempotent — IF NOT EXISTS guard)
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_address TEXT;

COMMENT ON COLUMN public.orders.delivery_address IS
    'Customer delivery address for route planning. Written by confirm_order_address RPC. '
    'Source of truth for geocoding and route stop display across all surfaces.';


-- ============================================================
-- BACKFILL STRATEGY: Option A — Lazy Population (FINAL DECISION)
-- ============================================================
-- delivery_address is populated on first confirmation per order.
-- Existing orders remain NULL until a dispatcher confirms them in
-- the route builder. Unconfirmed orders are blocked from route
-- assignment regardless of delivery_address value.
--
-- The confirm_order_address RPC must implement all four of:
--
-- 1. THROTTLING
--    Rate-limit Geocoding API calls per tenant per minute.
--    Recommended: max 10 geocode requests/minute/tenant.
--    Excess requests: queue with exponential backoff, do not drop.
--
-- 2. RETRIES
--    On transient Geocoding API error (5xx, timeout):
--    Retry up to 3 times with exponential backoff (1s, 2s, 4s).
--    On persistent failure: surface clear error to dispatcher,
--    do not silently fail or cache an unverified address.
--
-- 3. COST MONITORING
--    Log every Geocoding API call to a geocode_audit table or Edge
--    Function log: tenant_id, order_id, timestamp, result_status.
--    Alert if daily calls exceed configured threshold.
--
-- 4. ADDRESS-HASH CACHING
--    Before calling Geocoding API, hash the raw address string
--    (MD5 or SHA-256). Check a geocode_cache table for a recent
--    hit (TTL: 30 days). On cache hit: use cached lat/lon/formatted
--    address, skip API call. On cache miss: call API, store result.
--    Cache table: geocode_cache(address_hash, lat, lon,
--    formatted_address, cached_at, tenant_id).
--
-- Do not bulk-geocode all historical orders.
-- Option B (bulk backfill) is explicitly rejected.
-- ============================================================


-- ── Tape Direct guard (relocated from Migration 01) ──────────────────────
-- Prevents route_stops inserts where the associated order's delivery_address
-- matches the Tape Direct warehouse. Tape Direct is always the route ORIGIN
-- and must never appear as a numbered stop.
-- This function and trigger are placed here (Migration 02) because they
-- reference orders.delivery_address, which is created above.

CREATE OR REPLACE FUNCTION public.check_no_tape_direct_stop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery_address TEXT;
BEGIN
  SELECT delivery_address
    INTO v_delivery_address
    FROM public.orders
   WHERE id        = NEW.order_id
     AND tenant_id = NEW.tenant_id;

  IF v_delivery_address IS NOT NULL
     AND lower(trim(v_delivery_address)) = lower(trim('3801 White Plains Rd, Bronx, NY 10467'))
  THEN
    RAISE EXCEPTION
      'route_stops: order % has delivery_address matching Tape Direct warehouse. '
      'Tape Direct is the route origin and must not appear as a stop.',
      NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_route_stops_no_tape_direct
  BEFORE INSERT ON public.route_stops
  FOR EACH ROW EXECUTE FUNCTION public.check_no_tape_direct_stop();

COMMIT;


-- =============================================================================
-- POST-COMMIT VERIFY
-- =============================================================================

-- 1. Column exists with correct type
--    SELECT column_name, data_type, is_nullable
--    FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'orders'
--      AND column_name = 'delivery_address';
--    EXPECTED: 1 row, data_type = 'text', is_nullable = 'YES'

-- 2. Column comment present
--    SELECT col_description(
--        'public.orders'::regclass,
--        attnum
--    ) AS comment
--    FROM pg_attribute
--    WHERE attrelid = 'public.orders'::regclass
--      AND attname = 'delivery_address';
--    EXPECTED: non-null comment text

-- 3. Read/write smoke test
--    UPDATE public.orders
--    SET delivery_address = '3801 White Plains Rd, Bronx, NY 10467'
--    WHERE id = (SELECT id FROM public.orders LIMIT 1);
--    EXPECTED: UPDATE 1 (or UPDATE 0 if no orders exist)
--    -- Then rollback:
--    -- ROLLBACK; (wrap in a transaction if just testing)

-- 4. Tape Direct function exists
--    SELECT routine_name FROM information_schema.routines
--    WHERE routine_schema = 'public' AND routine_name = 'check_no_tape_direct_stop';
--    EXPECTED: 1 row

-- 5. Tape Direct trigger exists on route_stops
--    SELECT trigger_name FROM information_schema.triggers
--    WHERE event_object_schema = 'public'
--      AND event_object_table = 'route_stops'
--      AND trigger_name = 'trg_route_stops_no_tape_direct';
--    EXPECTED: 1 row

-- 6. Tape Direct address is blocked (behavioral test — run in a transaction, then rollback)
--    BEGIN;
--    UPDATE public.orders SET delivery_address = '3801 White Plains Rd, Bronx, NY 10467'
--    WHERE id = (SELECT id FROM public.orders LIMIT 1);
--    INSERT INTO public.route_stops (route_id, order_id, tenant_id, stop_sequence)
--    VALUES (gen_random_uuid(), '<order_id_from_above>', '<tenant_id>', 1);
--    EXPECTED: ERROR — 'route_stops: order ... has delivery_address matching Tape Direct warehouse'
--    ROLLBACK;


-- =============================================================================
-- ROLLBACK (commented — run manually if migration must be reverted)
-- =============================================================================

-- BEGIN;
--
-- DROP TRIGGER IF EXISTS trg_route_stops_no_tape_direct ON public.route_stops;
-- DROP FUNCTION IF EXISTS public.check_no_tape_direct_stop();
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS delivery_address;
--
-- COMMIT;
--
-- NOTE: Dropping this column will destroy any persisted delivery_address data.
-- Only run rollback if confirmed no application code is reading this column.
-- Trigger and function are dropped first (correct dependency order — trigger
-- references the function; function must be dropped after trigger).
