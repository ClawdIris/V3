-- R6 hotfix 2: fix JWT fail-closed behavior in check_stripe_payment_write()
--
-- PROBLEM:
--   The current function body uses:
--     current_setting('request.jwt.claims', true)::json->>'role' != 'service_role'
--
--   When request.jwt.claims is absent/reset (direct psql, local dev, migration runners),
--   current_setting(..., true) returns '' (empty string, NOT NULL).
--   Casting '' to ::json throws: "invalid input syntax for type json"
--   This accidentally fails-closed (blocks the update) but with a misleading error
--   that obscures the real trigger intent.
--
--   MORE CRITICALLY: if the cast were made safe via COALESCE(NULLIF(...,''), '{}')::json,
--   the ->>'role' would return NULL, and:
--     NULL != 'service_role'  →  NULL  (not TRUE/FALSE)
--     IF NULL  →  condition is falsy  →  RAISE is skipped  →  FAIL-OPEN ❌
--
--   The NULL comparison pitfall means the safe-cast version would be fail-open.
--
-- FIX:
--   Use NULLIF to convert '' → NULL, then COALESCE to '{}' for safe JSON cast,
--   then extract role, then use IS DISTINCT FROM to handle NULL role safely.
--   IS DISTINCT FROM treats NULL as a distinct value from 'service_role' → always blocks
--   when the role is absent → fail-closed ✅.
--
-- BEHAVIOR TABLE:
--   JWT claims absent (local psql)  : role = NULL → NULL IS DISTINCT FROM 'service_role' = TRUE → BLOCK ✅
--   JWT claims = {"role":"authenticated"}: role = 'authenticated' → TRUE → BLOCK ✅
--   JWT claims = {"role":"service_role"}: role = 'service_role'  → FALSE → ALLOW ✅
--
-- DO NOT APPLY without Jefe approval.

CREATE OR REPLACE FUNCTION check_stripe_payment_write()
RETURNS TRIGGER AS $$
DECLARE
  _jwt_role text;
BEGIN
  -- Safely extract role from JWT claims; handles absent/empty/null claims
  _jwt_role := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::json->>'role';

  -- Block client-side 'paid' writes on Stripe-backed orders.
  -- Allows only when caller is explicitly service_role (webhook path).
  -- IS DISTINCT FROM ensures NULL role (no JWT) is treated as non-service-role → blocked.
  IF (NEW.data->>'stripe_session_id') IS NOT NULL
     AND (NEW.data->'payment'->>'status') = 'paid'
     AND _jwt_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Cannot set payment status to paid for Stripe orders via client — use webhook';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
