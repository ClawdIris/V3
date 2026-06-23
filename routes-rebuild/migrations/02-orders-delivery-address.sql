-- =============================================================================
-- Migration 02 — delivery_address Column on orders
-- Project: Casabe Konnect R4
-- Author: Forge (prepared for Delta review — NOT APPLIED)
-- Status: DRAFT — awaiting Delta schema review and Jeffrey approval
-- HOLD: Do not apply until Migration 01 is approved by Delta and Jefe.
-- Reason: routes schema (Migration 01) references delivery_address semantics.
-- =============================================================================
-- Purpose:
--   Add delivery_address TEXT to public.orders so that:
--     • The confirm_order_address RPC can persist a verified customer address
--     • The address correction flow can write back to the order record
--     • HQ Operations and Office order views both read the same corrected address
--
-- Prereq: public.orders table must exist.
-- This migration does NOT remove or alter any existing columns.
-- Do NOT apply until Delta confirms orders table column compatibility.
-- =============================================================================

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


-- =============================================================================
-- ROLLBACK (commented — run manually if migration must be reverted)
-- =============================================================================

-- BEGIN;
--
-- ALTER TABLE public.orders
--     DROP COLUMN IF EXISTS delivery_address;
--
-- COMMIT;
--
-- NOTE: Dropping this column will destroy any persisted delivery_address data.
-- Only run rollback if confirmed no application code is reading this column.
