-- P0 Pack 1, final enforcement stage.
-- FILE-ONLY DRAFT. Apply only after:
--   1. driver_update_order_status is live,
--   2. the frontend switch is deployed and verified,
--   3. N1-N5 and N7-N13 pass against the RPC.
-- This closes direct driver PATCH access and retires the divergent legacy RPC.
-- Rollback: p0-pack1/rollback/02_enforce_rpc_only_rollback.sql

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.driver_update_order_status(text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'P0 Pack 1 enforcement blocked: new RPC is missing';
  END IF;
END;
$$;

DROP POLICY IF EXISTS orders_driver_update_assigned ON public.orders;

REVOKE EXECUTE ON FUNCTION public.update_driver_status(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_driver_status(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_driver_status(TEXT, TEXT) FROM authenticated;
DROP FUNCTION IF EXISTS public.update_driver_status(TEXT, TEXT);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'orders'
      AND policyname = 'orders_driver_update_assigned'
  ) THEN
    RAISE EXCEPTION 'P0 Pack 1 enforcement failed: broad driver policy remains';
  END IF;

  IF to_regprocedure('public.update_driver_status(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'P0 Pack 1 enforcement failed: legacy RPC remains';
  END IF;

  IF to_regprocedure('public.driver_update_order_status(text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'P0 Pack 1 enforcement failed: new RPC disappeared';
  END IF;
END;
$$;

COMMIT;

-- Post-commit proofs. Expected: first query 0 rows; second query one row.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'orders'
  AND policyname = 'orders_driver_update_assigned';

SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('update_driver_status', 'driver_update_order_status')
ORDER BY p.proname;
