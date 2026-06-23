-- ════════════════════════════════════════════════════════════════════════════
-- orders-column-check.sql
-- Project  : Casabe Konnect (exayifxbqduhsxmmsnxr)
-- Author   : Forge (Dev Lead)
-- Date     : 2026-06-10
-- Purpose  : Verify the top-level relational columns on public.orders BEFORE
--            applying update-driver-status-rpc.sql.
--
-- IMPORTANT — READ-ONLY. Do NOT apply this to production.
-- Delta must run this query against the live database and report the results.
--
-- KEY QUESTION:
--   Does a top-level `status` column exist on public.orders?
--   The RPC was originally written assuming `status` is a relational column.
--   Jefe flagged that order status is stored in `orders.data->>'status'`
--   (nested JSONB). If the query below returns NO row for column_name='status',
--   the JSONB-path patch in update-driver-status-rpc.sql is required.
--
-- HOW TO RUN:
--   In Supabase Studio → SQL Editor (read-only), paste and execute:
-- ════════════════════════════════════════════════════════════════════════════

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'orders'
ORDER BY ordinal_position;

-- ════════════════════════════════════════════════════════════════════════════
-- WHAT TO CHECK IN THE RESULTS:
--
--   1. Is `status` in the list?
--      - YES → Top-level column exists. The JSONB patch may be unnecessary,
--               but verify the app actually reads/writes this column vs
--               data->>'status'. Cross-check with Jefe.
--      - NO  → No top-level `status`. The JSONB path patch in
--               update-driver-status-rpc.sql is REQUIRED.
--
--   2. Is `updated_at` in the list?
--      - YES → The `SET updated_at = NOW()` line in the RPC is safe.
--      - NO  → Drop `updated_at = NOW()` from the UPDATE in the RPC
--               (or it will fail at runtime).
--
--   3. Are the new columns from routes-rebuild migrations present?
--      (geocoded_lat, geocoded_lng, address_confidence, route_id, route_sequence)
--      - These should NOT appear yet if routes-rebuild migrations have not been applied.
--      - If they do appear, flag this to Forge — migrations may have been partially applied.
--
--   4. Is `delivery_address` in the list?
--      - The `confirm_order_address` RPC writes `delivery_address = p_address`.
--      - If not present, that RPC will fail. Note for routes-rebuild Delta review.
--
-- Report full column list to Forge so the RPC and migration files can be
-- adjusted before any SQL is applied to production.
-- ════════════════════════════════════════════════════════════════════════════
