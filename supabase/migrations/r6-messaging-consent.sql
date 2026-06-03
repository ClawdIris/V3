-- Add SMS/WhatsApp consent fields to orders table
-- (order-level consent — tied to the recipient at time of order)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS sms_opted_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_opted_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_recorded_by TEXT; -- user id who recorded consent
