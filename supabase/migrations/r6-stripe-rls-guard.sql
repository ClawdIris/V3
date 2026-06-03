-- Block client-side payment_status='paid' when stripe_session_id is set
-- Stripe-backed orders can only become 'paid' via the webhook (service_role)
-- This policy supplements existing orders RLS — add as an additional check

-- For authenticated users updating orders: block setting payment_status='paid' 
-- when stripe_session_id is not null (those must go through webhook only)
-- Implementation: use a trigger or CHECK constraint

CREATE OR REPLACE FUNCTION check_stripe_payment_write()
RETURNS TRIGGER AS $$
BEGIN
  -- Block client-side 'paid' writes on Stripe-backed orders
  -- Only applies when: stripe_session_id is set in data JSONB AND
  --                    payment.status is being set to 'paid' AND
  --                    caller is NOT service_role
  -- NOTE: stripe_session_id and payment.status live inside the data JSONB column,
  -- not as top-level columns on the orders table.
  IF (NEW.data->>'stripe_session_id') IS NOT NULL
     AND (NEW.data->'payment'->>'status') = 'paid'
     AND current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' THEN
    RAISE EXCEPTION 'Cannot set payment status to paid for Stripe orders via client — use webhook';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS trg_check_stripe_payment ON orders;
CREATE TRIGGER trg_check_stripe_payment
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION check_stripe_payment_write();
