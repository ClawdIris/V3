-- Phase 6 Slice 5 Stage 5: Archive/Deactivation columns for core entities
-- NOTE: Apply these migrations in Supabase SQL editor.
-- Partners table — add is_active if missing (usually already present)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;
-- Drivers table — add is_active if missing
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;
-- Box types (stored in tenant_settings JSON; no dedicated table currently)
-- If a box_types table exists:
-- ALTER TABLE box_types ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
-- ALTER TABLE box_types ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;
-- message_templates — already has is_active; add archived_at
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;
