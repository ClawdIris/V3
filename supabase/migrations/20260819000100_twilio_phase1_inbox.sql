-- Twilio Phase 1 two-way SMS inbox foundation.
-- FILE-ONLY DRAFT. Do not apply to production until exact-file review and explicit go.
-- Rollback: supabase/migrations/20260819000100_twilio_phase1_inbox_rollback.sql
--
-- Critical beta rulings encoded here:
--   * tracking_alert_consents is canonical current state; sms_consents remains evidence only.
--   * Revoked/STOPped numbers block all outbound texts, transactional and marketing.
--   * Unknown inbound messages persist as HQ-only triage threads.
--   * HQ reads tenant-wide; Office reads office-scoped; Drivers have no inbox policies.
--   * Public webhook writes are service-role/RPC only; anon has no table access.

BEGIN;

DO $$
DECLARE
  v_messages_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_messages_count FROM public.messages;
  IF v_messages_count <> 0 THEN
    RAISE EXCEPTION 'twilio_phase1_zero_row_assertion_failed: public.messages has % rows', v_messages_count
      USING ERRCODE = 'P0001';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.messaging_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  office_id uuid NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  messaging_service_sid text NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_messaging_numbers_active_channel_phone
  ON public.messaging_numbers(channel, phone_e164)
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_messaging_numbers_tenant_active
  ON public.messaging_numbers(tenant_id, active);

CREATE TABLE IF NOT EXISTS public.message_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  office_id uuid NULL,
  order_id text NULL,
  customer_id uuid NULL,
  customer_phone_e164 text NOT NULL CHECK (customer_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  provider_phone_e164 text NOT NULL CHECK (provider_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
  customer_display_name text NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'spam')),
  assigned_member_id uuid NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_preview text NULL,
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_threads_provider_active_fk
    FOREIGN KEY (channel, provider_phone_e164)
    REFERENCES public.messaging_numbers(channel, phone_e164)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_message_threads_open_conversation
  ON public.message_threads(tenant_id, channel, provider_phone_e164, customer_phone_e164)
  WHERE status <> 'spam';

CREATE INDEX IF NOT EXISTS idx_message_threads_tenant_recent
  ON public.message_threads(tenant_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_threads_office_recent
  ON public.message_threads(tenant_id, office_id, last_message_at DESC)
  WHERE office_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_threads_order
  ON public.message_threads(tenant_id, order_id)
  WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_threads_unread
  ON public.message_threads(tenant_id, unread_count, last_message_at DESC)
  WHERE unread_count > 0;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS thread_id uuid NULL,
  ADD COLUMN IF NOT EXISTS office_id uuid NULL,
  ADD COLUMN IF NOT EXISTS direction text NULL,
  ADD COLUMN IF NOT EXISTS sender_phone_e164 text NULL,
  ADD COLUMN IF NOT EXISTS recipient_phone_e164 text NULL,
  ADD COLUMN IF NOT EXISTS body text NULL,
  ADD COLUMN IF NOT EXISTS provider_status text NULL,
  ADD COLUMN IF NOT EXISTS provider_error_code text NULL,
  ADD COLUMN IF NOT EXISTS provider_error_message text NULL,
  ADD COLUMN IF NOT EXISTS received_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS queued_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.messages
  ALTER COLUMN template_key DROP NOT NULL,
  ALTER COLUMN recipient_phone DROP NOT NULL,
  ALTER COLUMN rendered_body DROP NOT NULL,
  ALTER COLUMN created_by DROP NOT NULL,
  ALTER COLUMN status SET DEFAULT 'queued';

ALTER TABLE public.messages
  ALTER COLUMN created_by TYPE uuid USING
    CASE WHEN created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN created_by::uuid
      ELSE NULL
    END;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_direction_check,
  ADD CONSTRAINT messages_direction_check CHECK (direction IS NULL OR direction IN ('inbound', 'outbound')),
  DROP CONSTRAINT IF EXISTS messages_status_check,
  ADD CONSTRAINT messages_status_check CHECK (status IN ('draft', 'queued', 'accepted', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'blocked', 'cancelled', 'read')),
  DROP CONSTRAINT IF EXISTS messages_thread_fk,
  ADD CONSTRAINT messages_thread_fk FOREIGN KEY (thread_id) REFERENCES public.message_threads(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS messages_body_present,
  ADD CONSTRAINT messages_body_present CHECK (COALESCE(body, rendered_body) IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS ux_messages_provider_message_id
  ON public.messages(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_thread_created
  ON public.messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_thread_created
  ON public.messages(tenant_id, thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_office_created
  ON public.messages(tenant_id, office_id, created_at DESC)
  WHERE office_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_order_created
  ON public.messages(tenant_id, order_id, created_at DESC)
  WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.twilio_phase1_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messaging_numbers_updated_at ON public.messaging_numbers;
CREATE TRIGGER trg_messaging_numbers_updated_at
  BEFORE UPDATE ON public.messaging_numbers
  FOR EACH ROW EXECUTE FUNCTION public.twilio_phase1_touch_updated_at();

DROP TRIGGER IF EXISTS trg_message_threads_updated_at ON public.message_threads;
CREATE TRIGGER trg_message_threads_updated_at
  BEFORE UPDATE ON public.message_threads
  FOR EACH ROW EXECUTE FUNCTION public.twilio_phase1_touch_updated_at();

CREATE OR REPLACE FUNCTION public.twilio_normalize_e164(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
BEGIN
  IF v = '' THEN
    RETURN NULL;
  END IF;
  IF left(v, 1) <> '+' AND length(v) = 10 THEN
    v := '+1' || v;
  END IF;
  IF left(v, 1) <> '+' THEN
    v := '+' || regexp_replace(v, '[^0-9]', '', 'g');
  END IF;
  IF v !~ '^\+[1-9][0-9]{7,14}$' THEN
    RETURN NULL;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.twilio_current_member()
RETURNS TABLE(tenant_id text, role text, office_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.tenant_id, COALESCE(m.app_role, m.role), m.office_id
  FROM public.members m
  WHERE m.user_id = auth.uid()
    AND m.active = true
  ORDER BY m.created_at
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.resolve_sms_eligibility(
  p_tenant_id text,
  p_phone_e164 text,
  p_category text DEFAULT 'transactional'
)
RETURNS TABLE(allowed boolean, reason text, transactional_allowed boolean, marketing_allowed boolean, revoked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := public.twilio_normalize_e164(p_phone_e164);
  v_category text := lower(coalesce(nullif(p_category, ''), 'transactional'));
  v_tx boolean := false;
  v_mkt boolean := false;
  v_revoked boolean := false;
  v_status text;
BEGIN
  IF p_tenant_id IS NULL OR v_phone IS NULL THEN
    RETURN QUERY SELECT false, 'invalid_phone', false, false, false;
    RETURN;
  END IF;

  IF to_regclass('public.tracking_alert_consents') IS NOT NULL THEN
    SELECT
      COALESCE(bool_or(COALESCE(transactional_opted_in, package_alerts_opted_in, sms_opted_in, false)), false),
      COALESCE(bool_or(COALESCE(marketing_opted_in, false)), false),
      COALESCE(bool_or(revoked_at IS NOT NULL OR lower(COALESCE(status, '')) IN ('revoked', 'stopped', 'opted_out')), false),
      max(status)
    INTO v_tx, v_mkt, v_revoked, v_status
    FROM public.tracking_alert_consents
    WHERE tenant_id = p_tenant_id
      AND phone_e164 = v_phone;
  END IF;

  IF v_revoked THEN
    RETURN QUERY SELECT false, 'consent_revoked', v_tx, v_mkt, true;
    RETURN;
  END IF;

  IF v_category = 'marketing' AND NOT v_mkt THEN
    RETURN QUERY SELECT false, 'marketing_consent_required', v_tx, v_mkt, false;
    RETURN;
  END IF;

  IF v_category <> 'marketing' AND NOT v_tx THEN
    RETURN QUERY SELECT false, 'transactional_consent_required', v_tx, v_mkt, false;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'allowed', v_tx, v_mkt, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_sms_keyword_event(
  p_tenant_id text,
  p_phone_e164 text,
  p_opt_out_type text,
  p_message_sid text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := public.twilio_normalize_e164(p_phone_e164);
  v_type text := upper(coalesce(p_opt_out_type, ''));
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_tenant_id IS NULL OR v_phone IS NULL OR p_message_sid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'keyword_event_invalid';
  END IF;

  IF to_regclass('public.tracking_alert_consents') IS NOT NULL THEN
    IF v_type = 'STOP' THEN
      UPDATE public.tracking_alert_consents
      SET revoked_at = COALESCE(revoked_at, v_now),
          status = 'revoked',
          updated_at = v_now
      WHERE tenant_id = p_tenant_id
        AND phone_e164 = v_phone
        AND (metadata->>'last_stop_message_sid') IS DISTINCT FROM p_message_sid;
    ELSIF v_type = 'START' THEN
      UPDATE public.tracking_alert_consents
      SET revoked_at = NULL,
          status = CASE WHEN COALESCE(transactional_opted_in, package_alerts_opted_in, sms_opted_in, false) THEN 'active' ELSE status END,
          updated_at = v_now
      WHERE tenant_id = p_tenant_id
        AND phone_e164 = v_phone
        AND (metadata->>'last_start_message_sid') IS DISTINCT FROM p_message_sid;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'type', v_type, 'phone_e164', v_phone);
END;
$$;

CREATE OR REPLACE FUNCTION public.inbox_visible_thread(p_thread public.message_threads)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v public.twilio_current_member%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.twilio_current_member();
  IF v.tenant_id IS NULL OR v.tenant_id <> p_thread.tenant_id THEN
    RETURN false;
  END IF;
  IF v.role IN ('hq', 'admin', 'owner') THEN
    RETURN true;
  END IF;
  IF v.role = 'office' THEN
    RETURN p_thread.office_id IS NOT NULL AND p_thread.office_id = v.office_id;
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.inbox_list_threads(p_filter jsonb DEFAULT '{}'::jsonb)
RETURNS SETOF public.message_threads
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT t.*
  FROM public.message_threads t
  WHERE public.inbox_visible_thread(t)
    AND (COALESCE(p_filter->>'status', '') = '' OR t.status = p_filter->>'status')
    AND (COALESCE((p_filter->>'unread')::boolean, false) = false OR t.unread_count > 0)
    AND (COALESCE((p_filter->>'unmatched')::boolean, false) = false OR t.office_id IS NULL OR t.order_id IS NULL)
    AND (
      COALESCE(p_filter->>'q', '') = ''
      OR t.customer_phone_e164 ILIKE '%' || p_filter->>'q' || '%'
      OR COALESCE(t.customer_display_name, '') ILIKE '%' || p_filter->>'q' || '%'
      OR COALESCE(t.order_id, '') ILIKE '%' || p_filter->>'q' || '%'
    )
  ORDER BY t.last_message_at DESC
  LIMIT LEAST(COALESCE((p_filter->>'limit')::int, 50), 100)
$$;

CREATE OR REPLACE FUNCTION public.inbox_list_messages(p_thread_id uuid)
RETURNS SETOF public.messages
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT m.*
  FROM public.messages m
  JOIN public.message_threads t ON t.id = m.thread_id
  WHERE t.id = p_thread_id
    AND public.inbox_visible_thread(t)
  ORDER BY m.created_at ASC
$$;

CREATE OR REPLACE FUNCTION public.inbox_mark_read(p_thread_id uuid, p_read boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_thread public.message_threads%ROWTYPE;
BEGIN
  SELECT * INTO v_thread FROM public.message_threads WHERE id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR NOT public.inbox_visible_thread(v_thread) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'inbox_denied';
  END IF;

  UPDATE public.message_threads
  SET unread_count = CASE WHEN p_read THEN 0 ELSE GREATEST(unread_count, 1) END,
      updated_at = now()
  WHERE id = p_thread_id;

  RETURN jsonb_build_object('success', true, 'changed', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.inbox_set_thread_status(p_thread_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_thread public.message_threads%ROWTYPE;
  v_status text := lower(coalesce(p_status, ''));
BEGIN
  IF v_status NOT IN ('open', 'closed', 'spam') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'thread_status_invalid';
  END IF;
  SELECT * INTO v_thread FROM public.message_threads WHERE id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR NOT public.inbox_visible_thread(v_thread) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'inbox_denied';
  END IF;
  UPDATE public.message_threads SET status = v_status, updated_at = now() WHERE id = p_thread_id;
  RETURN jsonb_build_object('success', true, 'status', v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.inbox_assign_thread(p_thread_id uuid, p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_thread public.message_threads%ROWTYPE;
  v_member_office uuid;
BEGIN
  SELECT * INTO v_thread FROM public.message_threads WHERE id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR NOT public.inbox_visible_thread(v_thread) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'inbox_denied';
  END IF;
  IF p_member_id IS NOT NULL THEN
    SELECT office_id INTO v_member_office
    FROM public.members
    WHERE user_id = p_member_id
      AND tenant_id = v_thread.tenant_id
      AND active = true
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'inbox_denied';
    END IF;
  END IF;
  UPDATE public.message_threads SET assigned_member_id = p_member_id, updated_at = now() WHERE id = p_thread_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.inbox_link_thread_order(p_thread_id uuid, p_order_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_thread public.message_threads%ROWTYPE;
  v_order record;
BEGIN
  SELECT * INTO v_thread FROM public.message_threads WHERE id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR NOT public.inbox_visible_thread(v_thread) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'inbox_denied';
  END IF;
  SELECT id, tenant_id, office_id, data INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND tenant_id = v_thread.tenant_id
    AND public.twilio_normalize_e164(COALESCE(data->>'phone', data->>'customer_phone', data->>'recipient_phone')) = v_thread.customer_phone_e164
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'inbox_denied';
  END IF;
  UPDATE public.message_threads
  SET order_id = v_order.id, office_id = v_order.office_id, updated_at = now()
  WHERE id = p_thread_id;
  UPDATE public.messages
  SET order_id = v_order.id, office_id = v_order.office_id, updated_at = now()
  WHERE thread_id = p_thread_id;
  RETURN jsonb_build_object('success', true, 'order_id', v_order.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.twilio_ingest_inbound(
  p_message_sid text,
  p_account_sid text,
  p_from text,
  p_to text,
  p_body text,
  p_opt_out_type text DEFAULT NULL,
  p_num_media int DEFAULT 0,
  p_raw jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from text := public.twilio_normalize_e164(p_from);
  v_to text := public.twilio_normalize_e164(p_to);
  v_number public.messaging_numbers%ROWTYPE;
  v_thread_id uuid;
  v_message_id uuid;
  v_body text := left(coalesce(p_body, ''), 1600);
  v_preview text := left(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'), 140);
  v_keyword text := upper(coalesce(nullif(p_opt_out_type, ''), ''));
BEGIN
  IF p_message_sid IS NULL OR v_from IS NULL OR v_to IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'twilio_inbound_invalid';
  END IF;

  SELECT * INTO v_number
  FROM public.messaging_numbers
  WHERE channel = 'sms'
    AND phone_e164 = v_to
    AND active = true
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'twilio_unknown_to';
  END IF;

  SELECT m.id INTO v_message_id
  FROM public.messages m
  WHERE m.provider_message_id = p_message_sid
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'changed', false, 'message_id', v_message_id);
  END IF;

  SELECT id INTO v_thread_id
  FROM public.message_threads
  WHERE tenant_id = v_number.tenant_id
    AND channel = 'sms'
    AND provider_phone_e164 = v_to
    AND customer_phone_e164 = v_from
    AND status <> 'spam'
  ORDER BY last_message_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.message_threads (
      tenant_id, office_id, customer_phone_e164, provider_phone_e164, channel,
      status, last_message_at, last_message_preview, unread_count
    )
    VALUES (
      v_number.tenant_id, v_number.office_id, v_from, v_to, 'sms',
      'open', now(), v_preview, 0
    )
    RETURNING id INTO v_thread_id;
  END IF;

  INSERT INTO public.messages (
    tenant_id, office_id, thread_id, direction, channel,
    sender_phone_e164, recipient_phone_e164, body, rendered_body,
    status, provider_message_id, provider_status, received_at, metadata, created_by
  )
  VALUES (
    v_number.tenant_id, v_number.office_id, v_thread_id, 'inbound', 'sms',
    v_from, v_to, v_body, v_body,
    'delivered', p_message_sid, 'received', now(),
    jsonb_build_object('account_sid', p_account_sid, 'num_media', coalesce(p_num_media, 0), 'opt_out_type', v_keyword, 'raw', coalesce(p_raw, '{}'::jsonb)),
    NULL
  )
  RETURNING id INTO v_message_id;

  UPDATE public.message_threads
  SET last_message_at = now(),
      last_message_preview = v_preview,
      unread_count = unread_count + 1,
      status = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
      updated_at = now()
  WHERE id = v_thread_id;

  IF v_keyword IN ('STOP', 'START', 'HELP') THEN
    PERFORM public.record_sms_keyword_event(v_number.tenant_id, v_from, v_keyword, p_message_sid);
  END IF;

  RETURN jsonb_build_object('success', true, 'changed', true, 'thread_id', v_thread_id, 'message_id', v_message_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.twilio_apply_status_callback(
  p_message_sid text,
  p_message_status text,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_raw jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text := lower(coalesce(p_message_status, ''));
  v_rank int;
  v_existing text;
  v_existing_rank int;
  v_app_status text;
BEGIN
  IF p_message_sid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'status_callback_invalid';
  END IF;

  v_rank := CASE v_status
    WHEN 'queued' THEN 10
    WHEN 'accepted' THEN 20
    WHEN 'sending' THEN 30
    WHEN 'sent' THEN 40
    WHEN 'delivered' THEN 50
    WHEN 'undelivered' THEN 60
    WHEN 'failed' THEN 70
    ELSE 0
  END;
  v_app_status := CASE WHEN v_status IN ('queued','accepted','sending','sent','delivered','undelivered','failed') THEN v_status ELSE 'accepted' END;

  SELECT provider_status INTO v_existing
  FROM public.messages
  WHERE provider_message_id = p_message_sid
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'changed', false, 'reason', 'unknown_message_sid');
  END IF;

  v_existing_rank := CASE lower(coalesce(v_existing, ''))
    WHEN 'queued' THEN 10
    WHEN 'accepted' THEN 20
    WHEN 'sending' THEN 30
    WHEN 'sent' THEN 40
    WHEN 'delivered' THEN 50
    WHEN 'undelivered' THEN 60
    WHEN 'failed' THEN 70
    ELSE 0
  END;

  IF v_rank < v_existing_rank THEN
    RETURN jsonb_build_object('success', true, 'changed', false, 'provider_status', v_existing);
  END IF;

  UPDATE public.messages
  SET provider_status = v_status,
      provider_error_code = nullif(p_error_code, ''),
      provider_error_message = nullif(left(coalesce(p_error_message, ''), 500), ''),
      status = v_app_status,
      delivered_at = CASE WHEN v_status = 'delivered' THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
      failed_at = CASE WHEN v_status IN ('undelivered', 'failed') THEN COALESCE(failed_at, now()) ELSE failed_at END,
      metadata = metadata || jsonb_build_object('last_status_callback', coalesce(p_raw, '{}'::jsonb)),
      updated_at = now()
  WHERE provider_message_id = p_message_sid;

  RETURN jsonb_build_object('success', true, 'changed', true, 'provider_status', v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.inbox_send_message(
  p_thread_id uuid,
  p_body text,
  p_template_key text DEFAULT NULL,
  p_category text DEFAULT 'transactional'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_thread public.message_threads%ROWTYPE;
  v_member public.twilio_current_member%ROWTYPE;
  v_body text := btrim(coalesce(p_body, ''));
  v_category text := lower(coalesce(nullif(p_category, ''), 'transactional'));
  v_elig record;
  v_message_id uuid;
BEGIN
  SELECT * INTO v_member FROM public.twilio_current_member();
  IF v_member.tenant_id IS NULL OR v_member.role NOT IN ('hq', 'admin', 'owner', 'office') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'inbox_send_denied';
  END IF;

  IF length(v_body) = 0 OR length(v_body) > 320 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'message_body_invalid';
  END IF;

  SELECT * INTO v_thread FROM public.message_threads WHERE id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR NOT public.inbox_visible_thread(v_thread) OR v_thread.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'inbox_send_denied';
  END IF;

  SELECT * INTO v_elig
  FROM public.resolve_sms_eligibility(v_thread.tenant_id, v_thread.customer_phone_e164, v_category);
  IF NOT COALESCE(v_elig.allowed, false) THEN
    IF v_elig.reason = 'consent_revoked' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'consent_revoked';
    END IF;
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = v_elig.reason;
  END IF;

  INSERT INTO public.messages (
    tenant_id, office_id, thread_id, order_id, direction, channel,
    sender_phone_e164, recipient_phone_e164, recipient_phone, template_key,
    body, rendered_body, status, provider_status, queued_at, created_by, metadata
  )
  VALUES (
    v_thread.tenant_id, v_thread.office_id, v_thread.id, v_thread.order_id, 'outbound', v_thread.channel,
    v_thread.provider_phone_e164, v_thread.customer_phone_e164, v_thread.customer_phone_e164, p_template_key,
    v_body, v_body, 'queued', 'queued', now(), auth.uid(),
    jsonb_build_object('category', v_category, 'created_via', 'inbox_send_message')
  )
  RETURNING id INTO v_message_id;

  UPDATE public.message_threads
  SET last_message_at = now(),
      last_message_preview = left(v_body, 140),
      updated_at = now()
  WHERE id = v_thread.id;

  RETURN jsonb_build_object('success', true, 'changed', true, 'message_id', v_message_id, 'provider_status', 'queued');
END;
$$;

ALTER TABLE public.messaging_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messaging_numbers_hq_select ON public.messaging_numbers;
CREATE POLICY messaging_numbers_hq_select ON public.messaging_numbers
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.twilio_current_member()) AND (SELECT role FROM public.twilio_current_member()) IN ('hq','admin','owner'));

DROP POLICY IF EXISTS message_threads_select_scoped ON public.message_threads;
CREATE POLICY message_threads_select_scoped ON public.message_threads
  FOR SELECT TO authenticated
  USING (public.inbox_visible_thread(message_threads));

DROP POLICY IF EXISTS messages_select_scoped ON public.messages;
CREATE POLICY messages_select_scoped ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = messages.thread_id
        AND public.inbox_visible_thread(t)
    )
  );

DROP POLICY IF EXISTS message_threads_no_client_insert ON public.message_threads;
DROP POLICY IF EXISTS message_threads_no_client_update ON public.message_threads;
DROP POLICY IF EXISTS messages_no_client_insert ON public.messages;
DROP POLICY IF EXISTS messages_no_client_update ON public.messages;

REVOKE ALL ON public.messaging_numbers, public.message_threads, public.messages FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.messaging_numbers, public.message_threads, public.messages FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_sms_eligibility(text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_sms_keyword_event(text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.twilio_ingest_inbound(text,text,text,text,text,text,int,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.twilio_apply_status_callback(text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inbox_list_threads(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inbox_list_messages(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inbox_send_message(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inbox_mark_read(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inbox_assign_thread(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inbox_set_thread_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inbox_link_thread_order(uuid,text) TO authenticated;

DO $$
DECLARE
  v_messages_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_messages_count FROM public.messages;
  IF v_messages_count <> 0 THEN
    RAISE EXCEPTION 'twilio_phase1_post_assertion_failed: public.messages has % rows', v_messages_count
      USING ERRCODE = 'P0001';
  END IF;

  IF has_table_privilege('anon', 'public.message_threads', 'SELECT')
     OR has_table_privilege('anon', 'public.messages', 'SELECT')
     OR has_function_privilege('anon', 'public.twilio_ingest_inbound(text,text,text,text,text,text,int,jsonb)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'twilio_phase1_acl_assertion_failed';
  END IF;
END $$;

COMMENT ON TABLE public.message_threads IS 'Twilio Phase 1 durable two-way inbox threads. Unknown/unmatched inbound rows remain HQ triage until server-side assignment.';
COMMENT ON FUNCTION public.resolve_sms_eligibility(text,text,text) IS 'Canonical SMS eligibility check. tracking_alert_consents is current-state; sms_consents is legacy evidence only. consent_revoked blocks all beta sends.';

COMMIT;
