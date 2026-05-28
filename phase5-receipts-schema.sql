-- ═══════════════════════════════════════════════════════════════════
-- PHASE 5: RECEIPTS & INVOICES - Casabe Konnect R4
-- ═══════════════════════════════════════════════════════════════════
--
-- This script creates the data schema for Phase 5:
-- 1. payments table - Payment transaction records
-- 2. payment_receipts table - Individual payment receipts
-- 3. invoices table - Shipment invoices (itemized)
-- 4. invoice_items table - Line items for invoices
-- 5. box_order_invoices table - Box-level invoice tracking
-- 6. RLS policies for all roles
--
-- Execution: psql -h [HOST] -U [USER] -d [DATABASE] -f phase5-receipts-schema.sql
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- TABLE 1: payments - Payment Transaction Records
-- ─────────────────────────────────────────────────────────
-- Purpose: Track all payment transactions
-- Tracks: method, amount, status, Stripe reference, timestamp

CREATE TABLE IF NOT EXISTS payments (
  -- Identifiers
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              TEXT NOT NULL,  -- FK: orders.id is TEXT (e.g. "TEST-003"), not UUID
  tenant_id             TEXT NOT NULL DEFAULT current_tenant_id(),  -- Multi-tenant isolation
  
  -- Payment Details
  amount_cents          INTEGER NOT NULL,  -- Amount in cents (e.g., 2500 = $25.00)
  currency              TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'EUR', 'GBP', 'CAD', 'MXN')),
  payment_method        TEXT NOT NULL,  -- 'card', 'stripe_link', 'apple_pay', 'zelle', 'cash', 'check'
  
  -- Status & Reference
  status                TEXT NOT NULL DEFAULT 'pending',
    -- Workflow: pending → processing → completed OR failed OR refunded
  stripe_payment_intent_id  TEXT,  -- Stripe PaymentIntent ID
  stripe_charge_id      TEXT,  -- Stripe Charge ID (after successful charge)
  stripe_payment_link_id TEXT,  -- Stripe Payment Link ID
  reference_number      TEXT,  -- Internal reference (e.g., "INV-2026-05-001")
  
  -- Payer Info
  payer_name            TEXT,
  payer_email           TEXT,
  payer_phone           TEXT,
  
  -- Timing
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at          TIMESTAMPTZ,  -- When payment was completed
  expires_at            TIMESTAMPTZ,  -- When payment link expires (if applicable)
  
  -- Metadata
  metadata              JSONB DEFAULT '{}'::jsonb,  -- Additional data (card type, last 4, etc.)
  notes                 TEXT,
  
  -- Audit
  created_by            UUID NOT NULL,  -- User who initiated payment
  processed_by          UUID,  -- User who confirmed/processed
  
  CONSTRAINT payment_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT valid_payment_status CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled')),
  CONSTRAINT fk_payments_order
    FOREIGN KEY (order_id, tenant_id) REFERENCES orders(id, tenant_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_pi ON payments(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_charge ON payments(stripe_charge_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order_status ON payments(order_id, status);

COMMENT ON TABLE payments IS 'Payment transaction records with Stripe integration and multi-method support';
COMMENT ON COLUMN payments.stripe_payment_intent_id IS 'Stripe PaymentIntent ID for tracking payment lifecycle';
COMMENT ON COLUMN payments.metadata IS 'JSON object storing card type, last 4 digits, fee data, etc.';


-- ─────────────────────────────────────────────────────────
-- TABLE 2: payment_receipts - Individual Payment Receipts
-- ─────────────────────────────────────────────────────────
-- Purpose: Store generated payment receipts (can be multiple per payment)
-- Tracks: receipt content, PDF, delivery method

CREATE TABLE IF NOT EXISTS payment_receipts (
  -- Identifiers
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id            UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  order_id              TEXT NOT NULL,  -- FK: orders.id is TEXT (e.g. "TEST-003"), not UUID
  
  -- Receipt Content
  receipt_number        TEXT NOT NULL UNIQUE,  -- Format: "RCP-2026-05-00001"
  receipt_date          DATE NOT NULL,
  receipt_time          TIME NOT NULL,
  
  -- Amounts
  amount_cents          INTEGER NOT NULL,
  amount_display        TEXT NOT NULL,  -- "USD 25.00" or "$25.00"
  
  -- Transaction Details
  payment_method        TEXT NOT NULL,  -- 'card', 'stripe_link', 'cash', etc.
  payment_reference     TEXT,  -- Last 4 of card, reference number, etc.
  
  -- Receipt Content (Plain Text Version)
  receipt_text          TEXT NOT NULL,  -- Plain text for SMS/WhatsApp
  
  -- Receipt Content (HTML/PDF)
  receipt_html          TEXT,  -- HTML version for print/email
  receipt_pdf_url       TEXT,  -- URL to generated PDF
  receipt_pdf_bytes     BYTEA,  -- Binary PDF stored in DB (if needed)
  
  -- Delivery Status
  sent_via              TEXT[],  -- Array: ['sms', 'whatsapp', 'email', 'print']
  sms_sent_at           TIMESTAMPTZ,
  sms_phone             TEXT,
  whatsapp_sent_at      TIMESTAMPTZ,
  whatsapp_number       TEXT,
  email_sent_at         TIMESTAMPTZ,
  email_address         TEXT,
  
  -- Audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID NOT NULL,
  
  CONSTRAINT valid_delivery CHECK (sent_via IS NULL OR array_length(sent_via, 1) > 0)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payment_receipts_payment_id ON payment_receipts(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_order_id ON payment_receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_number ON payment_receipts(receipt_number);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_date ON payment_receipts(receipt_date DESC);

COMMENT ON TABLE payment_receipts IS 'Generated payment receipts with SMS/WhatsApp/email delivery tracking';
COMMENT ON COLUMN payment_receipts.receipt_text IS 'Plain text version optimized for SMS/WhatsApp (no formatting)';
COMMENT ON COLUMN payment_receipts.sent_via IS 'Array of delivery channels: sms, whatsapp, email, print';


-- ─────────────────────────────────────────────────────────
-- TABLE 3: invoices - Shipment Invoices
-- ─────────────────────────────────────────────────────────
-- Purpose: Itemized shipment invoices for complete orders
-- Tracks: invoice number, date, itemized contents, totals

CREATE TABLE IF NOT EXISTS invoices (
  -- Identifiers
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              TEXT NOT NULL,  -- FK: orders.id is TEXT (e.g. "TEST-003"), not UUID
  tenant_id             TEXT NOT NULL DEFAULT current_tenant_id(),  -- Multi-tenant isolation
  
  -- Invoice Number & Date
  invoice_number        TEXT NOT NULL UNIQUE,  -- Format: "INV-2026-05-001"
  invoice_date          DATE NOT NULL,
  
  -- Parties
  shipper_name          TEXT NOT NULL,  -- Company/person shipping
  shipper_address       TEXT,
  shipper_phone         TEXT,
  shipper_email         TEXT,
  
  recipient_name        TEXT NOT NULL,  -- Recipient info from order
  recipient_address     TEXT,
  recipient_phone       TEXT,
  recipient_email       TEXT,
  
  -- Service Details
  service_type          TEXT,  -- e.g., "Cargo Shipment", "Parcel Delivery"
  pickup_location       TEXT,  -- 'office' or 'client_house'
  dropoff_address       TEXT,
  
  -- Itemization
  num_boxes             INTEGER NOT NULL,
  total_weight_lbs      DECIMAL(10, 2),  -- Sum of all box weights
  
  -- Costs (in cents)
  subtotal_cents        INTEGER NOT NULL DEFAULT 0,
  shipping_cost_cents   INTEGER NOT NULL DEFAULT 0,
  tax_cents             INTEGER NOT NULL DEFAULT 0,
  discount_cents        INTEGER DEFAULT 0,
  total_cents           INTEGER NOT NULL,  -- subtotal + shipping + tax - discount
  
  -- Status
  status                TEXT NOT NULL DEFAULT 'draft',
    -- Workflow: draft → sent → viewed → paid → archived
  invoice_sent_at       TIMESTAMPTZ,
  payment_received_at   TIMESTAMPTZ,
  
  -- Content
  invoice_html          TEXT,  -- Rendered HTML
  invoice_pdf_url       TEXT,  -- URL to generated PDF
  invoice_pdf_bytes     BYTEA,  -- Binary PDF (if stored)
  
  -- Notes & Metadata
  notes                 TEXT,
  metadata              JSONB DEFAULT '{}'::jsonb,
  
  -- Audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            UUID,
  
  CONSTRAINT invoice_total_consistency CHECK (total_cents >= 0),
  CONSTRAINT valid_invoice_status CHECK (status IN ('draft', 'sent', 'viewed', 'paid', 'archived', 'cancelled')),
  CONSTRAINT fk_invoices_order
    FOREIGN KEY (order_id, tenant_id) REFERENCES orders(id, tenant_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at DESC);

COMMENT ON TABLE invoices IS 'Itemized shipment invoices with multi-box support';
COMMENT ON COLUMN invoices.total_cents IS 'Total amount in cents: (subtotal + shipping + tax - discount)';
COMMENT ON COLUMN invoices.metadata IS 'JSON for extensible data (tax_id, po_number, etc.)';


-- ─────────────────────────────────────────────────────────
-- TABLE 4: invoice_items - Line Items for Invoices
-- ─────────────────────────────────────────────────────────
-- Purpose: Detailed line items (boxes) for each invoice
-- Tracks: box info, quantity, pricing per box

CREATE TABLE IF NOT EXISTS invoice_items (
  -- Identifiers
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id            UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  box_id                UUID NOT NULL REFERENCES box_orders(id) ON DELETE RESTRICT,
  
  -- Item Details
  item_sequence         INTEGER NOT NULL,  -- Line number (1-based)
  description           TEXT NOT NULL,  -- "Box 1 - Standard (12x8x6)"
  
  -- Box Specification (denormalized for audit trail)
  box_type              TEXT,  -- 'small', 'medium', 'large', 'oversized', 'custom'
  box_dimensions        JSONB,  -- { "length": 12, "width": 8, "height": 6 }
  box_weight_lbs        DECIMAL(8, 2),
  
  -- Pricing
  unit_price_cents      INTEGER NOT NULL,  -- Price per box
  quantity              INTEGER NOT NULL DEFAULT 1,
  line_total_cents      INTEGER NOT NULL,  -- unit_price * quantity
  
  -- Audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID NOT NULL,
  
  -- Metadata
  metadata              JSONB DEFAULT '{}'::jsonb,
  
  CONSTRAINT item_sequence_positive CHECK (item_sequence > 0),
  CONSTRAINT quantity_positive CHECK (quantity > 0),
  CONSTRAINT line_total_consistency CHECK (line_total_cents = unit_price_cents * quantity)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_box_id ON invoice_items(box_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_sequence ON invoice_items(invoice_id, item_sequence);

COMMENT ON TABLE invoice_items IS 'Line items (boxes) for invoices with pricing per box';
COMMENT ON COLUMN invoice_items.description IS 'Human-readable box description (e.g., "Box 1 - Standard (12x8x6)")';
COMMENT ON COLUMN invoice_items.line_total_cents IS 'Total for this line: (unit_price_cents * quantity)';


-- ─────────────────────────────────────────────────────────
-- TABLE 5: box_order_invoices - Box-Level Invoice Tracking
-- ─────────────────────────────────────────────────────────
-- Purpose: Track which invoice a box is included in
-- Enables: Tracking box status through invoicing cycle

CREATE TABLE IF NOT EXISTS box_order_invoices (
  -- Identifiers
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id                UUID NOT NULL REFERENCES box_orders(id) ON DELETE CASCADE,
  invoice_id            UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  
  -- Tracking
  included_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invoice_line_item_id  UUID REFERENCES invoice_items(id) ON DELETE SET NULL,
  
  CONSTRAINT unique_box_invoice UNIQUE (box_id, invoice_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_box_invoice_box_id ON box_order_invoices(box_id);
CREATE INDEX IF NOT EXISTS idx_box_invoice_invoice_id ON box_order_invoices(invoice_id);

COMMENT ON TABLE box_order_invoices IS 'Junction table tracking box inclusion in invoices';


-- ═════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) POLICIES FOR PHASE 5
-- ═════════════════════════════════════════════════════════════════════

-- Enable RLS on new tables
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE box_order_invoices ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────
-- RLS: payments table
-- ─────────────────────────────────────────────────────────

-- HQ: View all payments
CREATE POLICY payments_hq_select ON payments
FOR SELECT TO authenticated
USING (get_user_role() = 'hq');

-- Office: View payments for own office orders
CREATE POLICY payments_office_select ON payments
FOR SELECT TO authenticated
USING (
  get_user_role() = 'office'
  AND order_id IN (
    SELECT id FROM orders WHERE office_id = (
      SELECT office_id FROM user_profiles WHERE user_id = auth.uid()
    )
  )
);

-- Driver: View payments for assigned orders
CREATE POLICY payments_driver_select ON payments
FOR SELECT TO authenticated
USING (
  get_user_role() = 'driver'
  AND order_id IN (
    SELECT id FROM box_orders WHERE driver_id = auth.uid() GROUP BY order_id
  )
);

-- All authenticated users can insert (payment creation)
CREATE POLICY payments_insert ON payments
FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

-- ─────────────────────────────────────────────────────────
-- RLS: payment_receipts table
-- ─────────────────────────────────────────────────────────

-- HQ: View all receipts
CREATE POLICY payment_receipts_hq_select ON payment_receipts
FOR SELECT TO authenticated
USING (get_user_role() = 'hq');

-- Office: View receipts for own office orders
CREATE POLICY payment_receipts_office_select ON payment_receipts
FOR SELECT TO authenticated
USING (
  get_user_role() = 'office'
  AND order_id IN (
    SELECT id FROM orders WHERE office_id = (
      SELECT office_id FROM user_profiles WHERE user_id = auth.uid()
    )
  )
);

-- All authenticated users can insert (receipt generation)
CREATE POLICY payment_receipts_insert ON payment_receipts
FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

-- ─────────────────────────────────────────────────────────
-- RLS: invoices table
-- ─────────────────────────────────────────────────────────

-- HQ: View all invoices
CREATE POLICY invoices_hq_select ON invoices
FOR SELECT TO authenticated
USING (get_user_role() = 'hq');

-- Office: View invoices for own office orders
CREATE POLICY invoices_office_select ON invoices
FOR SELECT TO authenticated
USING (
  get_user_role() = 'office'
  AND order_id IN (
    SELECT id FROM orders WHERE office_id = (
      SELECT office_id FROM user_profiles WHERE user_id = auth.uid()
    )
  )
);

-- All authenticated users can insert/update invoices
CREATE POLICY invoices_insert ON invoices
FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY invoices_update ON invoices
FOR UPDATE TO authenticated
USING (
  get_user_role() = 'hq'
  OR order_id IN (
    SELECT id FROM orders WHERE office_id = (
      SELECT office_id FROM user_profiles WHERE user_id = auth.uid()
    )
  )
)
WITH CHECK (
  get_user_role() = 'hq'
  OR order_id IN (
    SELECT id FROM orders WHERE office_id = (
      SELECT office_id FROM user_profiles WHERE user_id = auth.uid()
    )
  )
);

-- ─────────────────────────────────────────────────────────
-- RLS: invoice_items & box_order_invoices
-- ─────────────────────────────────────────────────────────

-- These follow parent invoice policies (through foreign key)
CREATE POLICY invoice_items_all ON invoice_items
FOR ALL TO authenticated
USING (TRUE);

CREATE POLICY box_order_invoices_all ON box_order_invoices
FOR ALL TO authenticated
USING (TRUE);

-- ═════════════════════════════════════════════════════════════════════
-- HELPER FUNCTIONS
-- ═════════════════════════════════════════════════════════════════════

-- Generate next receipt number
CREATE OR REPLACE FUNCTION generate_receipt_number()
RETURNS TEXT AS $$
DECLARE
  next_seq INTEGER;
  year_month TEXT;
BEGIN
  year_month := TO_CHAR(NOW(), 'YYYY-MM');
  
  SELECT COUNT(*) + 1 INTO next_seq
  FROM payment_receipts
  WHERE receipt_number LIKE 'RCP-' || year_month || '-%';
  
  RETURN 'RCP-' || year_month || '-' || LPAD(next_seq::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- Generate next invoice number
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT AS $$
DECLARE
  next_seq INTEGER;
  year_month TEXT;
BEGIN
  year_month := TO_CHAR(NOW(), 'YYYY-MM');
  
  SELECT COUNT(*) + 1 INTO next_seq
  FROM invoices
  WHERE invoice_number LIKE 'INV-' || year_month || '-%';
  
  RETURN 'INV-' || year_month || '-' || LPAD(next_seq::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- Calculate invoice total (validates consistency)
CREATE OR REPLACE FUNCTION calculate_invoice_total(
  p_subtotal_cents INTEGER,
  p_shipping_cents INTEGER,
  p_tax_cents INTEGER,
  p_discount_cents INTEGER DEFAULT 0
)
RETURNS INTEGER AS $$
BEGIN
  RETURN (p_subtotal_cents + p_shipping_cents + p_tax_cents - COALESCE(p_discount_cents, 0));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ═════════════════════════════════════════════════════════════════════
-- TRIGGERS FOR PHASE 5
-- ═════════════════════════════════════════════════════════════════════

-- Update invoice updated_at on modification
CREATE OR REPLACE FUNCTION update_invoice_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_update_timestamp
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION update_invoice_timestamp();

-- ═════════════════════════════════════════════════════════════════════

COMMENT ON SCHEMA public IS 'Casabe Konnect R4 - Phase 5: Receipts & Invoices';
