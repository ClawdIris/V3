-- ════════════════════════════════════════════════════════════════════════════
-- r2-address-book-schema-v2.sql
-- Casabe Konnect — Release 2: Address Book
-- ════════════════════════════════════════════════════════════════════════════
-- Author  : Forge (Dev Lead)
-- Reviewer: Delta (QA Lead)
-- Date    : 2026-06-14
-- Status  : V2 — Codex audit fixes applied — DO NOT APPLY without Jeffrey approval
--
-- CHANGES FROM V1 (Codex Audit Fixes):
--   FIX 1 — ab_anon_blocked and ca_anon_blocked: converted from permissive
--            USING (false) to AS RESTRICTIVE policies. Also removed the
--            misleading ca_driver_anon_blocked permissive policy (superseded
--            by the dedicated ca_driver_blocked RESTRICTIVE policy).
--   FIX 2 — v_campaign_audience_contacts: added WITH (security_invoker = true)
--            so the view runs under the caller's identity and does NOT bypass RLS.
--   FIX 3 — Radius filter in view WHERE clause: added explicit
--            ab.lat IS NOT NULL / ab.lon IS NOT NULL / coordinate_status guards
--            before the Haversine calculation to prevent NULL-coord errors.
--   FIX 4 — import_contacts_from_orders(): replaced bool_or() consent aggregation
--            with DISTINCT ON (normalized_phone) ORDER BY created_at DESC to
--            use the most-recent order's consent value, not a historical OR.
--
-- SCOPE:
--   1. CREATE TABLE address_book — tenant-scoped contact directory
--   2. RLS + all 4 role policies on address_book
--   3. Indexes: tenant_id, phone, tags GIN, (lat,lon), is_active
--   4. campaign_audiences table — structured targeting for campaigns
--   5. RLS on campaign_audiences
--   6. import_contacts_from_orders(p_tenant_id TEXT) function
--   7. Verification queries V1–V8
--
-- DESIGN DECISIONS:
--   a) `campaign_audiences` table (NOT a JSONB column on campaigns):
--      The existing campaigns table already has audience_key TEXT for
--      simple named segments. A separate campaign_audiences table adds
--      rich filtering (geo, zip, tags, consent, radius) without altering
--      the live campaigns table. The frontend JOIN is straightforward and
--      the design supports OR/AND filter combinations cleanly.
--
--   b) orders.id is TEXT (not UUID). The import function references
--      orders via TEXT id per the established composite FK pattern.
--
--   c) No hard deletes — is_active = false pattern throughout.
--
--   d) Driver RLS: drivers see contacts ONLY if the contact appears
--      on an order assigned to them. This uses a subquery into orders
--      via data->>'assignedDriverUserId' (same pattern as R1).
--
-- FUNCTIONS RELIED UPON (all confirmed live in DB):
--   • is_member(tenant_id TEXT)
--   • get_user_role()
--   • can_access_order(p_order_id TEXT)
--
-- ROLLBACK: See r2-address-book-schema-rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- SAFETY GATE
-- Abort if required helper functions are missing.
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
      'R2-GATE: Required functions missing: % — ABORT migration.', v_missing;
  END IF;
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1: address_book TABLE
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

  -- ── Consent ────────────────────────────────────────────────────────────
  -- Consent must be present and TRUE before any outbound channel send.
  -- "false" is the safe default — opt-in only.
  sms_consent          BOOLEAN      NOT NULL DEFAULT false,
  whatsapp_consent     BOOLEAN      NOT NULL DEFAULT false,
  email_consent        BOOLEAN      NOT NULL DEFAULT false,
  consent_updated_at   TIMESTAMPTZ,

  -- ── Geocoordinates ─────────────────────────────────────────────────────
  lat                  NUMERIC(10,7),
  lon                  NUMERIC(10,7),
  coordinate_status    TEXT         NOT NULL DEFAULT 'unverified'
                         CHECK (coordinate_status IN
                           ('unverified', 'geocoded', 'manual', 'failed')),

  -- ── Lifecycle ──────────────────────────────────────────────────────────
  -- No hard deletes: set is_active = false to deactivate.
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

-- Policy 1: HQ + Office — full read/write for own tenant
-- "Own tenant" is determined by is_member(tenant_id).
-- HQ sees all tenants they are a member of; Office sees their tenant.

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

-- Policy 2: Driver — read-only, only contacts on their assigned orders
-- A driver may read a contact if that contact's phone appears on an order
-- assigned to them within the same tenant. Soft deactivated contacts
-- (is_active = false) are not visible to drivers.
--
-- IMPLEMENTATION NOTE: We join through orders.data->>'assignedDriverUserId'
-- because drivers are linked to orders via that JSONB field (same as R1).
-- The subquery is intentionally narrow: it checks only the driver's
-- tenant and their own uid. No can_access_order() is used here because
-- we're filtering contacts, not orders.

CREATE POLICY ab_driver_select ON public.address_book
  FOR SELECT
  TO authenticated
  USING (
    is_member(tenant_id)
    AND get_user_role() = 'driver'
    AND is_active = true
    AND phone IN (
      SELECT o.phone
      FROM public.orders o
      WHERE o.tenant_id = address_book.tenant_id
        AND (o.data->>'assignedDriverUserId') = auth.uid()::text
      UNION
      SELECT o.whatsapp
      FROM public.orders o
      WHERE o.tenant_id = address_book.tenant_id
        AND (o.data->>'assignedDriverUserId') = auth.uid()::text
    )
  );

-- ── FIX 1 — address_book anon block: RESTRICTIVE policy ─────────────────────
-- V1 used a permissive USING (false). Under PostgreSQL's OR-logic for
-- permissive policies, a permissive USING(false) does NOT reliably block
-- anon when other permissive policies also exist on the table. A RESTRICTIVE
-- policy uses AND-logic: it must pass in addition to any permissive grant.
-- This unconditionally blocks the anon role regardless of other policies.

CREATE POLICY ab_anon_blocked ON public.address_book
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false);


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2: campaign_audiences TABLE
-- ════════════════════════════════════════════════════════════════════════════
--
-- DESIGN RATIONALE — why a separate table instead of JSONB on campaigns:
--
--   The existing campaigns table has audience_key TEXT which stores simple
--   named segments ('all', 'active', 'vip', etc.). Adding a JSONB targeting
--   column to campaigns would:
--     • Require altering the live campaigns table (schema change gate applies)
--     • Mix rich filter state into a table that already works for drafts
--     • Make it harder to query audiences independently (for preview counts)
--
--   A campaign_audiences table gives:
--     • One-to-one or one-to-many: one campaign can have one audience config
--     • Clean separation: campaigns describe WHAT to send; audiences describe
--       WHO receives it
--     • Queryable: SELECT COUNT(*) FROM address_book JOIN audience filters
--       can be done as a preview before sending
--     • Forward-compatible: audience configs can be shared/reused
--
--   campaigns.audience_key remains for backward compat with the existing
--   Phase 1 simple-segment UI. campaign_audiences extends this for R2.

CREATE TABLE IF NOT EXISTS public.campaign_audiences (
  -- ── Identity ───────────────────────────────────────────────────────────
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            TEXT         NOT NULL,
  campaign_id          UUID         NOT NULL,
    -- References public.campaigns(id). NOT declared as FK here because
    -- campaigns.id type must be confirmed live; use app-layer integrity.
    -- Add FK constraint after verifying campaigns.id is UUID in live DB.

  -- ── Geographic Filters ─────────────────────────────────────────────────
  -- NULL means "no filter applied" for that dimension.
  filter_zips          TEXT[],      -- match any: zip = ANY(filter_zips)
  filter_cities        TEXT[],      -- case-insensitive city IN list
  filter_states        TEXT[],      -- state IN list

  -- ── Tag Filter ─────────────────────────────────────────────────────────
  -- Contacts must have at least one of these tags (array overlap).
  -- NULL = no tag filter.
  filter_tags          TEXT[],

  -- ── Radius Filter (optional, geocoded contacts only) ───────────────────
  -- Only applied when contacts have coordinate_status = 'geocoded' or 'manual'.
  -- origin_lat/lon = center point (e.g., office address).
  -- radius_km = max distance from center.
  -- NULL = no radius filter.
  filter_origin_lat    NUMERIC(10,7),
  filter_origin_lon    NUMERIC(10,7),
  filter_radius_km     NUMERIC(6,2),

  -- ── Consent Gate ───────────────────────────────────────────────────────
  -- Which consent flag must be TRUE for a contact to be included.
  -- This gates outbound sends: if the campaign channel is 'sms', only
  -- contacts with sms_consent = true are included. Enforced at query time
  -- and at send time (dual enforcement).
  require_sms_consent          BOOLEAN NOT NULL DEFAULT false,
  require_whatsapp_consent     BOOLEAN NOT NULL DEFAULT false,
  require_email_consent        BOOLEAN NOT NULL DEFAULT false,

  -- ── Language Filter ────────────────────────────────────────────────────
  -- NULL = send to all languages (both en + es available)
  filter_language      TEXT         CHECK (filter_language IN ('en', 'es')),

  -- ── Audit ──────────────────────────────────────────────────────────────
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by           UUID         REFERENCES auth.users(id)
);

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ca_tenant_id
  ON public.campaign_audiences (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ca_campaign_id
  ON public.campaign_audiences (campaign_id);

-- GIN indexes for array filter columns
CREATE INDEX IF NOT EXISTS idx_ca_filter_tags
  ON public.campaign_audiences USING GIN (filter_tags);

CREATE INDEX IF NOT EXISTS idx_ca_filter_zips
  ON public.campaign_audiences USING GIN (filter_zips);

-- ── Trigger ────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_ca_updated_at ON public.campaign_audiences;
CREATE TRIGGER trg_ca_updated_at
  BEFORE UPDATE ON public.campaign_audiences
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- RLS — campaign_audiences
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.campaign_audiences ENABLE ROW LEVEL SECURITY;

-- HQ + Office: full access to own tenant audience configs
CREATE POLICY ca_hq_office_all ON public.campaign_audiences
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

-- ── FIX 1 — campaign_audiences driver block: RESTRICTIVE policy ──────────────
-- V1 used ca_driver_anon_blocked as a single permissive policy covering both
-- drivers and anon under authenticated role. That pattern is doubly wrong:
--   (a) anon is not in the authenticated role, so the TO authenticated clause
--       never applied to anon at all;
--   (b) a permissive USING (false) for drivers does NOT block them when
--       ca_hq_office_all also grants access (OR-logic allows either to win).
--
-- V2 fix: two separate RESTRICTIVE policies — one for driver role, one for anon.
-- RESTRICTIVE uses AND-logic: the caller must pass this in addition to any
-- permissive grant. This hard-blocks both roles unconditionally.

CREATE POLICY ca_driver_blocked ON public.campaign_audiences
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (
    get_user_role() <> 'driver'
  );

CREATE POLICY ca_anon_blocked ON public.campaign_audiences
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false);


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3: HELPER VIEW — v_campaign_audience_contacts
-- Returns all address_book contacts that match a given campaign_audience row.
-- Use for "preview audience size" before sending.
-- ════════════════════════════════════════════════════════════════════════════

-- ── FIX 2 — View security: security_invoker = true ───────────────────────────
-- V1 did not declare security_invoker, so the view ran as the definer (elevated)
-- and bypassed RLS on address_book and campaign_audiences. Any caller — including
-- anon — could potentially resolve audience contacts through the view even if
-- RLS blocked the underlying tables directly.
--
-- WITH (security_invoker = true) requires PostgreSQL 15+. Supabase projects on
-- pg15+ support this option on views. If this migration is applied to a pg14
-- instance, the CREATE OR REPLACE VIEW will error; in that case, drop this view
-- and replace it with a SECURITY DEFINER function that explicitly calls
-- is_member(tenant_id) before returning rows (see comment at end of section).
--
-- Supabase.io cloud projects have been on pg15 since 2023-06. This project
-- targets pg15+ per confirmed live DB version. security_invoker is correct here.

CREATE OR REPLACE VIEW public.v_campaign_audience_contacts
  WITH (security_invoker = true)
AS
SELECT
  ca.id                   AS audience_id,
  ca.campaign_id,
  ca.tenant_id,
  ab.id                   AS contact_id,
  ab.name,
  ab.phone,
  ab.whatsapp,
  ab.email,
  ab.preferred_language,
  ab.sms_consent,
  ab.whatsapp_consent,
  ab.email_consent,
  ab.tags,
  ab.city,
  ab.state,
  ab.zip,
  ab.lat,
  ab.lon,
  -- Distance in km from audience origin (NULL if no radius filter or no coords)
  CASE
    WHEN ca.filter_origin_lat IS NOT NULL
     AND ca.filter_origin_lon IS NOT NULL
     AND ab.lat IS NOT NULL
     AND ab.lon IS NOT NULL
    THEN
      -- Haversine approximation (accurate enough for < 200km)
      6371.0 * 2 * ASIN(
        SQRT(
          POWER(SIN(RADIANS(ab.lat - ca.filter_origin_lat) / 2), 2) +
          COS(RADIANS(ca.filter_origin_lat)) *
          COS(RADIANS(ab.lat)) *
          POWER(SIN(RADIANS(ab.lon - ca.filter_origin_lon) / 2), 2)
        )
      )
    ELSE NULL
  END                      AS distance_km
FROM
  public.campaign_audiences ca
  JOIN public.address_book ab ON ab.tenant_id = ca.tenant_id
WHERE
  -- Always: active contacts only
  ab.is_active = true

  -- Geographic filters (all NULL = no filter on that dimension)
  AND (ca.filter_zips   IS NULL OR ab.zip   = ANY(ca.filter_zips))
  AND (ca.filter_cities IS NULL OR lower(ab.city)  = ANY(
         SELECT lower(c) FROM unnest(ca.filter_cities) AS c))
  AND (ca.filter_states IS NULL OR ab.state = ANY(ca.filter_states))

  -- Tag overlap: contact must have at least one of the audience tags
  AND (ca.filter_tags IS NULL OR ab.tags && ca.filter_tags)

  -- Language filter
  AND (ca.filter_language IS NULL OR ab.preferred_language = ca.filter_language)

  -- ── FIX 3 — Radius filter: explicit NULL-coordinate guard ─────────────────
  -- V1 allowed the Haversine calculation to proceed when the outer OR clauses
  -- short-circuited (filter_origin_lat IS NULL OR filter_radius_km IS NULL OR
  -- ab.lat IS NULL OR ab.lon IS NULL). While the outer NULL checks prevented
  -- the formula from executing in most paths, the logic was not explicit about
  -- coordinate_status. A contact with lat IS NULL but coordinate_status = 'failed'
  -- could produce undefined behavior if the planner reordered conditions.
  --
  -- V2 fix: when a radius filter IS specified (origin_lat/lon and radius_km are
  -- all non-NULL), the contact MUST have both lat and lon non-NULL AND
  -- coordinate_status IN ('geocoded', 'manual'). Contacts without verified
  -- coordinates are excluded from radius-filtered audiences rather than
  -- producing an error or silently appearing.
  AND (
    -- No radius filter specified — pass all contacts through
    ca.filter_origin_lat IS NULL
    OR ca.filter_origin_lon IS NULL
    OR ca.filter_radius_km IS NULL
    -- Radius filter IS specified: contact must have verified coordinates
    OR (
      ab.lat IS NOT NULL
      AND ab.lon IS NOT NULL
      AND ab.coordinate_status IN ('geocoded', 'manual')
      AND (
        6371.0 * 2 * ASIN(
          SQRT(
            POWER(SIN(RADIANS(ab.lat - ca.filter_origin_lat) / 2), 2) +
            COS(RADIANS(ca.filter_origin_lat)) *
            COS(RADIANS(ab.lat)) *
            POWER(SIN(RADIANS(ab.lon - ca.filter_origin_lon) / 2), 2)
          )
        ) <= ca.filter_radius_km
      )
    )
  )

  -- Consent gates (dual enforcement: audience config + contact record)
  AND (NOT ca.require_sms_consent      OR ab.sms_consent      = true)
  AND (NOT ca.require_whatsapp_consent OR ab.whatsapp_consent  = true)
  AND (NOT ca.require_email_consent    OR ab.email_consent     = true);

COMMENT ON VIEW public.v_campaign_audience_contacts IS
  'Resolves address_book contacts matching a campaign_audiences filter row. '
  'Used for audience preview count and send-time contact resolution. '
  'All consent gates, geo filters, and tag filters applied. '
  'security_invoker=true: view runs as the caller — RLS on underlying tables '
  'is enforced. Requires PostgreSQL 15+. '
  'V2: radius filter now requires coordinate_status IN (geocoded, manual).';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4: import_contacts_from_orders(p_tenant_id TEXT)
-- ════════════════════════════════════════════════════════════════════════════
--
-- PURPOSE:
--   Populate address_book from existing orders for a given tenant.
--   Idempotent: safe to run multiple times — never overwrites existing contacts.
--
-- DEDUPLICATION STRATEGY:
--   Primary key: phone (normalized, digits only, 10+ digits)
--   Secondary key: name + address (when phone is absent/short)
--   Priority order:
--     1. If a contact with same phone already exists → SKIP (preserve existing)
--     2. If no phone match but name+address match → SKIP
--     3. Otherwise → INSERT
--
-- CONSENT (V2 — FIX 4):
--   V1 used bool_or(sms_opted_in) which returns true if ANY historical order
--   had consent=true, even if the most recent order revoked it. Consent must
--   reflect the LATEST recorded state, not a historical OR.
--
--   V2 uses DISTINCT ON (normalized_phone) ORDER BY created_at DESC to select
--   only the most recent order per customer, then reads consent from that row.
--   The consent_updated_at is also taken from the most recent order.
--
-- SOURCE:
--   source = 'imported_from_orders'
--   Never sets source to 'manual' — manually entered contacts are protected.
--
-- SAFETY:
--   SECURITY DEFINER so it can read orders across the RLS boundary.
--   Caller must be authenticated and a member of p_tenant_id.
--   SET search_path = '' for security.
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

  -- Only HQ and Office may run imports
  IF public.get_user_role() NOT IN ('hq', 'office', 'owner', 'admin') THEN
    RAISE EXCEPTION 'import_contacts_from_orders: insufficient role — HQ or Office required';
  END IF;

  -- ── FIX 4 — Consent from most-recent order only ───────────────────────────
  -- V1 used GROUP BY + bool_or() which ORed consent across all orders for a
  -- customer. This meant a customer who opted in once but later opted out
  -- would still be imported with sms_consent=true.
  --
  -- V2 strategy:
  --   Step 1: Use DISTINCT ON (normalized_phone) ORDER BY created_at DESC
  --           to get the single most-recent order per customer (by phone).
  --           This is the authoritative consent record.
  --   Step 2: For customers with no usable phone, fall back to
  --           DISTINCT ON (name, address) ordered the same way.
  --
  -- The CTE below selects the latest order per normalized phone, falling back
  -- to name+address for phone-less orders. Consent (sms_opted_in,
  -- whatsapp_opted_in) and consent_recorded_at are taken from that single row.
  --
  -- NOTE: orders table columns referenced:
  --   o.name, o.phone, o.whatsapp, o.address, o.city, o.state, o.zip,
  --   o.email, o.sms_opted_in (BOOLEAN), o.whatsapp_opted_in (BOOLEAN),
  --   o.consent_recorded_at (TIMESTAMPTZ), o.created_at (TIMESTAMPTZ)
  -- These match the established orders schema from R1/R6.

  FOR rec IN
    -- Select the most recent order per unique customer (by normalized phone)
    SELECT DISTINCT ON (
      CASE
        WHEN length(regexp_replace(COALESCE(o.phone, ''), '\D', '', 'g')) >= 7
        THEN regexp_replace(COALESCE(o.phone, ''), '\D', '', 'g')
        ELSE lower(trim(COALESCE(o.name, ''))) || '|' || lower(trim(COALESCE(o.address, '')))
      END
    )
      o.name,
      o.phone,
      o.whatsapp,
      o.address,
      o.city,
      o.state,
      o.zip,
      o.email,
      -- Consent from THIS order only (the most recent one, per ORDER BY below)
      COALESCE(o.sms_opted_in, false)        AS sms_consent,
      COALESCE(o.whatsapp_opted_in, false)   AS whatsapp_consent,
      o.consent_recorded_at                  AS consent_updated_at
    FROM public.orders o
    WHERE o.tenant_id = p_tenant_id
      AND trim(COALESCE(o.name, '')) <> ''   -- must have a name
    ORDER BY
      -- Dedup key (must match DISTINCT ON expression exactly)
      CASE
        WHEN length(regexp_replace(COALESCE(o.phone, ''), '\D', '', 'g')) >= 7
        THEN regexp_replace(COALESCE(o.phone, ''), '\D', '', 'g')
        ELSE lower(trim(COALESCE(o.name, ''))) || '|' || lower(trim(COALESCE(o.address, '')))
      END,
      -- Most-recent order wins: consent from latest created_at
      o.created_at DESC
  LOOP
    BEGIN
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
        -- Contact already exists — skip, do NOT overwrite
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Insert new contact
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
        sms_consent,
        whatsapp_consent,
        email_consent,
        consent_updated_at,
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
        rec.sms_consent,           -- from most-recent order only (FIX 4)
        rec.whatsapp_consent,      -- from most-recent order only (FIX 4)
        false,                     -- email_consent always false on import
        rec.consent_updated_at,
        'imported_from_orders',
        true
      );

      v_imported := v_imported + 1;

    EXCEPTION WHEN OTHERS THEN
      -- Log the error but continue importing remaining contacts
      RAISE WARNING 'import_contacts_from_orders: skipping contact % due to error: %',
        rec.name, SQLERRM;
      v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_imported, v_skipped, v_errors;
END;
$$;

COMMENT ON FUNCTION public.import_contacts_from_orders(TEXT) IS
  'Imports unique customers from orders into address_book for the given tenant. '
  'Deduplicates by phone (primary) then name+address (secondary). '
  'Never overwrites existing contacts. Sets source=imported_from_orders. '
  'Idempotent — safe to run multiple times. Requires HQ or Office role. '
  'V2: consent taken from most-recent order per customer (DISTINCT ON + ORDER BY '
  'created_at DESC) instead of bool_or() across all historical orders.';

-- Grant execute to authenticated role only (SECURITY DEFINER handles the rest)
GRANT EXECUTE ON FUNCTION public.import_contacts_from_orders(TEXT)
  TO authenticated;


COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- POST-COMMIT VERIFY V1–V8
-- Run AFTER applying migration — confirm expected results before Jeffrey signs off.
-- ════════════════════════════════════════════════════════════════════════════

-- V1: Confirm RLS is enabled on both new tables.
-- Expected: 2 rows, both rowsecurity = true

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('address_book', 'campaign_audiences')
ORDER BY tablename;

-- V2: Confirm all policies exist on address_book.
-- Expected: 3 rows:
--   ab_hq_office_all (ALL, permissive)
--   ab_driver_select (SELECT, permissive)
--   ab_anon_blocked  (ALL, RESTRICTIVE) ← V2: now RESTRICTIVE

SELECT policyname, cmd, roles, permissive
FROM pg_policies
WHERE tablename = 'address_book'
ORDER BY policyname;

-- V3: Confirm all policies exist on campaign_audiences.
-- Expected: 3 rows:
--   ca_hq_office_all   (ALL, permissive)
--   ca_driver_blocked  (ALL, RESTRICTIVE) ← V2: was ca_driver_anon_blocked permissive
--   ca_anon_blocked    (ALL, RESTRICTIVE) ← V2: now RESTRICTIVE

SELECT policyname, cmd, roles, permissive
FROM pg_policies
WHERE tablename = 'campaign_audiences'
ORDER BY policyname;

-- V4: Confirm anon is hard-blocked on both tables.
-- Run as anon role in Supabase SQL editor: SET ROLE anon;
-- Expected: 0 rows (RESTRICTIVE policy blocks unconditionally)

-- SET ROLE anon;
-- SELECT COUNT(*) FROM public.address_book;
-- SELECT COUNT(*) FROM public.campaign_audiences;
-- RESET ROLE;

-- V5: Confirm consent columns exist with correct defaults.
-- Expected: 3 rows, all column_default = 'false'

SELECT column_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'address_book'
  AND column_name IN ('sms_consent', 'whatsapp_consent', 'email_consent')
ORDER BY column_name;

-- V6: Confirm coordinate_status CHECK constraint values.
-- Expected: constraint text includes 'unverified', 'geocoded', 'manual', 'failed'

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.address_book'::regclass
  AND conname LIKE '%coordinate%';

-- V7: Confirm the import function exists and is SECURITY DEFINER.
-- Expected: 1 row, prosecdef = true

SELECT proname, prosecdef, provolatile
FROM pg_proc
WHERE proname = 'import_contacts_from_orders'
  AND pronamespace = 'public'::regnamespace;

-- V8: Confirm view uses security_invoker.
-- Expected: 1 row with security_invoker = true option set on the view.

SELECT viewname, definition
FROM pg_views
WHERE schemaname = 'public'
  AND viewname = 'v_campaign_audience_contacts';

-- Cross-check view options (pg15+):
SELECT relname, reloptions
FROM pg_class
WHERE relname = 'v_campaign_audience_contacts'
  AND relnamespace = 'public'::regnamespace;

-- V9 (bonus): Dry-run dedup test — how many unique contacts would import?
-- Replace 'your-tenant-id' with the actual tenant_id.
-- Expected: totals match business expectation.

-- SELECT
--   COUNT(DISTINCT
--     CASE WHEN length(regexp_replace(COALESCE(phone,''),'\D','','g')) >= 7
--          THEN regexp_replace(COALESCE(phone,''),'\D','','g')
--          ELSE lower(trim(name)) || '|' || lower(trim(COALESCE(address,'')))
--     END
--   ) AS distinct_candidates,
--   COUNT(*) AS total_order_rows
-- FROM public.orders
-- WHERE tenant_id = 'your-tenant-id'
--   AND trim(COALESCE(name,'')) <> '';
