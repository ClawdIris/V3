-- r1-security-rollback.sql
-- Casabe Konnect R7 Security Migration — ROLLBACK (DATA-PRESERVING)
-- Use ONLY if r1-security-revised.sql was applied and must be undone.
-- DO NOT APPLY without Jeffrey's explicit approval.
--
-- ============================================================
-- ROLLBACK ORDER (CRITICAL):
-- Step 1: Restore prior Edge Functions (stripe-webhook + stripe-checkout)
--         via Supabase Dashboard
-- Step 2: Verify prior functions are live and handling events correctly
-- Step 3: THEN apply this SQL rollback
-- Reason: The R7 Edge Functions call RPCs that this file drops.
--         If you drop RPCs first while R7 functions are live, webhook
--         events will error until function deployment completes.
-- ============================================================
--
-- WHAT THIS FILE DOES:
--   - Drops the 5 new R7 RPCs (no data, safe to drop)
--   - Reverts stripe_events COLUMN-LEVEL schema changes only
--   - Does NOT drop stripe_events or destroy any rows
--
-- WHAT IS NOT REVERSED:
--   - N1 backfill (assignedDriverUserId data write) — NOT reversible; data remains
--   - N2 (orders_driver_update policy/trigger DROP) — intentionally NOT restored;
--     RPC-only driver path is correct and safer
--   - M2 search_path pins on financial functions — safe to leave; non-breaking

BEGIN;

-- ============================================================
-- STEP 0: Row-count guard — log rows before any changes
-- ============================================================
DO $$
DECLARE v_row_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_row_count FROM public.stripe_events;
  RAISE NOTICE 'stripe_events row count before rollback: % rows', v_row_count;
  IF v_row_count > 0 THEN
    RAISE NOTICE 'WARNING: % rows exist in stripe_events — all data will be PRESERVED (schema revert only)', v_row_count;
  END IF;
END $$;

-- ============================================================
-- STEP 1: Drop new Stripe RPCs (created by R7 migration)
--         These are functions only — no data loss.
-- ============================================================
DROP FUNCTION IF EXISTS public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC);
DROP FUNCTION IF EXISTS public.merge_stripe_payment_status(TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS public.claim_stripe_event(TEXT,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS public.finalize_stripe_event(TEXT,TEXT,TEXT[],TIMESTAMPTZ,TEXT);
DROP FUNCTION IF EXISTS public.get_checkout_authorized_member(TEXT);

-- ============================================================
-- STEP 2: Revert stripe_events schema — DATA-PRESERVING
--
-- The R7 migration changed the following columns:
--   - claimed_at:       added DEFAULT now(), SET NOT NULL
--   - processed_at:     removed DEFAULT now(), SET nullable
--   - payment_status:   added DEFAULT 'processing', SET NOT NULL
--
-- We revert these constraints/defaults WITHOUT dropping the table
-- or any of its rows. The claimed_at column is intentionally left
-- in place — removing it would be a DROP COLUMN (data loss risk
-- if populated), and the predecessor webhook ignores it harmlessly.
-- ============================================================

-- Revert claimed_at: drop the default and nullability constraint added by R7
ALTER TABLE public.stripe_events ALTER COLUMN claimed_at DROP DEFAULT;
ALTER TABLE public.stripe_events ALTER COLUMN claimed_at DROP NOT NULL;

-- Revert processed_at: restore original NOT NULL DEFAULT now() contract.
-- First backfill any NULL processed_at rows to now() — R7 left processing/failed
-- rows with NULL processed_at; SET NOT NULL would abort without this backfill.
UPDATE public.stripe_events
  SET processed_at = now()
  WHERE processed_at IS NULL;
ALTER TABLE public.stripe_events ALTER COLUMN processed_at SET DEFAULT now();
ALTER TABLE public.stripe_events ALTER COLUMN processed_at SET NOT NULL;

-- Revert payment_status: remove default and NOT NULL constraint added by R7
ALTER TABLE public.stripe_events ALTER COLUMN payment_status DROP DEFAULT;
ALTER TABLE public.stripe_events ALTER COLUMN payment_status DROP NOT NULL;

-- ============================================================
-- STEP 3: Restore get_user_tenant_id() EXECUTE grant (if revoked)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'get_user_tenant_id'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_user_tenant_id() TO authenticated';
    RAISE NOTICE 'Restored EXECUTE on get_user_tenant_id() to authenticated';
  END IF;
END $$;

COMMIT;

-- ============================================================
-- POST-ROLLBACK VERIFICATION QUERIES
-- Run these after applying to confirm correct state.
-- ============================================================

-- Verify RPCs are gone
SELECT proname FROM pg_proc
WHERE proname IN ('merge_stripe_payment_completed','merge_stripe_payment_status',
                  'claim_stripe_event','finalize_stripe_event','get_checkout_authorized_member')
  AND pronamespace = 'public'::regnamespace;
-- Expected: 0 rows

-- Verify stripe_events data preserved
SELECT COUNT(*) AS rows_preserved FROM public.stripe_events;
-- Expected: same count as logged in STEP 0 NOTICE above

-- Verify column contract reverted
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'stripe_events'
ORDER BY ordinal_position;
-- Expected:
--   payment_status  → nullable (YES), no default
--   processed_at    → NOT NULL (NO),  DEFAULT now()
--   claimed_at      → nullable (YES), no default  (column left in place; predecessor ignores it)
