-- =============================================================================
-- Migration 01 — Core Routes Schema
-- Tables: routes, route_stops
-- Project: Casabe Konnect R4
-- Author: Forge (prepared for Delta review — NOT APPLIED)
-- Status: DRAFT — awaiting Delta schema review and Jeffrey approval
-- =============================================================================
-- Applies:
--   • routes table (route-level state, driver, endpoints, optimization status)
--   • route_stops table (per-stop assignment linking routes → orders)
--   • RLS policies for HQ, Office, Driver, anon
--   • Indexes for common query patterns
-- Does NOT:
--   • Modify orders table (see 02-orders-delivery-address.sql)
--   • Remove coordinate_status column from orders
--   • Apply any geocoding or optimization logic
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABLE: routes
-- Canonical record for a dispatched or in-progress route
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.routes (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         TEXT        NOT NULL,
    office_id         UUID        NOT NULL REFERENCES public.offices(id),

    -- Start point: always Tape Direct warehouse by default
    -- Manual override stored as address text; never stored as an order stop
    start_address     TEXT        NOT NULL, -- "3801 White Plains Rd, Bronx, NY 10467" default

    -- Lifecycle status
    status            TEXT        NOT NULL DEFAULT 'draft',
    -- Allowed values: draft | optimized | dispatched | completed
    -- Constraint checked below

    -- Google Routes API timestamps
    optimized_at      TIMESTAMPTZ,
    dispatched_at     TIMESTAMPTZ,

    -- Persisted Google Routes API response: optimized waypoint sequence
    -- Shape: { "orderedWaypoints": [...], "routes": [...], ... }
    waypoint_order    JSONB,

    -- Audit
    created_by        UUID        NOT NULL REFERENCES auth.users(id) DEFERRABLE INITIALLY DEFERRED,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Archive pattern — no hard deletes
    is_active         BOOLEAN     NOT NULL DEFAULT TRUE,

    -- Status domain constraint
    CONSTRAINT routes_status_check CHECK (
        status IN ('draft', 'optimized', 'dispatched', 'completed')
    )
);

COMMENT ON TABLE public.routes IS
    'Canonical route record. One route = one driver + one set of ordered stops for a given dispatch.';

COMMENT ON COLUMN public.routes.start_address IS
    'Starting address for the route. Default: Tape Direct warehouse. Manual entry allowed for endpoints only.';

COMMENT ON COLUMN public.routes.waypoint_order IS
    'Persisted Google Routes API response capturing the optimized waypoint sequence.';

COMMENT ON COLUMN public.routes.is_active IS
    'Soft-delete / archive flag. Use is_active = FALSE instead of DELETE.';


-- ---------------------------------------------------------------------------
-- TABLE: route_stops
-- Joins a route to specific orders; records per-stop driver assignment and status
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.route_stops (
    id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id         UUID    NOT NULL REFERENCES public.routes(id),

    -- Order reference (composite FK matching orders PK: id + tenant_id)
    order_id         TEXT    NOT NULL,
    tenant_id        TEXT    NOT NULL,
    FOREIGN KEY (order_id, tenant_id)
        REFERENCES public.orders(id, tenant_id),

    -- Optimized position in this route (1-based)
    stop_sequence    INT     NOT NULL,

    -- Driver executing this specific stop (may differ per stop on multi-driver routes)
    driver_user_id   UUID    REFERENCES auth.users(id) DEFERRABLE INITIALLY DEFERRED,

    -- Stop-level delivery status
    status           TEXT    NOT NULL DEFAULT 'pending',
    -- Allowed: pending | delivered | no_answer | address_issue | skipped
    CONSTRAINT route_stops_status_check CHECK (
        status IN ('pending', 'delivered', 'no_answer', 'address_issue', 'skipped')
    ),

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.route_stops IS
    'Per-stop assignment record linking a route to an order. Sequence is set by the optimizer.';

COMMENT ON COLUMN public.route_stops.stop_sequence IS
    'Optimized stop order within the route. 1-based. After manual reorder this value is updated and waypoint_order on routes is marked stale.';

COMMENT ON COLUMN public.route_stops.status IS
    'Driver-reported stop outcome: pending | delivered | no_answer | address_issue | skipped.';


-- ---------------------------------------------------------------------------
-- UPDATED_AT trigger helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_routes_updated_at ON public.routes;
CREATE TRIGGER trg_routes_updated_at
    BEFORE UPDATE ON public.routes
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_route_stops_updated_at ON public.route_stops;
CREATE TRIGGER trg_route_stops_updated_at
    BEFORE UPDATE ON public.route_stops
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_routes_tenant_id
    ON public.routes(tenant_id);

CREATE INDEX IF NOT EXISTS idx_routes_office_id
    ON public.routes(office_id);

-- Composite for common "active routes for tenant" queries
CREATE INDEX IF NOT EXISTS idx_routes_tenant_status
    ON public.routes(tenant_id, status)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_route_stops_route_id
    ON public.route_stops(route_id);

CREATE INDEX IF NOT EXISTS idx_route_stops_driver_user_id
    ON public.route_stops(driver_user_id);

-- Composite for "all stops for a driver across routes"
CREATE INDEX IF NOT EXISTS idx_route_stops_driver_status
    ON public.route_stops(driver_user_id, status);


-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

ALTER TABLE public.routes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_stops ENABLE ROW LEVEL SECURITY;

-- Block anon from all access
CREATE POLICY "routes: anon blocked"
    ON public.routes
    FOR ALL
    TO anon
    USING (false);

CREATE POLICY "route_stops: anon blocked"
    ON public.route_stops
    FOR ALL
    TO anon
    USING (false);

-- HQ role: full access across all tenants
CREATE POLICY "routes: hq full access"
    ON public.routes
    FOR ALL
    TO authenticated
    USING (is_member(tenant_id) AND get_user_role() = 'hq')
    WITH CHECK (is_member(tenant_id) AND get_user_role() = 'hq');

CREATE POLICY "route_stops: hq full access"
    ON public.route_stops
    FOR ALL
    TO authenticated
    USING (is_member(tenant_id) AND get_user_role() = 'hq')
    WITH CHECK (is_member(tenant_id) AND get_user_role() = 'hq');

-- Office role: scoped to their own office_id
CREATE POLICY "routes: office scoped by office_id"
    ON public.routes
    FOR ALL
    TO authenticated
    USING (is_member(tenant_id) AND get_user_role() = 'office' AND get_user_office_id() = office_id)
    WITH CHECK (is_member(tenant_id) AND get_user_role() = 'office' AND get_user_office_id() = office_id);

-- Fix A1: Office route_stops scoped through parent route's office_id
-- An Office user from Office A cannot read or write route_stops for an Office B route.
CREATE POLICY "route_stops: office scoped via route"
    ON public.route_stops
    FOR ALL
    TO authenticated
    USING (
        is_member(tenant_id)
        AND get_user_role() = 'office'
        AND EXISTS (
            SELECT 1 FROM public.routes r
            WHERE r.id = route_id
              AND r.office_id = get_user_office_id()
        )
    )
    WITH CHECK (
        is_member(tenant_id)
        AND get_user_role() = 'office'
        AND EXISTS (
            SELECT 1 FROM public.routes r
            WHERE r.id = route_id
              AND r.office_id = get_user_office_id()
        )
    );

-- Driver role: SELECT only, on their own assigned stops and the parent routes
-- Uses can_access_order(order_id) — existing RLS helper assumed present
CREATE POLICY "routes: driver select assigned"
    ON public.routes
    FOR SELECT
    TO authenticated
    USING (
        is_member(tenant_id)
        AND get_user_role() = 'driver'
        AND EXISTS (
            SELECT 1 FROM public.route_stops rs
            WHERE rs.route_id = id
              AND rs.driver_user_id = auth.uid()
        )
    );

CREATE POLICY "route_stops: driver select own"
    ON public.route_stops
    FOR SELECT
    TO authenticated
    USING (
        is_member(tenant_id)
        AND get_user_role() = 'driver'
        AND can_access_order(order_id)
    );

-- NOTE: Drivers do not have a direct UPDATE policy on route_stops.
-- Driver status updates are handled exclusively via the update_driver_status RPC (SECURITY DEFINER).
-- The RPC writes to orders.data->>'status' and updates route_stops indirectly.
-- No client-side UPDATE path exists for drivers.


COMMIT;


-- =============================================================================
-- POST-COMMIT VERIFY
-- Run these queries after applying the migration to confirm expected state.
-- =============================================================================

-- 1. Tables created
--    SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public'
--      AND table_name IN ('routes', 'route_stops');
--    EXPECTED: 2 rows

-- 2. RLS enabled
--    SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('routes', 'route_stops');
--    EXPECTED: both relrowsecurity = true

-- 3. Policy count
--    SELECT tablename, policyname FROM pg_policies
--    WHERE tablename IN ('routes', 'route_stops')
--    ORDER BY tablename, policyname;
--    EXPECTED: 8 policies total
--      routes (4):      "routes: anon blocked", "routes: hq full access",
--                       "routes: office scoped by office_id", "routes: driver select assigned"
--      route_stops (4): "route_stops: anon blocked", "route_stops: hq full access",
--                       "route_stops: office scoped via route", "route_stops: driver select own"

-- 4. Indexes present
--    SELECT indexname FROM pg_indexes
--    WHERE tablename IN ('routes', 'route_stops')
--    ORDER BY indexname;
--    EXPECTED: idx_routes_tenant_id, idx_routes_office_id, idx_routes_tenant_status,
--              idx_route_stops_route_id, idx_route_stops_driver_user_id,
--              idx_route_stops_driver_status

-- 5. Trigger presence
--    SELECT trigger_name, event_object_table FROM information_schema.triggers
--    WHERE event_object_table IN ('routes', 'route_stops')
--    ORDER BY trigger_name;
--    EXPECTED: trg_routes_updated_at, trg_route_stops_updated_at

-- 6. Status constraint
--    INSERT INTO public.routes (tenant_id, office_id, start_address, status, created_by)
--    VALUES ('test', gen_random_uuid(), 'test', 'invalid_status', auth.uid());
--    EXPECTED: ERROR — violates check constraint "routes_status_check"


-- =============================================================================
-- ROLLBACK (commented — run manually if migration must be reverted)
-- =============================================================================

-- BEGIN;
--
-- DROP TRIGGER IF EXISTS trg_route_stops_updated_at ON public.route_stops;
-- DROP TRIGGER IF EXISTS trg_routes_updated_at ON public.routes;
--
-- DROP TABLE IF EXISTS public.route_stops;
-- DROP TABLE IF EXISTS public.routes;
--
-- -- Note: set_updated_at() function is shared — only drop if no other tables use it
-- -- DROP FUNCTION IF EXISTS public.set_updated_at();
--
-- COMMIT;


-- ============================================================
-- ACCEPTANCE TESTS (run as authenticated users after apply)
-- To be executed by Delta post-apply in a test/staging environment.
-- DO NOT run against production data.
-- ============================================================

-- Test 1: HQ sees all tenant routes
-- Login as HQ → SELECT * FROM routes → Expected: all tenant routes

-- Test 2: Office A sees only Office A routes
-- Login as Office A user (office_id = <Office A UUID>)
-- SELECT * FROM routes → Expected: only routes where office_id = Office A

-- Test 3: Office B sees only Office B routes
-- Login as Office B user (office_id = <Office B UUID>)
-- SELECT * FROM routes → Expected: only routes where office_id = Office B
-- SELECT * FROM routes WHERE office_id = <Office A UUID> → Expected: 0 rows

-- Test 4: Driver A sees only assigned route stops
-- Login as Driver A
-- SELECT * FROM route_stops WHERE order_id = 'SMOKE-001' → Expected: 1 row (assigned to Driver A)
-- SELECT * FROM route_stops WHERE order_id = 'SMOKE-002' → Expected: 1 row (assigned to Driver A)

-- Test 5: Driver B sees zero route stops
-- Login as Driver B (not assigned to any smoke orders)
-- SELECT * FROM route_stops → Expected: 0 rows

-- Test 6: Cross-tenant user sees zero rows
-- Login as user from Tenant B
-- SELECT * FROM routes → Expected: 0 rows
-- SELECT * FROM route_stops → Expected: 0 rows

-- Test 7: Driver cannot INSERT into route_stops
-- Login as Driver A
-- INSERT INTO route_stops (...) → Expected: RLS error (no driver INSERT policy)

-- Test 8: Driver cannot UPDATE route_stops directly
-- Login as Driver A
-- UPDATE route_stops SET status = 'delivered' WHERE id = '...' → Expected: RLS error

-- Test 9: Office A cannot read Office B route_stops
-- Login as Office A user
-- SELECT * FROM route_stops WHERE route_id = <Office B route ID> → Expected: 0 rows
