-- P0 Pack 1 stage 1 rollback.
-- Safe while the legacy update_driver_status RPC and direct driver UPDATE
-- policy still exist. If the frontend has already switched, restore the prior
-- frontend before running this rollback.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.driver_update_order_status(TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.driver_update_order_status(TEXT, TEXT, TEXT, TEXT, TEXT);

COMMIT;

SELECT to_regprocedure('public.driver_update_order_status(text,text,text,text,text)')
  AS expected_null;
