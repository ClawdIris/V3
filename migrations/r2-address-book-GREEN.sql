-- ════════════════════════════════════════════════════════════════════════════
-- r2-address-book-GREEN.sql
-- ────────────────────────────────────────────────────────────────────────────
-- GREEN-ONLY Address Book — PURE CONTACT DIRECTORY for address reuse.
--
-- Derived from r2-address-book-schema-v4.sql, with ALL messaging/marketing-
-- consent surface STRIPPED per Jeffrey's directive (2026-06-29):
--   • NO sms_consent / whatsapp_consent / email_consent columns
--   • NO consent_updated_at column
--   • NO campaign_audiences table
--   • NO v_campaign_audience_contacts consent-gating view
--   • import_contacts_from_orders() reads ONLY name/phone/whatsapp/email/address
--     fields from orders.data JSONB. It DOES NOT read orders.sms_opted_in,
--     orders.whatsapp_opted_in, or orders.consent_recorded_at. This schema has
--     ZERO dependency on r6-messaging-consent.sql (A2P/SMS — untouched).
--
-- PURPOSE: store sender/receiver contact + address info so HQ/Office can reuse
-- them for quick lookup when creating new orders. Contact directory only.
--
-- SCOPE GUARANTEE: nothing in this file touches payments, SMS, A2P, WhatsApp,
-- email sending, messaging consent, or auth. Tables created: address_book only.
--
-- FUNCTIONS RELIED UPON (confirmed live in DB at apply time):
--   • is_member(tenant_id TEXT)
--   • get_user_role()
-- ROLLBACK: see r2-address-book-GREEN-rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- SAFETY GATE — abort if required helper functions are missing.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing TEXT := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'is_member'
  ) THEN
    v_missing := v_missing || ' is_member()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'get_user_role'
  ) THEN
    v_missing := v_missing || ' get_user_role()';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION
      'R2-GREEN-GATE: Required functions missing: % — ABORT migration.', v_missing;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1: address_book TABLE (contact directory — NO consent columns)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.address_book (
  -- ── Identity ───────────────────────────────────────────────────────────
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            TEXT         NOT NULL,

  -- ── Contact Info ───────────────────────────────────────────────────────
  name                 TEXT         NOT NULL,
  phone                TEXT,
  whatsapp             TEXT,
  email                TEXT,

  -- ── Address ────────────────────────────────────────────────────────────
  address              TEXT,          -- street
  city                 TEXT,
  state                TEXT,
  zip                  TEXT,
  country              TEXT         NOT NULL DEFAULT 'US',

  -- ── Segmentation ───────────────────────────────────────────────────────
  tags                 TEXT[]       NOT NULL DEFAULT '{}',
  preferred_language   TEXT         NOT NULL DEFAULT 'en'
                         CHECK (preferred_language IN ('en', 'es')),

  -- ── Geocoordinates (populated later; geocoding is R3/Phase-4 territory) ──
  lat                  NUMERIC(10,7),
  lon                  NUMERIC(10,7),
  coordinate_status    TEXT         NOT NULL DEFAULT 'unverified'
                         CHECK (coordinate_status IN
                           ('unverified', 'geocoded', 'manual', 'failed')),

  -- ── Lifecycle (no hard deletes: set is_active = false to deactivate) ─────
  is_active            BOOLEAN      NOT NULL DEFAULT true,
  source               TEXT         NOT NULL DEFAULT 'manual'
                         CHECK (source IN
                           ('manual', 'imported_from_orders', 'api')),

  -- ── Audit ──────────────────────────────────────────────────────────────
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by           UUID         REFERENCES auth.users(id)
);

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ab_tenant_id
  ON public.address_book (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ab_phone
  ON public.address_book (phone);

-- GIN for tag overlap queries: tags && ARRAY['vip','repeat']
CREATE INDEX IF NOT EXISTS idx_ab_tags
  ON public.address_book USING GIN (tags);

-- Spatial proximity queries (lat, lon)
CREATE INDEX IF NOT EXISTS idx_ab_coords
  ON public.address_book (lat, lon)
  WHERE lat IS NOT NULL AND lon IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ab_is_active
  ON public.address_book (tenant_id, is_active);

-- ── Trigger: auto-update updated_at ────────────────────────────────────────
-- NOTE: set_updated_at() already exists live with identical body
-- (NEW.updated_at := now(); RETURN NEW;). CREATE OR REPLACE is a safe no-op
-- overwrite — confirmed by pre-apply diff 2026-06-29.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ab_updated_at ON public.address_book;
CREATE TRIGGER trg_ab_updated_at
  BEFORE UPDATE ON public.address_book
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- RLS — address_book
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.address_book ENABLE ROW LEVEL SECURITY;

-- Policy 1: HQ + Office + Owner + Admin — full read/write for own tenant.
CREATE POLICY ab_hq_office_all ON public.address_book
  FOR ALL
  TO authenticated
  USING (
    is_member(tenant_id)
    AND get_user_role() IN ('hq', 'office', 'owner', 'admin')
  )
  WITH CHECK (
    is_member(tenant_id)
    AND get_user_role() IN ('hq', 'office', 'owner', 'admin')
  );

-- Policy 2: Driver — read-only, only contacts on their assigned orders.
-- Customer phone/whatsapp live in orders.data JSONB; match against those.
CREATE POLICY ab_driver_select ON public.address_book
  FOR SELECT
  TO authenticated
  USING (
    is_member(tenant_id)
    AND get_user_role() = 'driver'
    AND is_active = true
    AND (
      phone IN (
        SELECT o.data->>'phone'
        FROM public.orders o
        WHERE o.tenant_id = address_book.tenant_id
          AND o.data->>'assignedDriverUserId' = auth.uid()::text
          AND o.data->>'phone' IS NOT NULL
      )
      OR whatsapp IN (
        SELECT o.data->>'whatsapp'
        FROM public.orders o
        WHERE o.tenant_id = address_book.tenant_id
          AND o.data->>'assignedDriverUserId' = auth.uid()::text
          AND o.data->>'whatsapp' IS NOT NULL
      )
    )
  );

-- Policy 3: anon — RESTRICTIVE unconditional block (AND-logic, cannot be
-- overridden by permissive policies).
CREATE POLICY ab_anon_blocked ON public.address_book
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2: import_contacts_from_orders(p_tenant_id TEXT)
-- ────────────────────────────────────────────────────────────────────────────
-- GREEN: imports ONLY contact + address fields from orders.data JSONB.
-- Does NOT read or write any consent column. Zero dependency on R6.
-- Idempotent: dedup by phone (primary) then name+address (secondary);
-- never overwrites existing contacts. Requires HQ/Office/Owner/Admin role.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.import_contacts_from_orders(p_tenant_id TEXT)
RETURNS TABLE (
  imported_count  INT,
  skipped_count   INT,
  error_count     INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_imported   INT := 0;
  v_skipped    INT := 0;
  v_errors     INT := 0;
  rec          RECORD;
  v_norm_phone TEXT;
  v_existing   UUID;
BEGIN
  -- Gate: caller must be authenticated member of this tenant
  IF NOT public.is_member(p_tenant_id) THEN
    RAISE EXCEPTION 'import_contacts_from_orders: caller is not a member of tenant %', p_tenant_id;
  END IF;

  -- Only HQ and Office (and owner/admin) may run imports
  IF public.get_user_role() NOT IN ('hq', 'office', 'owner', 'admin') THEN
    RAISE EXCEPTION 'import_contacts_from_orders: insufficient role — HQ or Office required';
  END IF;

  -- Dedup by phone (>= 7 digits) else name|address. Most-recent order wins
  -- within each dedup group (created_at DESC). NO consent fields referenced.
  FOR rec IN
    SELECT DISTINCT ON (sub.dedup_key)
      sub.name,
      sub.phone,
      sub.whatsapp,
      sub.address,
      sub.city,
      sub.state,
      sub.zip,
      sub.email,
      sub.norm_phone
    FROM (
      SELECT
        o.data->>'name'                                        AS name,
        o.data->>'phone'                                       AS phone,
        o.data->>'whatsapp'                                    AS whatsapp,
        o.data->>'address'                                     AS address,
        o.data->>'city'                                        AS city,
        o.data->>'state'                                       AS state,
        o.data->>'zip'                                         AS zip,
        o.data->>'email'                                       AS email,
        regexp_replace(COALESCE(o.data->>'phone', ''), '[^0-9]', '', 'g') AS norm_phone,
        CASE
          WHEN length(regexp_replace(COALESCE(o.data->>'phone', ''), '[^0-9]', '', 'g')) >= 7
          THEN regexp_replace(COALESCE(o.data->>'phone', ''), '[^0-9]', '', 'g')
          ELSE lower(trim(COALESCE(o.data->>'name', 'unknown')))
               || '|'
               || lower(trim(COALESCE(o.data->>'address', '')))
        END                                                    AS dedup_key,
        o.created_at
      FROM public.orders o
      WHERE o.tenant_id = p_tenant_id
        AND trim(COALESCE(o.data->>'name', '')) <> ''    -- must have a name
    ) sub
    ORDER BY
      sub.dedup_key,
      sub.created_at DESC
  LOOP
    BEGIN
      -- Blank-row guard (post-DISTINCT): skip rows with no phone AND no name.
      IF (rec.norm_phone IS NULL OR length(rec.norm_phone) = 0)
         AND (rec.name IS NULL OR trim(rec.name) = '')
      THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Normalize phone
      v_norm_phone := CASE
        WHEN length(regexp_replace(COALESCE(rec.phone, ''), '\D', '', 'g')) >= 7
        THEN regexp_replace(COALESCE(rec.phone, ''), '\D', '', 'g')
        ELSE NULL
      END;

      v_existing := NULL;

      -- Check phone dedup (primary)
      IF v_norm_phone IS NOT NULL THEN
        SELECT id INTO v_existing
        FROM public.address_book
        WHERE tenant_id = p_tenant_id
          AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = v_norm_phone
        LIMIT 1;
      END IF;

      -- Check name + address dedup (secondary)
      IF v_existing IS NULL THEN
        SELECT id INTO v_existing
        FROM public.address_book
        WHERE tenant_id = p_tenant_id
          AND lower(trim(COALESCE(name, '')))    = lower(trim(COALESCE(rec.name, '')))
          AND lower(trim(COALESCE(address, ''))) = lower(trim(COALESCE(rec.address, '')))
          AND trim(COALESCE(rec.address, ''))   <> ''  -- don't dedup on empty address
        LIMIT 1;
      END IF;

      IF v_existing IS NOT NULL THEN
        v_skipped := v_skipped + 1;   -- exists — never overwrite
        CONTINUE;
      END IF;

      -- Insert new contact (NO consent columns)
      INSERT INTO public.address_book (
        tenant_id,
        name,
        phone,
        whatsapp,
        email,
        address,
        city,
        state,
        zip,
        country,
        source,
        is_active
      ) VALUES (
        p_tenant_id,
        trim(rec.name),
        rec.phone,
        rec.whatsapp,
        rec.email,
        rec.address,
        rec.city,
        rec.state,
        rec.zip,
        'US',
        'imported_from_orders',
        true
      );

      v_imported := v_imported + 1;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'import_contacts_from_orders: skipping contact % due to error: %',
        rec.name, SQLERRM;
      v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_imported, v_skipped, v_errors;
END;
$$;

COMMENT ON FUNCTION public.import_contacts_from_orders(TEXT) IS
  'GREEN: imports unique customers from orders into address_book (contact + '
  'address fields only — NO consent data). Dedup by phone then name+address. '
  'Never overwrites existing contacts. Idempotent. Requires HQ/Office role.';

GRANT EXECUTE ON FUNCTION public.import_contacts_from_orders(TEXT)
  TO authenticated;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- POST-COMMIT VERIFY (run after apply)
-- ════════════════════════════════════════════════════════════════════════════
-- V1: RLS enabled on address_book → expect rowsecurity = true
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename='address_book';
-- V2: confirm NO consent columns exist → expect 0 rows
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name='address_book' AND column_name LIKE '%consent%';
-- V3: confirm campaign_audiences was NOT created → expect 0 rows
-- SELECT 1 FROM information_schema.tables WHERE table_name='campaign_audiences';
-- V4: policies present → expect ab_hq_office_all, ab_driver_select, ab_anon_blocked
-- SELECT policyname FROM pg_policies WHERE tablename='address_book' ORDER BY 1;
