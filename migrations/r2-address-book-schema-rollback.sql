-- ════════════════════════════════════════════════════════════════════════════
-- r2-address-book-schema-rollback.sql
-- Casabe Konnect — Release 2: Address Book — ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- Author  : Forge (Dev Lead)
-- Reviewer: Delta (QA Lead)
-- Date    : 2026-06-14
-- Status  : PENDING — Use only if r2-address-book-schema.sql must be undone
--
-- SCOPE:
--   Removes ONLY what r2-address-book-schema.sql created:
--     • address_book table (including all policies, indexes, triggers)
--     • campaign_audiences table (including all policies, indexes, triggers)
--     • v_campaign_audience_contacts view
--     • import_contacts_from_orders() function
--     • set_updated_at() trigger function (only if unused by other tables)
--
-- SAFETY:
--   • Does NOT touch the campaigns table or any pre-existing data.
--   • Does NOT touch orders, orders policies, or any R1 work.
--   • Does NOT remove is_member(), get_user_role(), or can_access_order().
--   • Data in address_book will be PERMANENTLY LOST — export first if needed.
--
-- ⚠️  WARNING: This rollback is destructive for address_book data.
--     Run only after confirming with Jeffrey that rollback is approved.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 1: Drop the audience contact view
-- ────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_campaign_audience_contacts;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 2: Drop the import function
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.import_contacts_from_orders(TEXT);

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 3: Drop campaign_audiences (policies and indexes drop automatically)
-- ────────────────────────────────────────────────────────────────────────────
-- Drop policies first (explicit, defensive)
DROP POLICY IF EXISTS ca_hq_office_all       ON public.campaign_audiences;
DROP POLICY IF EXISTS ca_driver_anon_blocked ON public.campaign_audiences;
DROP POLICY IF EXISTS ca_anon_blocked        ON public.campaign_audiences;

-- Drop trigger
DROP TRIGGER IF EXISTS trg_ca_updated_at ON public.campaign_audiences;

-- Drop table (CASCADE to drop any dependent objects)
DROP TABLE IF EXISTS public.campaign_audiences CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 4: Drop address_book (policies and indexes drop automatically)
-- ────────────────────────────────────────────────────────────────────────────
-- Drop policies first (explicit, defensive)
DROP POLICY IF EXISTS ab_hq_office_all  ON public.address_book;
DROP POLICY IF EXISTS ab_driver_select  ON public.address_book;
DROP POLICY IF EXISTS ab_anon_blocked   ON public.address_book;

-- Drop trigger
DROP TRIGGER IF EXISTS trg_ab_updated_at ON public.address_book;

-- Drop table (CASCADE to drop any dependent objects)
DROP TABLE IF EXISTS public.address_book CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 5: Drop set_updated_at() only if no other table uses it
-- ────────────────────────────────────────────────────────────────────────────
-- This function is generic. If other tables now depend on it (e.g., a future
-- R3 migration added it elsewhere), this DROP will fail safely due to
-- dependencies. Review before applying.
--
-- Uncomment only if set_updated_at() was ONLY created by r2-address-book-schema.sql
-- and is confirmed unused by any other trigger in the DB.

-- DROP FUNCTION IF EXISTS public.set_updated_at();

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- POST-ROLLBACK VERIFICATION
-- ════════════════════════════════════════════════════════════════════════════

-- RB-V1: Confirm address_book is gone.
-- Expected: 0 rows
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'address_book';

-- RB-V2: Confirm campaign_audiences is gone.
-- Expected: 0 rows
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'campaign_audiences';

-- RB-V3: Confirm view is gone.
-- Expected: 0 rows
SELECT viewname FROM pg_views
WHERE schemaname = 'public' AND viewname = 'v_campaign_audience_contacts';

-- RB-V4: Confirm import function is gone.
-- Expected: 0 rows
SELECT proname FROM pg_proc
WHERE proname = 'import_contacts_from_orders'
  AND pronamespace = 'public'::regnamespace;

-- RB-V5: Confirm campaigns table is intact (unchanged by rollback).
-- Expected: 1 row
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'campaigns';
