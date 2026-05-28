-- ═══════════════════════════════════════════════════════════════════
-- PHASE 6 — SLICE 2: Geocoding + Coordinate Quality
-- Migration: Add lat/lon + coordinate_status to orders table
-- ═══════════════════════════════════════════════════════════════════
--
-- STATUS: PENDING — do NOT apply without Jefe review
-- Written by: Bolt (subagent)
-- Date: 2026-05-28
-- Project: Casabe Konnect R4 (Supabase: exayifxbqduhsxmmsnxr)
--
-- SCHEMA DECISION:
--   - box_orders does NOT have lat/lon columns (checked phase1-data-schema.sql)
--   - orders does NOT have lat/lon columns (checked phase1-data-schema.sql)
--   - Adding to orders (parent table) because orders.address/city/state are
--     the canonical address fields used for geocoding.
--   - box_orders inherits delivery context from its parent order.
--
-- SAFETY: All ALTER TABLE use IF NOT EXISTS / DO $$...END blocks.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- Step 1: Add geocoding columns to orders
-- ─────────────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS lat              DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lon              DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS coordinate_status TEXT
    DEFAULT 'missing'
    CHECK (coordinate_status IN ('missing', 'geocoded', 'low_confidence', 'manual_override')),
  ADD COLUMN IF NOT EXISTS coordinate_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS coordinate_updated_by TEXT;  -- user email or uid who last set coords

-- ─────────────────────────────────────────────────────────
-- Step 2: Default existing rows to 'missing'
-- ─────────────────────────────────────────────────────────

UPDATE orders
SET coordinate_status = 'missing'
WHERE coordinate_status IS NULL;

-- ─────────────────────────────────────────────────────────
-- Step 3: Indexes for common map queries
-- ─────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_orders_coordinate_status
  ON orders(coordinate_status);

CREATE INDEX IF NOT EXISTS idx_orders_lat_lon
  ON orders(lat, lon)
  WHERE lat IS NOT NULL AND lon IS NOT NULL;

-- ─────────────────────────────────────────────────────────
-- Step 4: RLS — no new tables; piggybacks on existing orders RLS
--   HQ role can UPDATE coordinate columns:
--     policy: "hq_coordinate_update" — restricted to coordinate fields only
--   This is handled by existing row-level policy that grants HQ UPDATE on orders.
--   No new policies needed IF existing HQ policy covers all columns.
--   If your existing policy uses a column allowlist, add lat/lon/coordinate_status
--   to that list. Example (adjust to match your existing policy name):
-- ─────────────────────────────────────────────────────────

-- Example (only run if your UPDATE policy is column-restricted):
-- ALTER POLICY "hq_can_update_orders" ON orders
--   USING (auth.jwt() ->> 'role' = 'hq')
--   WITH CHECK (auth.jwt() ->> 'role' = 'hq');
-- (Supabase column-level grants are preferred over re-writing the policy.)

-- Grant coordinate columns to hq role if using column-level grants:
-- GRANT UPDATE (lat, lon, coordinate_status, coordinate_updated_at, coordinate_updated_by)
--   ON orders TO authenticated;

-- ─────────────────────────────────────────────────────────
-- Step 5: activity_log — no schema change needed
--   The existing activity_log table (phase1-data-schema.sql) already has:
--     order_id TEXT, activity_type TEXT, old_data JSONB, new_data JSONB,
--     user_id UUID, created_at TIMESTAMPTZ, request_id UUID
--   Manual coordinate overrides write to activity_log with:
--     activity_type = 'coordinate_override'
--     old_data = { lat, lon, coordinate_status }
--     new_data = { lat, lon, coordinate_status, note, updated_by }
-- ─────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────
-- Verification query (run after applying)
-- ─────────────────────────────────────────────────────────

-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'orders'
--   AND column_name IN ('lat', 'lon', 'coordinate_status', 'coordinate_updated_at', 'coordinate_updated_by')
-- ORDER BY column_name;

COMMENT ON COLUMN orders.lat IS
  'Geocoded latitude. Source: Nominatim/OpenStreetMap or manual HQ override.';
COMMENT ON COLUMN orders.lon IS
  'Geocoded longitude. Source: Nominatim/OpenStreetMap or manual HQ override.';
COMMENT ON COLUMN orders.coordinate_status IS
  'Coordinate quality: missing | geocoded | low_confidence | manual_override';
COMMENT ON COLUMN orders.coordinate_updated_at IS
  'Timestamp of last coordinate update (geocode or manual override).';
COMMENT ON COLUMN orders.coordinate_updated_by IS
  'Email or uid of HQ user who last set coordinates (for manual_override).';
