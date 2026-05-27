-- ═══════════════════════════════════════════════════════════════════
-- PHASE 1: DATA FOUNDATIONS - Casabe Konnect R4
-- ═══════════════════════════════════════════════════════════════════
--
-- This script adds essential data schema for Phase 1:
-- 1. Add pickup_location field to orders table
-- 2. Create box_orders table (normalized box data)
-- 3. Create activity_log table (comprehensive activity tracking)
-- 4. Implement RLS policies for all roles (HQ, Office, Driver, anon)
-- 5. Create indexes for performance
--
-- Execution: psql -h [HOST] -U [USER] -d [DATABASE] -f phase1-data-schema.sql
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- MIGRATION 1: Add pickup_location to orders
-- ─────────────────────────────────────────────────────────
-- Tracks whether pickup happens at office or client location
-- Values: 'office' | 'client_house' | NULL (legacy)

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS pickup_location TEXT
  CHECK (pickup_location IN ('office', 'client_house') OR pickup_location IS NULL);

CREATE INDEX IF NOT EXISTS idx_orders_pickup_location ON orders(pickup_location);

COMMENT ON COLUMN orders.pickup_location IS
  'Pickup location type: office (standard office pickup) or client_house (pickup at customer location)';


-- ─────────────────────────────────────────────────────────
-- TABLE 2: box_orders - Normalized Box Data
-- ─────────────────────────────────────────────────────────
-- Purpose: Separate box-level data from order-level data
--   - Enables box-specific tracking (status, dimensions, weight)
--   - Supports box-to-box commission calculations
--   - Facilitates bulk scanning and label printing
--   - Provides granular activity logging
--
-- Relationships:
--   - order_id FK → orders(id)
--   - office_id FK → offices(id)
--   - driver_id FK → user_profiles(user_id)

CREATE TABLE IF NOT EXISTS box_orders (
  -- Identifiers
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  box_number            INTEGER NOT NULL,  -- Sequence within order (1-based)

  -- Office & Driver Assignment
  office_id             UUID,  -- Nullable: unassigned until routed
  driver_id             UUID,  -- Nullable: unassigned until picked up

  -- Box Specification
  box_type              TEXT NOT NULL DEFAULT 'standard',
    -- Options: 'small', 'medium', 'large', 'oversized', 'custom'
  dimensions            JSONB,  -- { "length": 12, "width": 8, "height": 6, "unit": "in" }
  weight_lbs            DECIMAL(8, 2),  -- Nullable: weight optional at creation

  -- Status & Lifecycle
  status                TEXT NOT NULL DEFAULT 'created',
    -- Workflow: created → assigned → picked_up → in_transit → delivered → completed
    -- Or: created → assigned → scanned → held → ... → delivered
  status_updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_updated_by     UUID,  -- User who last changed status

  -- Tracking
  label_printed_at      TIMESTAMPTZ,
  label_printed_by      UUID,
  barcode               TEXT UNIQUE,  -- Unique barcode for scanning
  scanned_at            TIMESTAMPTZ,
  scanned_by            UUID,

  -- Delivery
  delivered_at          TIMESTAMPTZ,
  delivered_by          UUID,
  signature_url         TEXT,  -- URL to signature image (if required)
  delivery_notes        TEXT,

  -- Audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID NOT NULL,  -- User who created box entry
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            UUID,  -- User who last modified

  -- Metadata
  metadata              JSONB DEFAULT '{}'::jsonb,  -- Additional box-specific data

  CONSTRAINT box_number_per_order UNIQUE (order_id, box_number),
  CONSTRAINT valid_status CHECK (
    status IN ('created', 'assigned', 'picked_up', 'in_transit', 'scanned', 'held', 'delivered', 'completed', 'failed', 'returned')
  )
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_box_orders_order_id ON box_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_box_orders_office_id ON box_orders(office_id);
CREATE INDEX IF NOT EXISTS idx_box_orders_driver_id ON box_orders(driver_id);
CREATE INDEX IF NOT EXISTS idx_box_orders_status ON box_orders(status);
CREATE INDEX IF NOT EXISTS idx_box_orders_barcode ON box_orders(barcode);
CREATE INDEX IF NOT EXISTS idx_box_orders_created_at ON box_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_box_orders_status_updated_at ON box_orders(status_updated_at);

-- Composite index for common filters
CREATE INDEX IF NOT EXISTS idx_box_orders_driver_status ON box_orders(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_box_orders_office_status ON box_orders(office_id, status);

-- Full-text search on barcode & delivery notes (if using search)
-- CREATE INDEX IF NOT EXISTS idx_box_orders_search ON box_orders
--   USING GIN(to_tsvector('english', barcode || ' ' || COALESCE(delivery_notes, '')));

COMMENT ON TABLE box_orders IS
  'Normalized box-level data. Separates box operations from order-level operations.';
COMMENT ON COLUMN box_orders.status IS
  'Box lifecycle status: created, assigned, picked_up, in_transit, scanned, held, delivered, completed, failed, returned';
COMMENT ON COLUMN box_orders.metadata IS
  'JSON object for box-specific extensible data (e.g., {"fragile": true, "requires_signature": false})';


-- ─────────────────────────────────────────────────────────
-- TABLE 3: activity_log - Comprehensive Activity Tracking
-- ─────────────────────────────────────────────────────────
-- Purpose: Immutable ledger of all system activities
--   - Track user actions (order creation, box scanning, status changes)
--   - Audit trail for compliance
--   - Rebuild state from activity log (event sourcing capable)
--   - Role-based visibility (HQ sees all, Office sees own, Driver sees assigned)
--
-- Activity Types: order_created, order_updated, box_created, box_scanned,
--                 status_changed, invoice_sent, payment_received, etc.

CREATE TABLE IF NOT EXISTS activity_log (
  -- Identifiers
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Context
  tenant_id             UUID NOT NULL,  -- Multi-tenant isolation
  order_id              UUID,  -- Related order (if any)
  box_id                UUID REFERENCES box_orders(id) ON DELETE SET NULL,  -- Related box (if any)
  user_id               UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- User who triggered action

  -- Activity Details
  activity_type         TEXT NOT NULL,  -- 'order_created', 'box_scanned', 'status_changed', etc.
  action                TEXT NOT NULL,  -- 'create', 'update', 'delete', 'scan', 'assign'
  resource_type         TEXT NOT NULL,  -- 'order', 'box', 'invoice', 'payment'

  -- Description for UI display
  description           TEXT NOT NULL,  -- Human-readable summary

  -- Change Data
  old_data              JSONB,  -- Previous state (for updates)
  new_data              JSONB,  -- Current state (for updates) or full data (for creates)

  -- Context/Metadata
  ip_address            INET,
  user_agent            TEXT,
  request_id            UUID,  -- Trace ID for correlating related activities
  metadata              JSONB DEFAULT '{}'::jsonb,  -- Additional context

  -- Timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Indexes optimize queries
  CONSTRAINT valid_activity CHECK (
    activity_type IN (
      'order_created', 'order_updated', 'order_deleted', 'order_assigned',
      'box_created', 'box_updated', 'box_deleted', 'box_scanned', 'box_assigned',
      'status_changed', 'invoice_created', 'invoice_sent', 'payment_received',
      'user_login', 'user_logout', 'permissions_changed', 'settings_updated',
      'system_event', 'error', 'warning'
    )
  ),
  CONSTRAINT valid_action CHECK (action IN ('create', 'read', 'update', 'delete', 'scan', 'assign', 'send', 'receive')),
  CONSTRAINT valid_resource CHECK (
    resource_type IN ('order', 'box', 'invoice', 'payment', 'user', 'office', 'settings', 'system')
  )
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_activity_log_tenant_id ON activity_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_order_id ON activity_log(order_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_box_id ON activity_log(box_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_activity_type ON activity_log(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_resource_type ON activity_log(resource_type);

-- Composite indexes for common filter combinations
CREATE INDEX IF NOT EXISTS idx_activity_log_order_type ON activity_log(order_id, activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_type ON activity_log(user_id, activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_log_tenant_created ON activity_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_request_id ON activity_log(request_id) WHERE request_id IS NOT NULL;

-- Partition by month for large-scale deployments (optional)
-- CREATE TABLE activity_log_2024_05 PARTITION OF activity_log
--   FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');

COMMENT ON TABLE activity_log IS
  'Immutable append-only activity ledger. Enables audit trails, compliance reporting, and event sourcing.';
COMMENT ON COLUMN activity_log.activity_type IS
  'Type of activity: order_created, order_updated, box_scanned, status_changed, invoice_sent, etc.';
COMMENT ON COLUMN activity_log.old_data IS
  'JSON snapshot of state before change (NULL for creates, SET for updates)';
COMMENT ON COLUMN activity_log.new_data IS
  'JSON snapshot of state after change (or full data for creates)';
COMMENT ON COLUMN activity_log.request_id IS
  'Unique request ID for correlating related activities in a single operation';


-- ═════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ═════════════════════════════════════════════════════════════════════
--
-- Four roles with different data access:
--   HQ (admin)        → View all data (no filters)
--   Office (manager)  → View own office + assigned boxes/orders
--   Driver            → View assigned boxes/orders only
--   Anonymous (guest) → No access (blocked by default)
--
-- Role determination: user_profiles.role field (or can extend via permissions table)
--

-- Enable RLS on new tables
ALTER TABLE box_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────
-- HELPER FUNCTION: Get current user role
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role FROM user_profiles
  WHERE user_id = auth.uid()
  LIMIT 1;
  RETURN COALESCE(user_role, 'anonymous');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────
-- HELPER FUNCTION: Get user's office IDs (for filtering)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_user_office_ids()
RETURNS UUID[] AS $$
BEGIN
  -- Returns array of office IDs user has access to
  -- For 'office' role, their assigned office_id
  -- For 'admin', empty array (means filter not applied)
  RETURN ARRAY(
    SELECT office_id FROM user_profiles
    WHERE user_id = auth.uid() AND office_id IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════════════════════════════════════════════════════════════
-- RLS POLICIES: box_orders Table
-- ════════════════════════════════════════════════════════════════════

-- HQ (admins) can view all boxes
CREATE POLICY "hq_can_view_all_boxes" ON box_orders
  FOR SELECT
  USING (
    get_user_role() = 'admin'
  );

-- Office managers can view boxes in their office
CREATE POLICY "office_can_view_own_office_boxes" ON box_orders
  FOR SELECT
  USING (
    get_user_role() = 'office'
    AND office_id = ANY(get_user_office_ids())
  );

-- Drivers can view boxes assigned to them
CREATE POLICY "driver_can_view_assigned_boxes" ON box_orders
  FOR SELECT
  USING (
    get_user_role() = 'driver'
    AND driver_id = auth.uid()
  );

-- Office managers can create boxes in their office
CREATE POLICY "office_can_create_boxes" ON box_orders
  FOR INSERT
  WITH CHECK (
    get_user_role() = 'office'
    AND office_id = ANY(get_user_office_ids())
  );

-- HQ can create boxes anywhere
CREATE POLICY "hq_can_create_boxes" ON box_orders
  FOR INSERT
  WITH CHECK (
    get_user_role() = 'admin'
  );

-- Office managers can update boxes in their office
CREATE POLICY "office_can_update_own_boxes" ON box_orders
  FOR UPDATE
  USING (
    get_user_role() = 'office'
    AND office_id = ANY(get_user_office_ids())
  )
  WITH CHECK (
    get_user_role() = 'office'
    AND office_id = ANY(get_user_office_ids())
  );

-- Drivers can update their assigned boxes (status, scanned, etc.)
CREATE POLICY "driver_can_update_assigned_boxes" ON box_orders
  FOR UPDATE
  USING (
    get_user_role() = 'driver'
    AND driver_id = auth.uid()
  )
  WITH CHECK (
    get_user_role() = 'driver'
    AND driver_id = auth.uid()
  );

-- HQ can update any box
CREATE POLICY "hq_can_update_all_boxes" ON box_orders
  FOR UPDATE
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- Deny DELETE for all roles (keep audit trail)
CREATE POLICY "deny_box_delete" ON box_orders
  FOR DELETE
  USING (FALSE);


-- ════════════════════════════════════════════════════════════════════
-- RLS POLICIES: activity_log Table
-- ════════════════════════════════════════════════════════════════════

-- HQ can view all activities (entire tenant)
CREATE POLICY "hq_can_view_all_activities" ON activity_log
  FOR SELECT
  USING (
    get_user_role() = 'admin'
  );

-- Office managers can view activities for their office
CREATE POLICY "office_can_view_office_activities" ON activity_log
  FOR SELECT
  USING (
    get_user_role() = 'office'
    -- View activities related to orders/boxes in their office
    AND (
      -- Activities on boxes assigned to their office
      (resource_type = 'box' AND box_id IN (
        SELECT id FROM box_orders WHERE office_id = ANY(get_user_office_ids())
      ))
      OR
      -- Activities on orders assigned to their office
      (resource_type = 'order' AND order_id IN (
        SELECT id FROM orders WHERE office_id = ANY(get_user_office_ids())
      ))
      OR
      -- User is the one who created the activity
      (user_id = auth.uid())
    )
  );

-- Drivers can view activities related to their assigned boxes
CREATE POLICY "driver_can_view_assigned_activities" ON activity_log
  FOR SELECT
  USING (
    get_user_role() = 'driver'
    AND (
      -- Activities on boxes assigned to them
      (resource_type = 'box' AND box_id IN (
        SELECT id FROM box_orders WHERE driver_id = auth.uid()
      ))
      OR
      -- Activities they created
      (user_id = auth.uid())
    )
  );

-- All authenticated users can create activity logs
CREATE POLICY "authenticated_can_insert_activities" ON activity_log
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Prevent updates to activity log (immutable)
CREATE POLICY "deny_activity_update" ON activity_log
  FOR UPDATE
  USING (FALSE);

-- Prevent deletes from activity log (immutable)
CREATE POLICY "deny_activity_delete" ON activity_log
  FOR DELETE
  USING (FALSE);


-- ═════════════════════════════════════════════════════════════════════
-- GRANT PERMISSIONS
-- ═════════════════════════════════════════════════════════════════════

-- Grant authenticated role access (RLS policies control what they see)
GRANT SELECT, INSERT, UPDATE ON box_orders TO authenticated;
GRANT SELECT, INSERT ON activity_log TO authenticated;

-- Grant anonymous read-only access to public data (via RLS)
-- GRANT SELECT ON box_orders TO anon;
-- GRANT SELECT ON activity_log TO anon;

-- Service role (for application backend) has full access
GRANT ALL ON box_orders TO service_role;
GRANT ALL ON activity_log TO service_role;


-- ═════════════════════════════════════════════════════════════════════
-- VERIFICATION & TESTING NOTES
-- ═════════════════════════════════════════════════════════════════════
--
-- After running this script, verify with:
--
-- 1. Column added to orders:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'orders' AND column_name = 'pickup_location';
--
-- 2. New tables exist:
--    SELECT tablename FROM pg_tables
--    WHERE tablename IN ('box_orders', 'activity_log');
--
-- 3. RLS is enabled:
--    SELECT tablename, rowsecurity FROM pg_tables
--    WHERE tablename IN ('box_orders', 'activity_log');
--
-- 4. Test HQ role (should see all):
--    SET ROLE authenticated;
--    SET jwt.claims.sub = '[HQ_USER_UUID]';
--    SELECT COUNT(*) FROM box_orders;  -- Should return all rows
--
-- 5. Test Office role (should see only own office):
--    SET ROLE authenticated;
--    SET jwt.claims.sub = '[OFFICE_USER_UUID]';
--    SELECT COUNT(*) FROM box_orders;  -- Should filter by office_id
--
-- 6. Test Driver role (should see only assigned):
--    SET ROLE authenticated;
--    SET jwt.claims.sub = '[DRIVER_USER_UUID]';
--    SELECT COUNT(*) FROM box_orders;  -- Should filter by driver_id
--
-- ═════════════════════════════════════════════════════════════════════
