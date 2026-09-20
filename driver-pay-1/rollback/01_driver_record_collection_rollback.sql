-- DRIVER-PAY-1 rollback for 01_driver_record_collection.PROPOSAL.sql.
-- FILE-ONLY. Nothing has been applied, so nothing needs rolling back yet; this
-- exists so the proposal is reviewable as a complete change with its reverse.
--
-- WARNING: dropping driver_collection_events destroys the idempotency keys and
-- the append-only record of collected cash. A real rollback should EXPORT both
-- tables first. The owner must decide whether a rollback is permitted at all
-- once real money has been recorded (this is part of OPEN-D7).

BEGIN;

REVOKE EXECUTE ON FUNCTION public.driver_record_collection(TEXT, UUID, NUMERIC, TEXT, TEXT, TEXT) FROM authenticated;
DROP FUNCTION IF EXISTS public.driver_record_collection(TEXT, UUID, NUMERIC, TEXT, TEXT, TEXT);

-- Data-bearing tables are NOT dropped by default. Uncomment only with an
-- explicit owner decision and an export in hand.
-- DROP TABLE IF EXISTS public.driver_collection_audit;
-- DROP TABLE IF EXISTS public.driver_collection_events;

COMMIT;

-- Post-rollback proof. Expected: zero rows.
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'driver_record_collection';
