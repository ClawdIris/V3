-- R6 hotfix: correct check_stripe_payment_write() to use JSONB paths
-- Orders stores stripe_session_id and payment.status inside the data JSONB column
-- The original r6-stripe-rls-guard.sql incorrectly referenced NEW.stripe_session_id
-- and NEW.payment->>'status' as if they were top-level columns; they are not.

CREATE OR REPLACE FUNCTION check_stripe_payment_write()
RETURNS TRIGGER AS $$
BEGIN
  -- Block client-side 'paid' writes on Stripe-backed orders
  -- Only applies when: stripe_session_id is set in data JSONB AND
  --                    payment.status is being set to 'paid' AND
  --                    caller is NOT service_role
  IF (NEW.data->>'stripe_session_id') IS NOT NULL
     AND (NEW.data->'payment'->>'status') = 'paid'
     AND current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' THEN
    RAISE EXCEPTION 'Cannot set payment status to paid for Stripe orders via client — use webhook';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
