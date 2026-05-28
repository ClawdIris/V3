-- PHASE 6: SUPABASE SCHEMA EXTENSIONS
-- Heavy Deferred Work: Maps, Routes, Tape Direct, Cost Tracking
-- Executed after Phase 1 schema is in place

-- ============================================================================
-- PART 1: DRIVERS TABLE (New)
-- ============================================================================

CREATE TABLE drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  office_id UUID NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  vehicle_type TEXT CHECK (vehicle_type IN ('van', 'bike', 'car')),
  capacity INT DEFAULT 10,  -- boxes per trip
  current_lat DECIMAL(10, 8),
  current_lon DECIMAL(11, 8),
  last_update TIMESTAMP DEFAULT NOW(),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'offline', 'break')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_drivers_office_id ON drivers(office_id);
CREATE INDEX idx_drivers_user_id ON drivers(user_id);
CREATE INDEX idx_drivers_status ON drivers(status);
CREATE INDEX idx_drivers_coords ON drivers(current_lat, current_lon) WHERE status = 'active';

-- ============================================================================
-- PART 2: BOX_ORDERS EXTENSIONS (Geospatial + Tape Direct)
-- ============================================================================

-- Geospatial coordinates
ALTER TABLE box_orders
  ADD COLUMN IF NOT EXISTS delivery_lat DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS delivery_lon DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS pickup_lat DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS pickup_lon DECIMAL(11, 8);

-- Route optimization
ALTER TABLE box_orders
  ADD COLUMN IF NOT EXISTS pickup_sequence INT,
  ADD COLUMN IF NOT EXISTS route_optimization_id UUID,
  ADD COLUMN IF NOT EXISTS estimated_pickup_time TIMESTAMP,
  ADD COLUMN IF NOT EXISTS estimated_delivery_time TIMESTAMP;

-- Tape Direct order tracking
ALTER TABLE box_orders
  ADD COLUMN IF NOT EXISTS is_tape_direct BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tape_direct_vendor_id UUID,
  ADD COLUMN IF NOT EXISTS tape_direct_cost DECIMAL(8, 2),
  ADD COLUMN IF NOT EXISTS tape_direct_margin DECIMAL(8, 2);

-- Box sale tracking
ALTER TABLE box_orders
  ADD COLUMN IF NOT EXISTS box_sale_quantity INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS box_sale_unit_cost DECIMAL(8, 2),
  ADD COLUMN IF NOT EXISTS box_sale_unit_price DECIMAL(8, 2),
  ADD COLUMN IF NOT EXISTS box_sale_revenue DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS box_sale_margin DECIMAL(10, 2);

-- Create indexes for Phase 6 queries
CREATE INDEX IF NOT EXISTS idx_box_orders_delivery_coords 
  ON box_orders(delivery_lat, delivery_lon) 
  WHERE delivery_lat IS NOT NULL AND delivery_lon IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_box_orders_pickup_coords 
  ON box_orders(pickup_lat, pickup_lon) 
  WHERE pickup_lat IS NOT NULL AND pickup_lon IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_box_orders_driver_sequence 
  ON box_orders(driver_id, pickup_sequence) 
  WHERE pickup_sequence IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_box_orders_tape_direct 
  ON box_orders(office_id, is_tape_direct, created_at) 
  WHERE is_tape_direct = TRUE;

CREATE INDEX IF NOT EXISTS idx_box_orders_box_sale 
  ON box_orders(office_id, box_sale_quantity, created_at) 
  WHERE box_sale_quantity > 0;

CREATE INDEX IF NOT EXISTS idx_box_orders_route_optimization 
  ON box_orders(route_optimization_id);

-- ============================================================================
-- PART 3: TAPE DIRECT COSTS TABLE (New)
-- ============================================================================

CREATE TABLE tape_direct_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id UUID NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  vendor_name TEXT NOT NULL,
  vendor_id UUID,
  unit_cost DECIMAL(8, 2) NOT NULL,
  per_stop_cost DECIMAL(8, 2),
  description TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tape_direct_costs_office ON tape_direct_costs(office_id);
CREATE INDEX idx_tape_direct_costs_vendor ON tape_direct_costs(vendor_id);
CREATE INDEX idx_tape_direct_costs_active ON tape_direct_costs(office_id, active);

-- ============================================================================
-- PART 4: BOX SALE COSTS TABLE (New)
-- ============================================================================

CREATE TABLE box_sale_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id UUID NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  box_type TEXT NOT NULL,  -- '10x10x10', '12x12x12', 'custom', etc.
  unit_cost DECIMAL(8, 2) NOT NULL,
  vendor TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_box_sale_costs_office ON box_sale_costs(office_id);
CREATE INDEX idx_box_sale_costs_type ON box_sale_costs(office_id, box_type);

-- ============================================================================
-- PART 5: BOX SALE TRANSACTIONS TABLE (New - Audit Trail)
-- ============================================================================

CREATE TABLE box_sale_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id UUID NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  box_order_id UUID REFERENCES box_orders(id) ON DELETE SET NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(8, 2) NOT NULL,
  total_revenue DECIMAL(10, 2) NOT NULL,
  unit_cost DECIMAL(8, 2) NOT NULL,
  total_cost DECIMAL(10, 2) NOT NULL,
  margin DECIMAL(10, 2) GENERATED ALWAYS AS (total_revenue - total_cost) STORED,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_box_sale_transactions_office ON box_sale_transactions(office_id);
CREATE INDEX idx_box_sale_transactions_order ON box_sale_transactions(order_id);
CREATE INDEX idx_box_sale_transactions_box_order ON box_sale_transactions(box_order_id);
CREATE INDEX idx_box_sale_transactions_date ON box_sale_transactions(office_id, created_at);

-- ============================================================================
-- PART 6: MESSAGES TABLE (New - SMS/WhatsApp Tracking)
-- ============================================================================

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id UUID REFERENCES offices(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  box_order_id UUID REFERENCES box_orders(id) ON DELETE SET NULL,
  recipient_phone TEXT NOT NULL,
  recipient_email TEXT,
  template_id TEXT,
  message_body TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email')),
  provider TEXT NOT NULL DEFAULT 'twilio',
  provider_message_id TEXT,
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  error_code TEXT,
  error_message TEXT,
  metadata JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_office ON messages(office_id);
CREATE INDEX idx_messages_order ON messages(order_id);
CREATE INDEX idx_messages_box_order ON messages(box_order_id);
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_created_at ON messages(office_id, created_at);
CREATE INDEX idx_messages_provider_id ON messages(provider_message_id);

-- ============================================================================
-- PART 7: ROUTE OPTIMIZATIONS TABLE (New - Audit Trail)
-- ============================================================================

CREATE TABLE route_optimizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id UUID NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL CHECK (algorithm IN ('greedy', 'or-tools', 'concorde')),
  total_distance_km DECIMAL(8, 2),
  estimated_time_minutes INT,
  orders_assigned INT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_route_optimizations_driver ON route_optimizations(driver_id);
CREATE INDEX idx_route_optimizations_office ON route_optimizations(office_id);
CREATE INDEX idx_route_optimizations_date ON route_optimizations(office_id, created_at);

-- ============================================================================
-- PART 8: RLS POLICIES (Phase 6 Tables)
-- ============================================================================

-- Enable RLS on all new tables
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tape_direct_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE box_sale_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE box_sale_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_optimizations ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- DRIVERS TABLE POLICIES
-- ============================================================================

-- HQ: Can see all drivers in their office
CREATE POLICY hq_drivers_select ON drivers
  FOR SELECT
  USING (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  );

-- HQ: Can insert drivers
CREATE POLICY hq_drivers_insert ON drivers
  FOR INSERT
  WITH CHECK (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  );

-- HQ: Can update drivers
CREATE POLICY hq_drivers_update ON drivers
  FOR UPDATE
  USING (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  )
  WITH CHECK (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  );

-- Driver: Can see their own record
CREATE POLICY driver_drivers_select ON drivers
  FOR SELECT
  USING (
    user_id = auth.uid() AND
    get_user_role(auth.uid()) = 'driver'
  );

-- Office Manager: Can see drivers in their office
CREATE POLICY office_drivers_select ON drivers
  FOR SELECT
  USING (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'office'
  );

-- ============================================================================
-- MESSAGES TABLE POLICIES
-- ============================================================================

-- HQ: Can see all messages in their office
CREATE POLICY hq_messages_select ON messages
  FOR SELECT
  USING (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  );

-- HQ: Can insert messages
CREATE POLICY hq_messages_insert ON messages
  FOR INSERT
  WITH CHECK (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  );

-- Office Manager: Can see messages for their office
CREATE POLICY office_messages_select ON messages
  FOR SELECT
  USING (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'office'
  );

-- ============================================================================
-- BOX SALE TRANSACTIONS POLICIES
-- ============================================================================

-- HQ: Can see all transactions in their office
CREATE POLICY hq_box_sale_select ON box_sale_transactions
  FOR SELECT
  USING (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  );

-- HQ: Can insert transactions
CREATE POLICY hq_box_sale_insert ON box_sale_transactions
  FOR INSERT
  WITH CHECK (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  );

-- Office Manager: Can see transactions for their office
CREATE POLICY office_box_sale_select ON box_sale_transactions
  FOR SELECT
  USING (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'office'
  );

-- ============================================================================
-- TAPE DIRECT COSTS POLICIES
-- ============================================================================

-- HQ: Can see all tape direct costs
CREATE POLICY hq_tape_direct_costs_select ON tape_direct_costs
  FOR SELECT
  USING (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  );

-- HQ: Can manage tape direct costs
CREATE POLICY hq_tape_direct_costs_insert ON tape_direct_costs
  FOR INSERT
  WITH CHECK (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  );

CREATE POLICY hq_tape_direct_costs_update ON tape_direct_costs
  FOR UPDATE
  USING (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  );

-- ============================================================================
-- BOX SALE COSTS POLICIES
-- ============================================================================

-- HQ: Can see and manage box sale costs
CREATE POLICY hq_box_sale_costs_select ON box_sale_costs
  FOR SELECT
  USING (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  );

CREATE POLICY hq_box_sale_costs_insert ON box_sale_costs
  FOR INSERT
  WITH CHECK (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  );

-- ============================================================================
-- ROUTE OPTIMIZATIONS POLICIES
-- ============================================================================

-- HQ: Can see all optimizations
CREATE POLICY hq_route_optimizations_select ON route_optimizations
  FOR SELECT
  USING (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  );

-- HQ: Can insert optimizations
CREATE POLICY hq_route_optimizations_insert ON route_optimizations
  FOR INSERT
  WITH CHECK (
    office_id = ANY(get_user_office_ids(auth.uid())) AND
    get_user_role(auth.uid()) = 'hq'
  );

-- ============================================================================
-- PART 9: HELPER FUNCTIONS
-- ============================================================================

-- Get active orders for a driver (used in route optimization)
CREATE OR REPLACE FUNCTION get_active_orders_for_driver(
  p_driver_id UUID,
  p_office_id UUID
)
RETURNS TABLE (
  id UUID,
  order_id UUID,
  box_number INT,
  status TEXT,
  delivery_lat DECIMAL,
  delivery_lon DECIMAL,
  delivery_address TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    bo.id,
    bo.order_id,
    bo.box_number,
    bo.status,
    bo.delivery_lat,
    bo.delivery_lon,
    o.delivery_address
  FROM box_orders bo
  LEFT JOIN orders o ON bo.order_id = o.id
  WHERE
    bo.driver_id = p_driver_id
    AND bo.office_id = p_office_id
    AND bo.status IN ('READY', 'PICKED_UP', 'IN_TRANSIT')
  ORDER BY bo.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Calculate margin for tape direct order
CREATE OR REPLACE FUNCTION calculate_tape_direct_margin(
  p_box_order_id UUID
)
RETURNS DECIMAL AS $$
DECLARE
  v_revenue DECIMAL;
  v_cost DECIMAL;
BEGIN
  SELECT box_sale_revenue INTO v_revenue
  FROM box_orders
  WHERE id = p_box_order_id;

  SELECT unit_cost INTO v_cost
  FROM tape_direct_costs tdc
  JOIN box_orders bo ON bo.tape_direct_vendor_id = tdc.id
  WHERE bo.id = p_box_order_id;

  RETURN COALESCE(v_revenue, 0) - COALESCE(v_cost, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Calculate box sale margin
CREATE OR REPLACE FUNCTION calculate_box_sale_margin(
  p_quantity INT,
  p_unit_price DECIMAL,
  p_unit_cost DECIMAL
)
RETURNS DECIMAL AS $$
BEGIN
  RETURN (p_quantity * p_unit_price) - (p_quantity * p_unit_cost);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- PART 10: TRIGGERS
-- ============================================================================

-- Update updated_at timestamp for drivers
CREATE OR REPLACE FUNCTION update_drivers_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER drivers_update_timestamp
BEFORE UPDATE ON drivers
FOR EACH ROW
EXECUTE FUNCTION update_drivers_timestamp();

-- Update updated_at timestamp for messages
CREATE OR REPLACE FUNCTION update_messages_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_update_timestamp
BEFORE UPDATE ON messages
FOR EACH ROW
EXECUTE FUNCTION update_messages_timestamp();

-- Validate geospatial coordinates
CREATE OR REPLACE FUNCTION validate_coordinates()
RETURNS TRIGGER AS $$
BEGIN
  -- Validate latitude (-90 to 90)
  IF NEW.delivery_lat IS NOT NULL THEN
    IF NEW.delivery_lat < -90 OR NEW.delivery_lat > 90 THEN
      RAISE EXCEPTION 'Invalid latitude: %', NEW.delivery_lat;
    END IF;
  END IF;

  -- Validate longitude (-180 to 180)
  IF NEW.delivery_lon IS NOT NULL THEN
    IF NEW.delivery_lon < -180 OR NEW.delivery_lon > 180 THEN
      RAISE EXCEPTION 'Invalid longitude: %', NEW.delivery_lon;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER box_orders_validate_coords
BEFORE INSERT OR UPDATE ON box_orders
FOR EACH ROW
EXECUTE FUNCTION validate_coordinates();

-- ============================================================================
-- PART 11: VIEWS (For Reporting)
-- ============================================================================

-- Tape Direct Margin Summary
CREATE OR REPLACE VIEW tape_direct_margin_summary AS
SELECT
  bo.office_id,
  DATE(ao.created_at)::DATE as order_date,
  bo.tape_direct_vendor_id,
  tdc.vendor_name,
  COUNT(bo.id) as order_count,
  SUM(bo.tape_direct_cost) as total_cost,
  SUM(COALESCE(bo.box_sale_revenue, 0)) as total_revenue,
  SUM(COALESCE(bo.box_sale_revenue, 0) - bo.tape_direct_cost) as total_margin,
  ROUND(
    100.0 * (SUM(COALESCE(bo.box_sale_revenue, 0) - bo.tape_direct_cost) / 
             NULLIF(SUM(COALESCE(bo.box_sale_revenue, 0)), 0)),
    2
  ) as margin_percent
FROM box_orders bo
LEFT JOIN activity_log ao ON bo.order_id = ao.order_id
LEFT JOIN tape_direct_costs tdc ON bo.tape_direct_vendor_id = tdc.id
WHERE bo.is_tape_direct = TRUE AND bo.status = 'COMPLETED'
GROUP BY bo.office_id, DATE(ao.created_at), bo.tape_direct_vendor_id, tdc.vendor_name;

-- Box Sale Margin Summary
CREATE OR REPLACE VIEW box_sale_margin_summary AS
SELECT
  office_id,
  COUNT(DISTINCT order_id) as sale_count,
  SUM(box_sale_quantity) as total_boxes_sold,
  SUM(box_sale_revenue) as total_revenue,
  SUM(box_sale_quantity * box_sale_unit_cost) as total_cost,
  SUM(box_sale_revenue) - SUM(box_sale_quantity * box_sale_unit_cost) as total_margin,
  ROUND(
    100.0 * (SUM(box_sale_revenue) - SUM(box_sale_quantity * box_sale_unit_cost)) /
    NULLIF(SUM(box_sale_revenue), 0),
    2
  ) as margin_percent,
  AVG(box_sale_unit_cost) as avg_cost_per_unit,
  AVG(box_sale_unit_price) as avg_price_per_unit
FROM box_orders
WHERE box_sale_quantity > 0
GROUP BY office_id;

-- Active Driver Status
CREATE OR REPLACE VIEW active_driver_status AS
SELECT
  d.id,
  d.name,
  d.office_id,
  d.current_lat,
  d.current_lon,
  d.status,
  d.last_update,
  COUNT(bo.id) FILTER (WHERE bo.status IN ('READY', 'PICKED_UP')) as assigned_count,
  COUNT(bo.id) FILTER (WHERE bo.status IN ('PICKED_UP', 'IN_TRANSIT')) as active_count
FROM drivers d
LEFT JOIN box_orders bo ON d.id = bo.driver_id
WHERE d.status = 'active'
GROUP BY d.id, d.name, d.office_id, d.current_lat, d.current_lon, d.status, d.last_update;

-- ============================================================================
-- PART 12: GRANTS (Phase 6)
-- ============================================================================

-- Grant SELECT on views to authenticated users
GRANT SELECT ON tape_direct_margin_summary TO authenticated;
GRANT SELECT ON box_sale_margin_summary TO authenticated;
GRANT SELECT ON active_driver_status TO authenticated;

-- Grant EXECUTE on helper functions
GRANT EXECUTE ON FUNCTION get_active_orders_for_driver TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_tape_direct_margin TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_box_sale_margin TO authenticated;

-- ============================================================================
-- END OF PHASE 6 SCHEMA EXTENSIONS
-- ============================================================================
