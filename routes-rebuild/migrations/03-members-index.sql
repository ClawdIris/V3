-- =============================================================================
-- Migration 03 — members Table Indexes
-- Project: Casabe Konnect R4
-- Author: Forge (prepared for Delta review — NOT APPLIED)
-- Status: DRAFT — awaiting Delta schema review and Jeffrey approval
-- =============================================================================
-- Purpose:
--   Add one index to public.members to support driver lookup and authorization
--   checks in the routes rebuild:
--     • idx_members_user_id  — fast user_id single-column lookup
--
-- NOTE: idx_members_tenant_user (originally planned) has been removed.
--   Production already has members_tenant_id_user_id_key — a UNIQUE constraint
--   index on (tenant_id, user_id) with no WHERE predicate. A plain btree on
--   (tenant_id, user_id) would be an exact duplicate. The unique constraint
--   already covers the tenant-scoped driver query access pattern.
--
-- idx_members_user_id is kept because production only has idx_members_user_active
--   (btree on user_id WHERE active = true). A plain unconditional index on
--   user_id is distinct and covers lookups regardless of active status.
--
-- This index is applied with CREATE INDEX CONCURRENTLY to avoid table lock
-- on a live production table.
--
-- IMPORTANT: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- No BEGIN/COMMIT wrapper is used in this migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_members_user_id
    ON public.members(user_id);

COMMENT ON INDEX idx_members_user_id IS
    'Fast lookup of member record by Supabase auth user_id. '
    'Used by driver selector and RLS authorization checks. '
    'Distinct from idx_members_user_active (which is conditional on active = true).';


-- =============================================================================
-- POST-COMMIT VERIFY
-- =============================================================================

-- 1. Index present
--    SELECT indexname, indexdef
--    FROM pg_indexes
--    WHERE tablename = 'members'
--      AND indexname = 'idx_members_user_id';
--    EXPECTED: 1 row

-- 2. Index is valid (not in failed partial-build state)
--    SELECT indexname, indisvalid
--    FROM pg_indexes
--    JOIN pg_index ON pg_index.indexrelid = (
--        SELECT oid FROM pg_class WHERE relname = indexname
--    )
--    WHERE tablename = 'members'
--      AND indexname = 'idx_members_user_id';
--    EXPECTED: indisvalid = true

-- 3. Query plan uses index (run EXPLAIN on a real query after apply)
--    EXPLAIN SELECT * FROM public.members WHERE user_id = '<some-uuid>';
--    EXPECTED: Index Scan using idx_members_user_id


-- =============================================================================
-- ROLLBACK (commented — run manually if migration must be reverted)
-- =============================================================================

-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_members_user_id;
--
-- NOTE: Dropping this index has no data impact.
-- It will reduce query performance for driver selector and RLS checks until re-added.
-- DROP INDEX CONCURRENTLY also runs without a transaction block.
