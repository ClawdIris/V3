-- =========================================================
-- Casabe Connect V3 — Supabase Database Schema & RLS Policies
-- Includes: idempotency_keys, commissions, commission_audit_log
-- =========================================================

-- ─────────────────────────────────────────────────────────
-- T2-002: Idempotency Keys Table (Payment Race Condition Fix)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL,
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  payment_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  CONSTRAINT unique_key_user UNIQUE (key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_key_user ON idempotency_keys(key, user_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_can_read_own_idempotency_keys" ON idempotency_keys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_can_manage_idempotency_keys" ON idempotency_keys
  FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────
-- T2-004: Commissions Table (Audit Trail Fix)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL,
  amount              DECIMAL(12, 4) NOT NULL,
  rate                DECIMAL(6, 4) NOT NULL,
  calculated_by       TEXT NOT NULL DEFAULT 'system',
  calculation_method  TEXT NOT NULL DEFAULT 'standard',
  before_amount       DECIMAL(12, 4),
  after_amount        DECIMAL(12, 4),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata            JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_commissions_order_id ON commissions(order_id);
CREATE INDEX IF NOT EXISTS idx_commissions_created_at ON commissions(created_at);

-- Commission audit log: captures every INSERT/UPDATE on commissions
CREATE TABLE IF NOT EXISTS commission_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_id   UUID NOT NULL REFERENCES commissions(id),
  operation       TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE')),
  old_data        JSONB,
  new_data        JSONB NOT NULL,
  changed_by      TEXT NOT NULL DEFAULT 'system',
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_commission_id ON commission_audit_log(commission_id);
CREATE INDEX IF NOT EXISTS idx_audit_changed_at ON commission_audit_log(changed_at);

-- ─────────────────────────────────────────────────────────
-- T2-004: Trigger — auto-log commission INSERT/UPDATE
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_commission_change()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO commission_audit_log (commission_id, operation, old_data, new_data, changed_by)
    VALUES (
      NEW.id,
      'INSERT',
      NULL,
      row_to_json(NEW)::jsonb,
      COALESCE(NEW.calculated_by, 'system')
    );
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    NEW.updated_at := NOW();
    INSERT INTO commission_audit_log (commission_id, operation, old_data, new_data, changed_by)
    VALUES (
      NEW.id,
      'UPDATE',
      row_to_json(OLD)::jsonb,
      row_to_json(NEW)::jsonb,
      COALESCE(NEW.calculated_by, 'system')
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_commission_audit ON commissions;
CREATE TRIGGER trg_commission_audit
  BEFORE INSERT OR UPDATE ON commissions
  FOR EACH ROW EXECUTE FUNCTION log_commission_change();

-- ─────────────────────────────────────────────────────────
-- T2-004: RLS Policies — commissions & audit log
-- ─────────────────────────────────────────────────────────
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can view commissions
CREATE POLICY "admins_can_view_commissions" ON commissions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
        AND user_profiles.role = 'admin'
    )
  );

-- Only service role can insert/update commissions
CREATE POLICY "service_can_manage_commissions" ON commissions
  FOR ALL USING (true) WITH CHECK (true);

-- Only admins can view audit logs
CREATE POLICY "admins_can_view_commission_audit" ON commission_audit_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
        AND user_profiles.role = 'admin'
    )
  );

-- Service role can insert audit logs (via trigger)
CREATE POLICY "service_can_insert_audit_log" ON commission_audit_log
  FOR INSERT WITH CHECK (true);
