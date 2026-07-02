-- ============================================================================
-- Migration 04 — orders geocoding + route columns
-- Routes Rebuild · Phase 3 / Slice 1 prerequisite
-- ----------------------------------------------------------------------------
-- WHY: confirm_order_address() and assign_order_to_route() (migration 05) write
--      these columns. They were specified in the plan (Section 3) but never
--      applied — live introspection 2026-06-29 shows only `delivery_address`
--      exists on orders. This migration adds the rest. Pure additive DDL,
--      no Google key, no DML, idempotent (ADD COLUMN IF NOT EXISTS).
--
-- COLUMNS (relational geocoding source of truth, replaces data->>'lat'/'lon'):
--   geocoded_lat / geocoded_lng   — Google-geocoded coordinates (NULL until gate)
--   address_confidence            — 'high' | 'low' | 'unresolvable' | NULL
--   address_confirmed_at / _by    — audit of who confirmed the geocode
--   route_id / route_sequence     — route assignment (FK to routes, sequence in route)
--
-- NOTE: This does NOT add the customer-pin columns (pickup_lat/lng/accuracy_m/
--       pickup_pin_source) from the Location Pin Capture spec — those ship in a
--       separate GREEN migration once that work is greenlit.
-- ============================================================================
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS geocoded_lat         DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS geocoded_lng         DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS address_confidence   TEXT,
  ADD COLUMN IF NOT EXISTS address_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS address_confirmed_by UUID,
  ADD COLUMN IF NOT EXISTS route_id             UUID,
  ADD COLUMN IF NOT EXISTS route_sequence       SMALLINT;

-- Confidence value guard (matches RPC validation). Drop-then-add for idempotency.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_address_confidence_chk;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_address_confidence_chk
  CHECK (address_confidence IS NULL
         OR address_confidence IN ('high','low','unresolvable'));

-- FK: route_id → routes(id). ON DELETE SET NULL so deleting a route un-assigns
-- its orders rather than cascading deletes. Idempotent via catalog guard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_route_id_fkey'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_route_id_fkey
      FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Partial index: route surfaces query orders by route, ordered by sequence.
CREATE INDEX IF NOT EXISTS idx_orders_route_id_sequence
  ON public.orders (route_id, route_sequence)
  WHERE route_id IS NOT NULL;

-- Partial index: address-confidence gate scans unconfirmed/low orders.
CREATE INDEX IF NOT EXISTS idx_orders_address_confidence
  ON public.orders (tenant_id, address_confidence)
  WHERE address_confidence IS DISTINCT FROM 'high';

COMMENT ON COLUMN public.orders.geocoded_lat IS
  'Google-geocoded latitude (relational SSOT). NULL until the order passes the geocode gate. Replaces legacy data->>''lat''.';
COMMENT ON COLUMN public.orders.address_confidence IS
  'high|low|unresolvable|NULL. NULL=never geocoded by Google. A customer-dropped pin (pickup_lat/lng) outranks this entirely.';

COMMIT;

-- POST-APPLY VERIFY (run manually after apply):
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='orders' AND column_name IN
--   ('geocoded_lat','geocoded_lng','address_confidence','address_confirmed_at',
--    'address_confirmed_by','route_id','route_sequence');
-- Expected: 7 rows.

-- ROLLBACK:
-- ALTER TABLE public.orders
--   DROP CONSTRAINT IF EXISTS orders_route_id_fkey,
--   DROP CONSTRAINT IF EXISTS orders_address_confidence_chk;
-- DROP INDEX IF EXISTS public.idx_orders_route_id_sequence;
-- DROP INDEX IF EXISTS public.idx_orders_address_confidence;
-- ALTER TABLE public.orders
--   DROP COLUMN IF EXISTS geocoded_lat, DROP COLUMN IF EXISTS geocoded_lng,
--   DROP COLUMN IF EXISTS address_confidence, DROP COLUMN IF EXISTS address_confirmed_at,
--   DROP COLUMN IF EXISTS address_confirmed_by, DROP COLUMN IF EXISTS route_id,
--   DROP COLUMN IF EXISTS route_sequence;
