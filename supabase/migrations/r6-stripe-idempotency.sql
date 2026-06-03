-- Stripe webhook idempotency table
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,               -- Stripe event.id (e.g., evt_xxx)
  event_type TEXT NOT NULL,          -- e.g., checkout.session.completed
  order_id TEXT,
  tenant_id TEXT,
  payment_status TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_error TEXT                     -- if processing failed, log why
);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write stripe_events (webhook runs as service role)
CREATE POLICY "service_only" ON stripe_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Block all other roles including anon and authenticated
CREATE POLICY "block_others" ON stripe_events
  FOR ALL TO anon, authenticated USING (false);
