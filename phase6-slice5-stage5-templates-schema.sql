-- Phase 6 Slice 5 Stage 5: Message Templates (CRUD with archive)
CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'both')),
  body_en TEXT NOT NULL,
  body_es TEXT NOT NULL,
  variables JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hq_all" ON message_templates FOR ALL TO authenticated
  USING (get_user_role() = 'hq')
  WITH CHECK (get_user_role() = 'hq');
CREATE POLICY "office_own" ON message_templates FOR ALL TO authenticated
  USING (get_user_role() = 'office' AND tenant_id = ANY(get_user_office_ids()))
  WITH CHECK (get_user_role() = 'office' AND tenant_id = ANY(get_user_office_ids()));
CREATE POLICY "driver_read" ON message_templates FOR SELECT TO authenticated
  USING (get_user_role() = 'driver');
CREATE POLICY "anon_blocked" ON message_templates FOR ALL TO anon
  USING (false);
