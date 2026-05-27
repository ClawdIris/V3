-- ═══════════════════════════════════════════════════════════════════
-- PHASE 4: HQ UNIFIED TABS — SUPABASE QUERIES
-- ═══════════════════════════════════════════════════════════════════
-- 
-- These are the exact SQL queries used by the HQ dashboard.
-- Copy these into your SupabaseQueries service (JavaScript version provided separately).
-- 
-- Execution via: supabase.from('table').select(...).filter(...)
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- PICKUP TAB: Get all ASSIGNED orders
-- ─────────────────────────────────────────────────────────
-- Purpose: Show orders waiting for driver pickup
-- Filters: office_id, driver_id, date_from, date_to
-- Order: created_at DESC (newest first)

SELECT 
  bo.id,
  bo.order_id,
  bo.box_number,
  bo.status,
  bo.driver_id,
  bo.office_id,
  bo.barcode,
  bo.weight_lbs,
  bo.created_at,
  bo.updated_at,
  o.id as order_id_full,
  o.customer_name,
  o.recipient_name,
  o.pickup_location
FROM box_orders bo
JOIN orders o ON bo.order_id = o.id
WHERE 
  bo.status = 'assigned'
  AND (${office_id}::uuid IS NULL OR bo.office_id = ${office_id}::uuid)
  AND (${driver_id}::uuid IS NULL OR bo.driver_id = ${driver_id}::uuid)
  AND (${date_from}::timestamptz IS NULL OR bo.created_at >= ${date_from}::timestamptz)
  AND (${date_to}::timestamptz IS NULL OR bo.created_at <= ${date_to}::timestamptz)
ORDER BY bo.created_at DESC
LIMIT 100;

-- ─────────────────────────────────────────────────────────
-- DROPOFF TAB: Get all PICKED_UP + IN_TRANSIT orders
-- ─────────────────────────────────────────────────────────
-- Purpose: Live tracking of orders in transit
-- Filters: office_id, driver_id, date_from, date_to
-- Order: status_updated_at DESC (most recent updates first)

SELECT 
  bo.id,
  bo.order_id,
  bo.box_number,
  bo.status,
  bo.driver_id,
  bo.office_id,
  bo.created_at,
  bo.status_updated_at,
  o.id as order_id_full,
  o.customer_name,
  o.recipient_name,
  o.recipient_address,
  o.recipient_phone,
  up.full_name as driver_name,
  up.phone as driver_phone
FROM box_orders bo
JOIN orders o ON bo.order_id = o.id
LEFT JOIN user_profiles up ON bo.driver_id = up.user_id
WHERE 
  bo.status IN ('picked_up', 'in_transit')
  AND (${office_id}::uuid IS NULL OR bo.office_id = ${office_id}::uuid)
  AND (${driver_id}::uuid IS NULL OR bo.driver_id = ${driver_id}::uuid)
  AND (${date_from}::timestamptz IS NULL OR bo.created_at >= ${date_from}::timestamptz)
  AND (${date_to}::timestamptz IS NULL OR bo.created_at <= ${date_to}::timestamptz)
ORDER BY bo.status_updated_at DESC
LIMIT 100;

-- ─────────────────────────────────────────────────────────
-- COMPLETED TAB: Get all DELIVERED + COMPLETED orders (aggregated)
-- ─────────────────────────────────────────────────────────
-- Purpose: Shipment history with payment status
-- Filters: office_id, driver_id, payment_status, date_from, date_to
-- Order: updated_at DESC (newest deliveries first)
-- Pagination: OFFSET/LIMIT for table display

SELECT 
  o.id,
  o.customer_name,
  o.recipient_name,
  o.recipient_address,
  o.pickup_location,
  o.payment_status,
  o.created_at,
  o.updated_at,
  COUNT(bo.id) as box_count,
  SUM(bo.weight_lbs) as total_weight,
  MAX(bo.delivered_at) as delivery_date,
  (
    SELECT up.full_name 
    FROM user_profiles up 
    WHERE up.user_id = bo.driver_id 
    LIMIT 1
  ) as driver_name
FROM orders o
LEFT JOIN box_orders bo ON o.id = bo.order_id
WHERE 
  bo.status IN ('delivered', 'completed')
  AND (${office_id}::uuid IS NULL OR bo.office_id = ${office_id}::uuid)
  AND (${driver_id}::uuid IS NULL OR bo.driver_id = ${driver_id}::uuid)
  AND (${payment_status}::text IS NULL OR o.payment_status = ${payment_status}::text)
  AND (${date_from}::timestamptz IS NULL OR o.updated_at >= ${date_from}::timestamptz)
  AND (${date_to}::timestamptz IS NULL OR o.updated_at <= ${date_to}::timestamptz)
GROUP BY 
  o.id, o.customer_name, o.recipient_name, o.recipient_address,
  o.pickup_location, o.payment_status, o.created_at, o.updated_at
ORDER BY o.updated_at DESC
OFFSET ${page * page_size}
LIMIT ${page_size};

-- Alternative: Get count for pagination
SELECT COUNT(DISTINCT o.id) as total
FROM orders o
LEFT JOIN box_orders bo ON o.id = bo.order_id
WHERE 
  bo.status IN ('delivered', 'completed')
  AND (${office_id}::uuid IS NULL OR bo.office_id = ${office_id}::uuid)
  AND (${driver_id}::uuid IS NULL OR bo.driver_id = ${driver_id}::uuid)
  AND (${payment_status}::text IS NULL OR o.payment_status = ${payment_status}::text)
  AND (${date_from}::timestamptz IS NULL OR o.updated_at >= ${date_from}::timestamptz)
  AND (${date_to}::timestamptz IS NULL OR o.updated_at <= ${date_to}::timestamptz);

-- ─────────────────────────────────────────────────────────
-- BOX DETAILS: Get all boxes for an order
-- ─────────────────────────────────────────────────────────
-- Purpose: Expand order card to show box-level details
-- Input: order_id (UUID)

SELECT 
  id,
  box_number,
  status,
  barcode,
  weight_lbs,
  dimensions,
  delivered_at,
  delivery_notes,
  signature_url,
  created_at,
  created_by
FROM box_orders
WHERE order_id = ${order_id}::uuid
ORDER BY box_number ASC;

-- ─────────────────────────────────────────────────────────
-- ACTIVITY TRAIL: Get audit log for an order
-- ─────────────────────────────────────────────────────────
-- Purpose: Show all actions/events related to an order
-- Input: order_id (UUID)
-- Limit: Last 50 activities

SELECT 
  id,
  activity_type,
  action,
  resource_type,
  description,
  created_at,
  user_id,
  (SELECT full_name FROM user_profiles up WHERE up.user_id = al.user_id LIMIT 1) as user_name,
  old_data,
  new_data
FROM activity_log
WHERE order_id = ${order_id}::uuid
ORDER BY created_at DESC
LIMIT 50;

-- ─────────────────────────────────────────────────────────
-- OFFICES: Get all offices for filter dropdown
-- ─────────────────────────────────────────────────────────

SELECT 
  id,
  name,
  city,
  phone
FROM offices
ORDER BY name ASC;

-- ─────────────────────────────────────────────────────────
-- DRIVERS: Get all drivers for filter dropdown
-- ─────────────────────────────────────────────────────────
-- Optional: filter by office_id

SELECT 
  user_id,
  full_name,
  phone,
  office_id
FROM user_profiles
WHERE role = 'driver'
  AND (${office_id}::uuid IS NULL OR office_id = ${office_id}::uuid)
ORDER BY full_name ASC;

-- ─────────────────────────────────────────────────────────
-- UPDATE BOX STATUS: Change status of a box
-- ─────────────────────────────────────────────────────────
-- Purpose: HQ reassigns driver, marks ready, etc.
-- Input: box_id, new_status

UPDATE box_orders
SET 
  status = ${new_status}::text,
  status_updated_at = NOW(),
  status_updated_by = auth.uid()
WHERE id = ${box_id}::uuid
RETURNING *;

-- ─────────────────────────────────────────────────────────
-- INSERT ACTIVITY LOG: Record an event
-- ─────────────────────────────────────────────────────────
-- Purpose: Audit trail for all operations
-- Immutable (INSERT only, no UPDATE/DELETE allowed by RLS)

INSERT INTO activity_log (
  tenant_id,
  order_id,
  box_id,
  user_id,
  activity_type,
  action,
  resource_type,
  description,
  old_data,
  new_data,
  created_at
) VALUES (
  ${tenant_id}::uuid,
  ${order_id}::uuid,
  ${box_id}::uuid,
  auth.uid(),
  ${activity_type}::text,
  ${action}::text,
  ${resource_type}::text,
  ${description}::text,
  ${old_data}::jsonb,
  ${new_data}::jsonb,
  NOW()
)
RETURNING *;

-- ─────────────────────────────────────────────────────────
-- SEARCH ORDERS: Quick search by order ID or customer
-- ─────────────────────────────────────────────────────────
-- Purpose: Fast lookup for HQ staff
-- Input: search_text (partial match on ID or customer name)

SELECT 
  o.id,
  o.customer_name,
  o.recipient_name,
  COUNT(bo.id) as box_count,
  MAX(bo.status) as latest_box_status
FROM orders o
LEFT JOIN box_orders bo ON o.id = bo.order_id
WHERE 
  o.id::text ILIKE '%' || ${search_text} || '%'
  OR o.customer_name ILIKE '%' || ${search_text} || '%'
GROUP BY o.id, o.customer_name, o.recipient_name
ORDER BY o.created_at DESC
LIMIT 20;

-- ─────────────────────────────────────────────────────────
-- GET ORDER STATISTICS: Daily/weekly metrics for HQ dashboard
-- ─────────────────────────────────────────────────────────
-- Purpose: Show KPIs (orders assigned, picked up, completed)

SELECT 
  DATE(bo.created_at) as date,
  bo.status,
  COUNT(bo.id) as count,
  SUM(bo.weight_lbs) as total_weight
FROM box_orders bo
WHERE bo.created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(bo.created_at), bo.status
ORDER BY date DESC, status;

-- ─────────────────────────────────────────────────────────
-- STALLED ORDERS: Orders in transit for >4 hours
-- ─────────────────────────────────────────────────────────
-- Purpose: Alert HQ to potential issues

SELECT 
  bo.order_id,
  bo.id as box_id,
  bo.status,
  bo.driver_id,
  bo.status_updated_at,
  EXTRACT(HOUR FROM (NOW() - bo.status_updated_at)) as hours_stalled,
  o.customer_name,
  o.recipient_name,
  o.recipient_address,
  up.full_name as driver_name
FROM box_orders bo
JOIN orders o ON bo.order_id = o.id
LEFT JOIN user_profiles up ON bo.driver_id = up.user_id
WHERE 
  bo.status IN ('picked_up', 'in_transit')
  AND (NOW() - bo.status_updated_at) > INTERVAL '4 hours'
ORDER BY hours_stalled DESC;

-- ─────────────────────────────────────────────────────────
-- PAYMENT STATUS SUMMARY: Completed orders grouped by payment
-- ─────────────────────────────────────────────────────────
-- Purpose: Show unpaid vs paid orders for accounting

SELECT 
  o.payment_status,
  COUNT(o.id) as order_count,
  SUM(bo.weight_lbs) as total_weight
FROM orders o
LEFT JOIN box_orders bo ON o.id = bo.order_id
WHERE bo.status IN ('delivered', 'completed')
GROUP BY o.payment_status
ORDER BY payment_status;

-- ═══════════════════════════════════════════════════════════════════
-- NOTES ON EXECUTION
-- ═══════════════════════════════════════════════════════════════════
-- 
-- In JavaScript (supabase-js client), these queries are built as:
-- 
--   const { data, error } = await supabase
--     .from('box_orders')
--     .select('id, order_id, status, ...')
--     .eq('status', 'assigned')
--     .is('office_id', filters.office_id ? null : null)  // null checks
--     .gte('created_at', filters.date_from)
--     .order('created_at', { ascending: false })
--     .limit(100);
--
-- Supabase automatically handles parameter binding for security.
-- 
-- RLS Policies enforce row-level security automatically:
// - HQ role: Can SELECT all rows (no filtering)
// - Office role: Can SELECT only own office rows
// - Driver role: Can SELECT only assigned boxes
// - Anonymous: Denied access
//
// All activity_log INSERTs are logged automatically.
// All UPDATEs to box_orders trigger activity_log entries.
// All DELETEs on activity_log are blocked by RLS.
//
// ═══════════════════════════════════════════════════════════════════
