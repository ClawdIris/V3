-- =============================================================================
-- Migration 01 — Core Routes Schema  (v3 — REVISED 2026-06-14)
-- Tables: routes, route_stops
-- Project: Casabe Konnect R4
-- Author: Forge (prepared for Delta review — NOT APPLIED)
-- Status: DRAFT v3 — Codex audit finding resolved; awaiting Delta v3 review
-- =============================================================================
-- ⚠ V3 REVISION NOTE — Codex Audit Finding Resolution
-- =============================================================================
--
-- FINDING (Codex): The Tape Direct trigger `trg_route_stops_no_tape_direct`
-- was present in v2 of this migration but references `orders.delivery_address`
-- — a column that does not exist until Migration 02
-- (02-orders-delivery-address.sql) runs. PostgreSQL raises `undefined_column`
-- errors on `route_stops` inserts when this trigger fires and the column is
-- absent. The v2 claim that the trigger "silently passes" when the column is
-- missing was incorrect: undefined_column is a hard error, not a NULL result.
--
-- FIX (v3): The Tape Direct trigger (`trg_route_stops_no_tape_direct`) and its
-- supporting function (`check_no_tape_direct_stop()`) have been REMOVED from
-- this file entirely.
--
-- WHERE THE TRIGGER NOW LIVES:
--   → Migration 02: 02-orders-delivery-address.sql
--
-- WHY:
--   Migration 02 adds `orders.delivery_address`. Only after that column exists
--   can `check_no_tape_direct_stop()` safely SELECT it. Moving the trigger to
--   Migration 02 guarantees the column is present before the trigger is created,
--   eliminating any forward-reference risk.
--
-- IMPACT ON THIS FILE (v3 vs v2):
--   • `check_no_tape_direct_stop()` function: REMOVED
--   • `trg_route_stops_no_tape_direct` trigger: REMOVED
--   • All other v2 fixes (Fix 1–5) are preserved unchanged.
--   • POST-COMMIT VERIFY item 5 updated: trigger count is now 2 (not 3).
--   • Rollback section updated: no trigger/function to drop from Migration 01.
--   • Acceptance Test 12 note updated: trigger lives in Migration 02.
-- =============================================================================
-- Revision Notes (v3 vs v2):
--
--   Fix 1–5 from v2 are preserved unchanged. See v2 header for full details.
--
--   V3 ONLY CHANGE:
--     Tape Direct trigger MOVED to Migration 02.
--     Function `check_no_tape_direct_stop()` and trigger
--     `trg_route_stops_no_tape_direct` are no longer defined here.
--     The `start_address` column DEFAULT and column comment remain in Migration
--     01 (they reference no columns outside this migration's scope).
--
-- Applies:
--   • routes table (route-level state, driver, endpoints, optimization status)
--   • route_stops table (per-stop assignment linking routes → orders)
--   • RLS policies for HQ, Office, Driver, anon
--   • Indexes for common query patterns
-- Does NOT:
--   • Modify orders table (see 02-orders-delivery-address.sql)
--   • Remove coordinate_status column from orders
--   • Apply any geocoding or optimization logic
--   • Create the Tape Direct guard trigger (moved to 02-orders-delivery-address.sql)
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

    -- FIX 2: Route-level driver assignment (nullable — route may start unassigned)
    -- Convenience column; authoritative per-stop assignment lives on route_stops.driver_user_id.
    -- Allows simple driver-scoped route queries without a route_stops join.
    driver_user_id    UUID        REFERENCES auth.users(id) DEFERRABLE INITIALLY DEFERRED,

    -- FIX 4 (partial): Start point — Tape Direct warehouse (authoritative, non-overridable by stop sequence)
    -- DEFAULT kept identical to v1/v2. This address is the route origin for every dispatch.
    -- CONTRACT: This is the Tape Direct warehouse address. It is the authoritative route
    -- origin and is never included as a numbered stop in the stop sequence.
    -- Enforcement: trg_route_stops_no_tape_direct lives in Migration 02
    --              (02-orders-delivery-address.sql) alongside the delivery_address column
    --              it depends on. Application-layer guard is the primary enforcement here.
    start_address     TEXT        NOT NULL DEFAULT '3801 White Plains Rd, Bronx, NY 10467',

    -- FIX 3: Lifecycle status — expanded to match Jeffrey's approved set
    -- Allowed values: draft | optimized | dispatched | in_progress | completed | cancelled
    status            TEXT        NOT NULL DEFAULT 'draft',

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

    -- FIX 3: Status domain constraint — full approved lifecycle
    CONSTRAINT routes_status_check CHECK (
        status IN ('draft', 'optimized', 'dispatched', 'in_progress', 'completed', 'cancelled')
    )
);

COMMENT ON TABLE public.routes IS
    'Canonical route record. One route = one driver + one set of ordered stops for a given dispatch.';

COMMENT ON COLUMN public.routes.driver_user_id IS
    'Route-level driver assignment. Nullable — a route may be created before driver assignment. '
    'Per-stop driver overrides are on route_stops.driver_user_id. This column enables efficient '
    'driver-scoped route queries without a route_stops join.';

COMMENT ON COLUMN public.routes.start_address IS
    'This is the Tape Direct warehouse address. It is the authoritative route origin and is never '
    'included as a numbered stop in the stop sequence. '
    'Default: 3801 White Plains Rd, Bronx, NY 10467. '
    'Application layer must not allow this address to be written as an order delivery_address that '
    'enters route_stops. The DB-level guard trigger (trg_route_stops_no_tape_direct) is defined in '
    'Migration 02 (02-orders-delivery-address.sql), co-located with the delivery_address column '
    'it depends on.';

COMMENT ON COLUMN public.routes.status IS
    'Route lifecycle. Allowed transitions: '
    'draft → optimized → dispatched → in_progress → completed. '
    'Any status → cancelled (abort path). '
    'Values: draft | optimized | dispatched | in_progress | completed | cancelled.';

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
    -- NOTE: orders.id is TEXT (not UUID) — this column type matches intentionally
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

COMMENT ON COLUMN public.route_stops.order_id IS
    'References orders.id (TEXT). orders.id is a text primary key, not UUID. This is intentional.';

COMMENT ON COLUMN public.route_stops.stop_sequence IS
    'Optimized stop order within the route. 1-based. After manual reorder this value is updated '
    'and waypoint_order on routes is marked stale.';

COMMENT ON COLUMN public.route_stops.status IS
    'Driver-reported stop outcome: pending | delivered | no_answer | address_issue | skipped.';


-- ---------------------------------------------------------------------------
-- NOTE: Tape Direct guard trigger is intentionally NOT here.
-- The trigger `trg_route_stops_no_tape_direct` and function
-- `check_no_tape_direct_stop()` are defined in Migration 02
-- (02-orders-delivery-address.sql) because they reference
-- `orders.delivery_address`, which does not exist until Migration 02 runs.
-- Placing them here would cause undefined_column errors on route_stops inserts.
-- ---------------------------------------------------------------------------


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

-- FIX 2: Index on routes.driver_user_id for driver-scoped route queries
CREATE INDEX IF NOT EXISTS idx_routes_driver_user_id
    ON public.routes(driver_user_id);

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

ALTER TABLE public.routes      ENABLE ROW LEVEL SECURITY;
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
    USING  (is_member(tenant_id) AND get_user_role() = 'hq')
    WITH CHECK (is_member(tenant_id) AND get_user_role() = 'hq');

CREATE POLICY "route_stops: hq full access"
    ON public.route_stops
    FOR ALL
    TO authenticated
    USING  (is_member(tenant_id) AND get_user_role() = 'hq')
    WITH CHECK (is_member(tenant_id) AND get_user_role() = 'hq');

-- FIX 1: Office role — scoped to offices they belong to.
-- get_user_office_ids() returns UUID[]; use = ANY(...) instead of scalar equality.
CREATE POLICY "routes: office scoped by office_id"
    ON public.routes
    FOR ALL
    TO authenticated
    USING (
        is_member(tenant_id)
        AND get_user_role() = 'office'
        AND office_id = ANY(get_user_office_ids())
    )
    WITH CHECK (
        is_member(tenant_id)
        AND get_user_role() = 'office'
        AND office_id = ANY(get_user_office_ids())
    );

-- FIX 1: Office route_stops scoped through parent route's office_id.
-- An Office user from Office A cannot read or write route_stops for an Office B route.
-- get_user_office_ids() returns UUID[]; use = ANY(...).
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
              AND r.office_id = ANY(get_user_office_ids())
        )
    )
    WITH CHECK (
        is_member(tenant_id)
        AND get_user_role() = 'office'
        AND EXISTS (
            SELECT 1 FROM public.routes r
            WHERE r.id = route_id
              AND r.office_id = ANY(get_user_office_ids())
        )
    );

-- Driver role: SELECT only, on their own assigned stops and the parent routes.
-- FIX 2: Driver route policy uses routes.driver_user_id (new column) for a fast
-- route-level check in addition to the route_stops join path.
-- Both paths are retained so a route is visible if the driver is either the
-- route-level assigned driver OR has any individual assigned stop.
CREATE POLICY "routes: driver select assigned"
    ON public.routes
    FOR SELECT
    TO authenticated
    USING (
        is_member(tenant_id)
        AND get_user_role() = 'driver'
        AND (
            driver_user_id = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.route_stops rs
                WHERE rs.route_id = id
                  AND rs.driver_user_id = auth.uid()
            )
        )
    );

-- FIX 5: Driver route_stops SELECT policy.
-- can_access_order() is the live RLS helper used by the 5 scoped driver orders policies.
-- order_id is already TEXT (matching orders.id TEXT PK) — no cast required.
-- This policy aligns with the verified live driver-scoped orders RLS structure.
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

-- 4. Indexes present (v2/v3 includes idx_routes_driver_user_id)
--    SELECT indexname FROM pg_indexes
--    WHERE tablename IN ('routes', 'route_stops')
--    ORDER BY indexname;
--    EXPECTED: idx_routes_tenant_id, idx_routes_office_id, idx_routes_driver_user_id,
--              idx_routes_tenant_status,
--              idx_route_stops_route_id, idx_route_stops_driver_user_id,
--              idx_route_stops_driver_status

-- 5. Trigger presence (v3: only 2 triggers from this migration; Tape Direct trigger is in Migration 02)
--    SELECT trigger_name, event_object_table FROM information_schema.triggers
--    WHERE event_object_table IN ('routes', 'route_stops')
--    ORDER BY trigger_name;
--    EXPECTED (after Migration 01 only): trg_routes_updated_at, trg_route_stops_updated_at
--    EXPECTED (after Migration 02 also): + trg_route_stops_no_tape_direct

-- 6. Status constraint — test expanded set
--    INSERT INTO public.routes (tenant_id, office_id, start_address, status, created_by)
--    VALUES ('test', gen_random_uuid(), 'test', 'invalid_status', auth.uid());
--    EXPECTED: ERROR — violates check constraint "routes_status_check"
--
--    INSERT INTO public.routes (..., status, ...) VALUES (..., 'in_progress', ...);
--    EXPECTED: SUCCESS (in_progress is now a valid status)
--
--    INSERT INTO public.routes (..., status, ...) VALUES (..., 'cancelled', ...);
--    EXPECTED: SUCCESS (cancelled is now a valid status)

-- 7. driver_user_id column on routes
--    SELECT column_name, data_type, is_nullable
--    FROM information_schema.columns
--    WHERE table_name = 'routes' AND column_name = 'driver_user_id';
--    EXPECTED: driver_user_id | uuid | YES

-- 8. Tape Direct trigger (Migration 02 concern — not verified here)
--    -- After 02-orders-delivery-address.sql is applied, verify:
--    SELECT trigger_name FROM information_schema.triggers
--    WHERE trigger_name = 'trg_route_stops_no_tape_direct';
--    EXPECTED: 1 row (created by Migration 02, not Migration 01)


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
-- -- Note: set_updated_at() is shared — only drop if no other tables use it
-- -- DROP FUNCTION IF EXISTS public.set_updated_at();
--
-- -- NOTE: check_no_tape_direct_stop() and trg_route_stops_no_tape_direct
-- -- are NOT here — they belong to Migration 02's rollback.
--
-- COMMIT;


-- ============================================================
-- ACCEPTANCE TESTS (run as authenticated users — NOT applied to production)
-- FIX 5: Tests rebased against live driver-scoped orders RLS (5 policies, Driver A verified 2026-06-14)
-- ============================================================

-- CONTEXT: Live RLS state as of 2026-06-14
--   • orders table has RLS with 5 scoped driver policies (Driver A verified)
--   • can_access_order(order_id TEXT) is the live helper function
--   • orders.id is TEXT (not UUID)
--   • route_stops.order_id is TEXT — matches orders.id type exactly; no cast needed
--   • get_user_office_ids() returns UUID[] (not scalar UUID)

-- Test 1: HQ sees all tenant routes
-- Login as HQ → SELECT * FROM routes → Expected: all tenant routes

-- Test 2: Office A sees only Office A routes
-- Login as Office A user (office belongs to office_id = <Office A UUID>)
-- SELECT * FROM routes → Expected: only routes WHERE office_id = ANY(get_user_office_ids())
-- Confirms = ANY(...) behavior with multi-office users if applicable

-- Test 3: Office B sees only Office B routes
-- Login as Office B user
-- SELECT * FROM routes → Expected: only routes WHERE office_id = ANY(get_user_office_ids())
-- SELECT * FROM routes WHERE office_id = <Office A UUID> → Expected: 0 rows

-- Test 4: Driver A sees route_stops for assigned orders via can_access_order()
-- Login as Driver A (same Driver A from live orders RLS verification 2026-06-14)
-- SELECT * FROM route_stops WHERE order_id = 'SMOKE-001'
--   → Expected: 1 row (can_access_order('SMOKE-001') = true for Driver A)
-- SELECT * FROM route_stops WHERE order_id = 'SMOKE-002'
--   → Expected: 1 row if Driver A is assigned
-- Confirms order_id (TEXT) is passed directly to can_access_order without cast

-- Test 5: Driver B sees zero route_stops
-- Login as Driver B (not assigned to any smoke orders)
-- SELECT * FROM route_stops → Expected: 0 rows
-- Confirms can_access_order() correctly returns false for unrelated driver

-- Test 6: Driver A sees parent routes via routes.driver_user_id (FIX 2 path)
-- Set routes.driver_user_id = Driver A's auth.uid() on a test route
-- Login as Driver A → SELECT * FROM routes → Expected: that route is visible
-- Confirms the new driver_user_id = auth.uid() short-circuit in driver SELECT policy

-- Test 7: Driver A sees parent routes via route_stops join (legacy path, still valid)
-- Leave routes.driver_user_id NULL but assign Driver A to route_stops.driver_user_id
-- Login as Driver A → SELECT * FROM routes → Expected: route visible via EXISTS subquery

-- Test 8: Cross-tenant user sees zero rows
-- Login as user from Tenant B
-- SELECT * FROM routes → Expected: 0 rows
-- SELECT * FROM route_stops → Expected: 0 rows

-- Test 9: Driver cannot INSERT into route_stops
-- Login as Driver A
-- INSERT INTO route_stops (...) → Expected: RLS error (no driver INSERT policy)

-- Test 10: Driver cannot UPDATE route_stops directly
-- Login as Driver A
-- UPDATE route_stops SET status = 'delivered' WHERE id = '...' → Expected: RLS error
-- Confirm update_driver_status RPC (SECURITY DEFINER) is the only write path

-- Test 11: Office A cannot read Office B route_stops
-- Login as Office A user
-- SELECT * FROM route_stops WHERE route_id = <Office B route ID> → Expected: 0 rows

-- Test 12: Tape Direct guard trigger (Migration 02 concern — NOT tested here)
-- The trigger trg_route_stops_no_tape_direct is defined in Migration 02.
-- Test it after applying 02-orders-delivery-address.sql:
-- Attempt INSERT of a route_stop for an order with delivery_address = '3801 White Plains Rd, Bronx, NY 10467'
-- Expected: EXCEPTION — Tape Direct address cannot be a route stop

-- Test 13: in_progress and cancelled status values accepted
-- INSERT INTO routes (..., status) VALUES (..., 'in_progress') → Expected: SUCCESS
-- INSERT INTO routes (..., status) VALUES (..., 'cancelled')   → Expected: SUCCESS
-- UPDATE routes SET status = 'in_progress' WHERE ...           → Expected: SUCCESS
