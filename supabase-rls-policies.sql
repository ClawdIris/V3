-- ═══════════════════════════════════════════════════════════════
-- CASABE V3 SUPABASE SCHEMA & RLS POLICIES
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- T2-002: IDEMPOTENCY KEYS TABLE
-- Prevents payment race conditions by deduplicating concurrent requests
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_key_user ON idempotency_keys(key, user_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);

-- RLS: Users can only check their own idempotency keys
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_can_read_own_idempotency_keys" ON idempotency_keys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_can_manage_idempotency_keys" ON idempotency_keys
  FOR ALL USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════
-- T2-004: COMMISSIONS TABLE WITH AUDIT TRAIL
-- Logs all commission calculations for audit and compliance
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  amount decimal(10, 2) NOT NULL,
  rate decimal(5, 4) NOT NULL,
  calculated_by text NOT NULL, -- 'system' or user_id
  calculation_method text NOT NULL, -- e.g., 'zone_based', 'volume_discount'
  before_amount decimal(10, 2), -- Previous amount (for updates)
  after_amount decimal(10, 2), -- Current amount
  timestamp timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb -- Additional context: zone_id, tier, etc.
);

CREATE INDEX IF NOT EXISTS idx_commissions_order_id ON commissions(order_id);
CREATE INDEX IF NOT EXISTS idx_commissions_payment_id ON commissions(payment_id);
CREATE INDEX IF NOT EXISTS idx_commissions_timestamp ON commissions(timestamp);

-- RLS: Admins can view all commission logs; users can view their own
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_can_view_all_commissions" ON commissions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

CREATE POLICY "users_can_view_own_commissions" ON commissions
  FOR SELECT USING (
    order_id IN (
      SELECT id FROM orders WHERE created_by = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- T2-003: ZONES TABLE (for zone validation)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  country text NOT NULL,
  region text,
  pricing_tier text NOT NULL,
  base_rate decimal(5, 4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_zones_name ON zones(name);
CREATE INDEX IF NOT EXISTS idx_zones_country ON zones(country);

-- RLS: Everyone can read zones (public pricing)
ALTER TABLE zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_can_read_zones" ON zones
  FOR SELECT USING (true);

-- ═══════════════════════════════════════════════════════════════
-- BASE TABLES (Orders, Payments, Users)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'user', -- 'user', 'admin', 'operator'
  tenant_id uuid,
  office text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  tenant_id uuid,
  customer_name text NOT NULL,
  phone text,
  address text,
  destination text NOT NULL,
  box_type text NOT NULL,
  declared_value decimal(10, 2),
  insurance boolean DEFAULT false,
  payment_status text DEFAULT 'pending', -- 'pending', 'paid', 'failed'
  payment_amount decimal(10, 2),
  payment_method text,
  safety_warning_acknowledged boolean DEFAULT false,
  status text DEFAULT 'order_placed',
  zone_id uuid REFERENCES zones(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_id ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_can_read_own_orders" ON orders
  FOR SELECT USING (created_by = auth.uid());

CREATE POLICY "users_can_create_orders" ON orders
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY "users_can_update_own_orders" ON orders
  FOR UPDATE USING (created_by = auth.uid());

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  amount decimal(10, 2) NOT NULL,
  method text NOT NULL, -- 'credit_card', 'bank_transfer', etc.
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'paid', 'failed'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_can_read_own_payments" ON payments
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "users_can_create_payments" ON payments
  FOR INSERT WITH CHECK (user_id = auth.uid());
