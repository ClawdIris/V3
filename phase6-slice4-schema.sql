-- ═══════════════════════════════════════════════════════════════════
-- PHASE 6 — SLICE 4: Tape Direct + Box Sale Cost/Margin Foundation
-- Schema: tape_direct_records + box_sale_records
-- ═══════════════════════════════════════════════════════════════════
--
-- STATUS: PENDING — DO NOT APPLY without Forge + Delta review
-- Written by: Bolt (subagent)
-- Date: 2026-05-28
-- Project: Casabe Konnect R4 (Supabase: exayifxbqduhsxmmsnxr)
--
-- SCHEMA DECISION:
--   1. tape_direct_records: Separate table (NOT added to box_orders).
--      box_orders tracks box lifecycle status; Tape Direct is a financial
--      procurement event that can span multiple boxes/orders. Storing it
--      separately keeps box_orders clean and allows multiple Tape Direct
--      records per order (history). box_orders.metadata JSONB could store
--      the "latest" tape_direct_id as a soft reference if needed.
--
--   2. box_sale_records: Separate table (NOT on box_orders).
--      Box sales are cash-register-style transactions (empty boxes sold
--      to walk-in customers), not tied to an existing order lifecycle.
--      Separate table allows voiding, historical audit, and margin math
--      without polluting box_orders.
--
-- SAFETY:
--   - Both tables have RLS enabled immediately.
--   - No USING (TRUE) policies on sensitive tables.
--   - No user_profiles references (uses auth.uid() + members table).
--   - SECURITY DEFINER functions use SET search_path = ''.
--   - Archive/void pattern — no hard deletes.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────
-- TABLE 1: tape_direct_records
-- Purpose: Track Tape Direct procurement events per order/box.
--   HQ and Office can create; Driver cannot see cost/margin.
--   Historical: records are voided/archived, never deleted.
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tape_direct_records (
  -- Identifiers
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT NOT NULL DEFAULT current_tenant_id(),

  -- Links (nullable — can apply to order, box, or standalone)
  order_id              TEXT,                     -- links to orders.id (TEXT)
  box_id                UUID REFERENCES box_orders(id) ON DELETE SET NULL,

  -- Tape Direct fields
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
    -- TRUE = currently tape-direct; FALSE = disabled/turned off
  vendor_name           TEXT,                     -- vendor or source name
  cost                  NUMERIC(10, 2),           -- cost per unit or total cost
  quantity              INTEGER,                  -- optional quantity
  notes                 TEXT,                     -- free-form notes

  -- Who / where
  office_id             UUID,                     -- which office
  staff_user_id         UUID,                     -- auth.uid() of user who created record
  staff_email           TEXT,                     -- email snapshot for display

  -- Lifecycle
  status                TEXT NOT NULL DEFAULT 'active',
    -- 'active' | 'voided' | 'archived'
  voided_at             TIMESTAMPTZ,
  voided_by             UUID,                     -- auth.uid() of user who voided
  void_reason           TEXT,

  -- Audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tape_direct_valid_status CHECK (
    status IN ('active', 'voided', 'archived')
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_td_tenant_id       ON tape_direct_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_td_order_id        ON tape_direct_records(order_id);
CREATE INDEX IF NOT EXISTS idx_td_box_id          ON tape_direct_records(box_id);
CREATE INDEX IF NOT EXISTS idx_td_office_id       ON tape_direct_records(office_id);
CREATE INDEX IF NOT EXISTS idx_td_staff_user_id   ON tape_direct_records(staff_user_id);
CREATE INDEX IF NOT EXISTS idx_td_status          ON tape_direct_records(status);
CREATE INDEX IF NOT EXISTS idx_td_created_at      ON tape_direct_records(created_at DESC);

COMMENT ON TABLE tape_direct_records IS
  'Tape Direct procurement events. Archived/voided, never hard-deleted.';
COMMENT ON COLUMN tape_direct_records.enabled IS
  'Whether Tape Direct is currently active for this record (toggle).';
COMMENT ON COLUMN tape_direct_records.cost IS
  'Procurement cost. Visible to HQ and Office only; drivers cannot see this.';


-- ─────────────────────────────────────────────────────────
-- TABLE 2: box_sale_records
-- Purpose: Record sales of empty boxes to customers.
--   Tracks revenue, cost, gross margin, margin %.
--   HQ sees all offices; Office sees own only; Driver: blocked.
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS box_sale_records (
  -- Identifiers
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT NOT NULL DEFAULT current_tenant_id(),

  -- Box details
  box_type              TEXT NOT NULL,            -- 'small' | 'medium' | 'large' | 'oversized' | 'custom'
  quantity              INTEGER NOT NULL CHECK (quantity > 0),

  -- Financials (HQ + Office visible; Driver blocked)
  unit_cost             NUMERIC(10, 2) NOT NULL,  -- cost to acquire one box
  sale_price            NUMERIC(10, 2) NOT NULL,  -- price charged to customer per box
  total_revenue         NUMERIC(12, 2) GENERATED ALWAYS AS (quantity * sale_price) STORED,
  total_cost            NUMERIC(12, 2) GENERATED ALWAYS AS (quantity * unit_cost)  STORED,
  gross_margin          NUMERIC(12, 2) GENERATED ALWAYS AS (quantity * sale_price - quantity * unit_cost) STORED,
  margin_pct            NUMERIC(6, 2)  GENERATED ALWAYS AS (
    CASE WHEN sale_price = 0 THEN 0
         ELSE ROUND(((sale_price - unit_cost) / sale_price) * 100, 2)
    END
  ) STORED,

  -- Optional link to existing order/box
  order_id              TEXT,
  box_order_id          UUID REFERENCES box_orders(id) ON DELETE SET NULL,

  -- Who / where
  office_id             UUID NOT NULL,            -- required: which office made the sale
  staff_user_id         UUID,                     -- auth.uid()
  staff_email           TEXT,                     -- snapshot for display

  -- Lifecycle
  status                TEXT NOT NULL DEFAULT 'active',
    -- 'active' | 'voided' | 'archived'
  voided_at             TIMESTAMPTZ,
  voided_by             UUID,
  void_reason           TEXT,

  -- Audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT box_sale_valid_box_type CHECK (
    box_type IN ('small', 'medium', 'large', 'oversized', 'custom')
  ),
  CONSTRAINT box_sale_valid_status CHECK (
    status IN ('active', 'voided', 'archived')
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bsr_tenant_id      ON box_sale_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bsr_office_id      ON box_sale_records(office_id);
CREATE INDEX IF NOT EXISTS idx_bsr_staff_user_id  ON box_sale_records(staff_user_id);
CREATE INDEX IF NOT EXISTS idx_bsr_status         ON box_sale_records(status);
CREATE INDEX IF NOT EXISTS idx_bsr_created_at     ON box_sale_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bsr_box_type       ON box_sale_records(box_type);

COMMENT ON TABLE box_sale_records IS
  'Empty box sale transactions. Revenue/cost/margin fields. Voided, never hard-deleted.';
COMMENT ON COLUMN box_sale_records.gross_margin IS
  'Computed: total_revenue - total_cost. Visible to HQ + Office only.';
COMMENT ON COLUMN box_sale_records.margin_pct IS
  'Computed: (sale_price - unit_cost) / sale_price * 100. Visible to HQ + Office only.';


-- ═══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE tape_direct_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE box_sale_records    ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────
-- RLS: tape_direct_records
-- ─────────────────────────────────────────────────────────

-- HQ: see all records in tenant
CREATE POLICY "td_hq_select" ON tape_direct_records
  FOR SELECT
  USING (
    tenant_id = current_tenant_id()
    AND (is_hq() OR get_user_role() IN ('hq', 'admin', 'owner'))
  );

-- Office: see only records for their office(s)
CREATE POLICY "td_office_select" ON tape_direct_records
  FOR SELECT
  USING (
    tenant_id = current_tenant_id()
    AND get_user_role() IN ('office', 'manager', 'dispatcher')
    AND office_id = ANY(get_user_office_ids())
  );

-- Driver: blocked (no SELECT policy for driver role)
-- anon: blocked by default (no policy = no access)

-- HQ: insert
CREATE POLICY "td_hq_insert" ON tape_direct_records
  FOR INSERT
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (is_hq() OR get_user_role() IN ('hq', 'admin', 'owner'))
  );

-- Office: insert for own office
CREATE POLICY "td_office_insert" ON tape_direct_records
  FOR INSERT
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND get_user_role() IN ('office', 'manager', 'dispatcher')
    AND office_id = ANY(get_user_office_ids())
  );

-- HQ: update (for void/archive)
CREATE POLICY "td_hq_update" ON tape_direct_records
  FOR UPDATE
  USING (
    tenant_id = current_tenant_id()
    AND (is_hq() OR get_user_role() IN ('hq', 'admin', 'owner'))
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (is_hq() OR get_user_role() IN ('hq', 'admin', 'owner'))
  );

-- Office: update own office records (for void/archive)
CREATE POLICY "td_office_update" ON tape_direct_records
  FOR UPDATE
  USING (
    tenant_id = current_tenant_id()
    AND get_user_role() IN ('office', 'manager', 'dispatcher')
    AND office_id = ANY(get_user_office_ids())
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND get_user_role() IN ('office', 'manager', 'dispatcher')
    AND office_id = ANY(get_user_office_ids())
  );

-- No hard deletes for anyone
CREATE POLICY "td_deny_delete" ON tape_direct_records
  FOR DELETE
  USING (FALSE);


-- ─────────────────────────────────────────────────────────
-- RLS: box_sale_records
-- ─────────────────────────────────────────────────────────

-- HQ: see all records in tenant
CREATE POLICY "bsr_hq_select" ON box_sale_records
  FOR SELECT
  USING (
    tenant_id = current_tenant_id()
    AND (is_hq() OR get_user_role() IN ('hq', 'admin', 'owner'))
  );

-- Office: see only own office records
CREATE POLICY "bsr_office_select" ON box_sale_records
  FOR SELECT
  USING (
    tenant_id = current_tenant_id()
    AND get_user_role() IN ('office', 'manager', 'dispatcher')
    AND office_id = ANY(get_user_office_ids())
  );

-- Driver: blocked (no policy)
-- anon: blocked

-- HQ: insert
CREATE POLICY "bsr_hq_insert" ON box_sale_records
  FOR INSERT
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (is_hq() OR get_user_role() IN ('hq', 'admin', 'owner'))
  );

-- Office: insert for own office
CREATE POLICY "bsr_office_insert" ON box_sale_records
  FOR INSERT
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND get_user_role() IN ('office', 'manager', 'dispatcher')
    AND office_id = ANY(get_user_office_ids())
  );

-- HQ: update (void/archive)
CREATE POLICY "bsr_hq_update" ON box_sale_records
  FOR UPDATE
  USING (
    tenant_id = current_tenant_id()
    AND (is_hq() OR get_user_role() IN ('hq', 'admin', 'owner'))
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (is_hq() OR get_user_role() IN ('hq', 'admin', 'owner'))
  );

-- Office: update own office (void/archive)
CREATE POLICY "bsr_office_update" ON box_sale_records
  FOR UPDATE
  USING (
    tenant_id = current_tenant_id()
    AND get_user_role() IN ('office', 'manager', 'dispatcher')
    AND office_id = ANY(get_user_office_ids())
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND get_user_role() IN ('office', 'manager', 'dispatcher')
    AND office_id = ANY(get_user_office_ids())
  );

-- No hard deletes
CREATE POLICY "bsr_deny_delete" ON box_sale_records
  FOR DELETE
  USING (FALSE);


-- ═══════════════════════════════════════════════════════════════════
-- GRANTS
-- ═══════════════════════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE ON tape_direct_records TO authenticated;
GRANT SELECT, INSERT, UPDATE ON box_sale_records    TO authenticated;

GRANT ALL ON tape_direct_records TO service_role;
GRANT ALL ON box_sale_records    TO service_role;

-- anon: no grants (RLS also blocks)


-- ═══════════════════════════════════════════════════════════════════
-- MARGIN SUMMARY VIEW (read-only convenience view)
-- ═══════════════════════════════════════════════════════════════════
-- This view is used by the Margin Summary page. RLS on base tables
-- enforces access control; this view just aggregates.

CREATE OR REPLACE VIEW margin_summary_view
WITH (security_invoker = true) AS
SELECT
  'box_sale'                          AS record_type,
  bsr.office_id,
  bsr.tenant_id,
  bsr.created_at::DATE                AS record_date,
  bsr.total_revenue                   AS revenue,
  bsr.total_cost                      AS cost,
  bsr.gross_margin                    AS margin,
  bsr.margin_pct,
  bsr.status
FROM box_sale_records bsr
WHERE bsr.status = 'active';

COMMENT ON VIEW margin_summary_view IS
  'Convenience aggregate view for Margin Summary page. Access is controlled by RLS on box_sale_records.';

GRANT SELECT ON margin_summary_view TO authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES (run after applying)
-- ═══════════════════════════════════════════════════════════════════

-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE tablename IN ('tape_direct_records', 'box_sale_records');

-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'box_sale_records'
-- ORDER BY ordinal_position;

-- SELECT polname, polcmd FROM pg_policies
-- WHERE tablename IN ('tape_direct_records', 'box_sale_records');
