-- Rollback for Twilio Phase 1 two-way SMS inbox foundation.
-- FILE-ONLY DRAFT. Review before applying.

BEGIN;

DROP POLICY IF EXISTS messaging_numbers_hq_select ON public.messaging_numbers;
DROP POLICY IF EXISTS message_threads_select_scoped ON public.message_threads;
DROP POLICY IF EXISTS messages_select_scoped ON public.messages;

DROP FUNCTION IF EXISTS public.inbox_link_thread_order(uuid,text);
DROP FUNCTION IF EXISTS public.inbox_set_thread_status(uuid,text);
DROP FUNCTION IF EXISTS public.inbox_assign_thread(uuid,uuid);
DROP FUNCTION IF EXISTS public.inbox_mark_read(uuid,boolean);
DROP FUNCTION IF EXISTS public.inbox_send_message(uuid,text,text,text);
DROP FUNCTION IF EXISTS public.inbox_list_messages(uuid);
DROP FUNCTION IF EXISTS public.inbox_list_threads(jsonb);
DROP FUNCTION IF EXISTS public.inbox_visible_thread(public.message_threads);
DROP FUNCTION IF EXISTS public.twilio_apply_status_callback(text,text,text,text,jsonb);
DROP FUNCTION IF EXISTS public.twilio_ingest_inbound(text,text,text,text,text,text,int,jsonb);
DROP FUNCTION IF EXISTS public.record_sms_keyword_event(text,text,text,text);
DROP FUNCTION IF EXISTS public.resolve_sms_eligibility(text,text,text);
DROP FUNCTION IF EXISTS public.twilio_current_member();
DROP FUNCTION IF EXISTS public.twilio_normalize_e164(text);

DROP TRIGGER IF EXISTS trg_message_threads_updated_at ON public.message_threads;
DROP TRIGGER IF EXISTS trg_messaging_numbers_updated_at ON public.messaging_numbers;
DROP FUNCTION IF EXISTS public.twilio_phase1_touch_updated_at();

DROP INDEX IF EXISTS public.idx_messages_order_created;
DROP INDEX IF EXISTS public.idx_messages_office_created;
DROP INDEX IF EXISTS public.idx_messages_tenant_thread_created;
DROP INDEX IF EXISTS public.idx_messages_thread_created;
DROP INDEX IF EXISTS public.ux_messages_provider_message_id;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_body_present,
  DROP CONSTRAINT IF EXISTS messages_thread_fk,
  DROP CONSTRAINT IF EXISTS messages_direction_check;

ALTER TABLE public.messages
  DROP COLUMN IF EXISTS metadata,
  DROP COLUMN IF EXISTS failed_at,
  DROP COLUMN IF EXISTS delivered_at,
  DROP COLUMN IF EXISTS queued_at,
  DROP COLUMN IF EXISTS received_at,
  DROP COLUMN IF EXISTS provider_error_message,
  DROP COLUMN IF EXISTS provider_error_code,
  DROP COLUMN IF EXISTS provider_status,
  DROP COLUMN IF EXISTS body,
  DROP COLUMN IF EXISTS recipient_phone_e164,
  DROP COLUMN IF EXISTS sender_phone_e164,
  DROP COLUMN IF EXISTS direction,
  DROP COLUMN IF EXISTS office_id,
  DROP COLUMN IF EXISTS thread_id;

ALTER TABLE public.messages
  ALTER COLUMN template_key SET NOT NULL,
  ALTER COLUMN recipient_phone SET NOT NULL,
  ALTER COLUMN rendered_body SET NOT NULL,
  ALTER COLUMN created_by TYPE text USING created_by::text,
  ALTER COLUMN created_by SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_status_check,
  ADD CONSTRAINT messages_status_check CHECK (status IN ('draft', 'queued', 'blocked', 'sent', 'failed', 'cancelled'));

DROP TABLE IF EXISTS public.message_threads;
DROP TABLE IF EXISTS public.messaging_numbers;

DO $$
DECLARE
  v_messages_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_messages_count FROM public.messages;
  IF v_messages_count <> 0 THEN
    RAISE EXCEPTION 'twilio_phase1_rollback_zero_row_assertion_failed: public.messages has % rows', v_messages_count
      USING ERRCODE = 'P0001';
  END IF;
END $$;

COMMIT;
