-- ═══════════════════════════════════════════════════════════════════
-- PHASE 6 — SLICE 5 STAGE 3: Outbound Message Queue / Log
-- STATUS: APPLIED — live on Supabase after Delta review + Codex schema hardening
-- Written by: Iris (main session)
-- Date: 2026-05-28
-- Project: Casabe Konnect R4 (Supabase: exayifxbqduhsxmmsnxr)
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- Step 1: messages table
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT          NOT NULL DEFAULT current_tenant_id(),
  order_id            TEXT,                                        -- nullable; FK is composite with tenant_id
  customer_id         UUID,                                        -- nullable; FK to customers if exists
  recipient_phone     TEXT          NOT NULL,
  channel             TEXT          NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
  template_key        TEXT          NOT NULL,
  rendered_body       TEXT          NOT NULL,
  status              TEXT          NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft', 'queued', 'blocked', 'sent', 'failed', 'cancelled')),
  provider_message_id TEXT,                                        -- filled by Edge Function on send
  error_message       TEXT,
  created_by          TEXT          NOT NULL,                      -- user email or uid
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ,

  CONSTRAINT fk_messages_order
    FOREIGN KEY (order_id, tenant_id) REFERENCES orders(id, tenant_id) ON DELETE SET NULL
);

-- ─────────────────────────────────────────────────────────
-- Step 2: updated_at trigger
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_messages_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_updated_at ON messages;
CREATE TRIGGER trg_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION set_messages_updated_at();

-- ─────────────────────────────────────────────────────────
-- Step 3: Indexes
-- ─────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_messages_tenant_id    ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_order_id     ON messages(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_status       ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_channel      ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_created_at   ON messages(created_at DESC);

-- ─────────────────────────────────────────────────────────
-- Step 4: Enable RLS
-- ─────────────────────────────────────────────────────────

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────
-- Step 5: RLS Policies
-- ─────────────────────────────────────────────────────────

-- HQ: full access within their tenant
CREATE POLICY "hq_messages_select" ON messages
  FOR SELECT
  USING (
    public.get_user_role() = 'hq'
    AND tenant_id = (
      SELECT tenant_id FROM public.members
      WHERE user_id = auth.uid()
        AND active = true
      ORDER BY created_at
      LIMIT 1
    )
  );

CREATE POLICY "hq_messages_insert" ON messages
  FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'hq'
    AND tenant_id = (
      SELECT tenant_id FROM public.members
      WHERE user_id = auth.uid()
        AND active = true
      ORDER BY created_at
      LIMIT 1
    )
  );

CREATE POLICY "hq_messages_update" ON messages
  FOR UPDATE
  USING (
    public.get_user_role() = 'hq'
    AND tenant_id = (
      SELECT tenant_id FROM public.members
      WHERE user_id = auth.uid()
        AND active = true
      ORDER BY created_at
      LIMIT 1
    )
  )
  WITH CHECK (
    public.get_user_role() = 'hq'
    AND tenant_id = (
      SELECT tenant_id FROM public.members
      WHERE user_id = auth.uid()
        AND active = true
      ORDER BY created_at
      LIMIT 1
    )
  );

-- Hard deny delete — cancel/archive via status update only
CREATE POLICY "deny_delete_messages" ON messages
  FOR DELETE
  USING (FALSE);

-- Office: see messages for orders belonging to their office
CREATE POLICY "office_messages_select" ON messages
  FOR SELECT
  USING (
    tenant_id = current_tenant_id()
    AND public.get_user_role() = 'office'
    AND order_id IN (
      SELECT id FROM public.orders
      WHERE office_id = ANY(public.get_user_office_ids())
    )
  );

CREATE POLICY "office_messages_insert" ON messages
  FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'office'
    AND tenant_id = (
      SELECT tenant_id FROM public.members
      WHERE user_id = auth.uid()
        AND active = true
      ORDER BY created_at
      LIMIT 1
    )
    AND order_id IN (
      SELECT id FROM public.orders
      WHERE office_id = ANY(public.get_user_office_ids())
    )
  );

-- Driver: no access
-- Implicit deny is correct and sufficient — no permissive policy matches drivers,
-- so they cannot read or write any rows. Adding a permissive policy with
-- USING(role NOT IN ('driver')) would invert to a broad allow, not a deny.
-- If defense-in-depth is required, use AS RESTRICTIVE (Postgres 15+):
--
-- CREATE POLICY "driver_messages_deny" ON messages
--   AS RESTRICTIVE FOR ALL
--   USING (public.get_user_role() != 'driver');
--
-- Omitting for now: implicit deny is the safe, correct default.

-- Anon: blocked
-- Same reasoning — no permissive policy covers anon role,
-- so anon users are implicitly denied all access.
-- Explicit restrictive policy (optional, Postgres 15+):
--
-- CREATE POLICY "anon_messages_deny" ON messages
--   AS RESTRICTIVE FOR ALL
--   USING (auth.role() != 'anon');
--
-- Omitting for now: implicit deny is sufficient.

-- ─────────────────────────────────────────────────────────
-- Verification (run after applying)
-- ─────────────────────────────────────────────────────────

-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'messages';
-- SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'messages';

COMMENT ON TABLE messages IS
  'Outbound SMS/WhatsApp message queue and log. No sends occur from this table — actual delivery via Edge Function sms-send.';
COMMENT ON COLUMN messages.status IS
  'Lifecycle: draft → queued → sent|failed|cancelled. blocked = held by system rule.';
COMMENT ON COLUMN messages.provider_message_id IS
  'Filled by sms-send Edge Function on successful Twilio send. NULL until sent.';
