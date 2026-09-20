-- ═══════════════════════════════════════════════════════════════════════════
-- C2 — COLLECTION CONTACTS: LIST + IMPORT.  CORRECTED CANDIDATE.
-- FILE-ONLY. Applied ONLY to a disposable local cluster for the local proofs
-- in collection-office/tests. Never staging, never production. Not a GO.
-- Supersedes .handoff/CAND/sql/02_collection_contacts.sql (kept intact) per
-- GRANTS-CONTACT-REVIEW-C1-C2-20260920.md findings C2-1 … C2-9.
--
-- STATED CONTRACT (R2 asked for every one of these to be explicit):
--   Identity        (tenant_id, collection_office_id, external_ref) when an
--                   external_ref is supplied — office-scoped, DB-unique.
--                   No uniqueness on phone, email or name. Nobody is ever merged
--                   on phone or name: a phone already present for the office is
--                   REPORTED (ambiguous) and the row is inserted as a new person.
--   Normalization   external_ref: btrim, max 128, case-sensitive.
--                   phone: stored as supplied (btrim, max 32); COMPARED through
--                   ck_norm_phone() = optional leading '+' then digits only,
--                   backed by an expression index so the ambiguity probe is
--                   O(log n), not a scan.  email: btrim, lower(), max 254, must
--                   contain '@' when present.  name: btrim, 1..200.
--                   country: 2 upper-case letters when present, default 'US'.
--   Absent/both     external_ref absent  -> always a NEW contact (+ ambiguity
--                   report on phone).  external_ref present and matching an
--                   ACTIVE contact -> update of the SUPPLIED fields only; a
--                   field that is not a key in the row is left untouched, and a
--                   supplied empty name is invalid. external_ref matching only
--                   an INACTIVE contact -> skipped and reported; never modified.
--   Source          address_book.source = 'collection_import'. The office is
--                   the namespace of external_ref; two offices may reuse a ref.
--   Limits          rows per batch 1..500; replay_key 1..128; field limits as
--                   above. Violations refuse the WHOLE batch (see policy).
--   Policy          ATOMIC per batch: every row is validated before any write;
--                   any invalid row -> nothing is written, and the structured
--                   error lists every offending (index, field, code).
--   Idempotency     collection_import_batches keyed (tenant, office, replay_key)
--                   with the sha256 of the canonical jsonb payload. Same key +
--                   same payload -> the stored result is returned, changed:false,
--                   replayed:true, nothing written (including a stored failure).
--                   Same key + DIFFERENT payload -> success:false,
--                   reason:'replay_conflict', nothing written. A new payload
--                   needs a new key.
--   Concurrency     the batch row is CLAIMED first (INSERT … ON CONFLICT DO
--                   NOTHING). A concurrent caller with the same key blocks on
--                   the claim until the first transaction ends, then observes
--                   its stored result (replay) or its absence (rolled back, so
--                   it claims). No exception path is relied on.
--   Zero-ops        touches address_book and collection_import_batches only.
--   Coordinates     client lat/lon/coordinate_status are IGNORED; rows land as
--                   coordinate_status 'missing'. Reusing the real address
--                   validation is still an open gap (network-gated), stated
--                   here, not hidden.
--   Ownership       every path is authorized by ck_collection_contact_allowed
--                   (HQ, owning office, or an explicit grant); the office must
--                   be active in the tenant; contacts never change office.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE public.address_book
  ADD COLUMN IF NOT EXISTS collection_office_id uuid,
  ADD COLUMN IF NOT EXISTS external_ref text;

-- Same-tenant invariant, STRUCTURAL: composite FK onto (id, tenant_id).
-- TARGET-GATE NOTE (C2-9): on a live table this unique key must be built with
-- CREATE UNIQUE INDEX CONCURRENTLY + ADD CONSTRAINT … USING INDEX, never with
-- a DROP/ADD that takes ACCESS EXCLUSIVE. Here it is guarded and additive only.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='partners_id_tenant_uk') THEN
    ALTER TABLE public.partners ADD CONSTRAINT partners_id_tenant_uk UNIQUE (id, tenant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ab_collection_same_tenant_fk') THEN
    ALTER TABLE public.address_book
      ADD CONSTRAINT ab_collection_same_tenant_fk
      FOREIGN KEY (collection_office_id, tenant_id)
      REFERENCES public.partners (id, tenant_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ab_collection_external_ref_uk
  ON public.address_book (tenant_id, collection_office_id, external_ref)
  WHERE collection_office_id IS NOT NULL AND external_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ck_norm_phone(p text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT NULLIF(
    CASE WHEN btrim(p) LIKE '+%' THEN '+' ELSE '' END || regexp_replace(p, '[^0-9]', '', 'g'), '') $$;
CREATE INDEX IF NOT EXISTS ab_collection_phone_norm_ix
  ON public.address_book (tenant_id, collection_office_id, public.ck_norm_phone(phone))
  WHERE collection_office_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.collection_import_batches (
  tenant_id            text NOT NULL,
  collection_office_id uuid NOT NULL,
  replay_key           text NOT NULL,
  payload_hash         text NOT NULL,
  status               text NOT NULL CHECK (status IN ('in_progress','done','failed')),
  imported_by          uuid,
  claimed_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  result               jsonb,
  PRIMARY KEY (tenant_id, collection_office_id, replay_key)
);
REVOKE ALL ON TABLE public.collection_import_batches FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.collection_import_batches ENABLE ROW LEVEL SECURITY;

-- ── list ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.collection_contacts_list(
  p_tenant_id text, p_collection_office_id uuid,
  p_limit int DEFAULT 50, p_offset int DEFAULT 0, p_search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_rows jsonb; v_total bigint; v_limit int; v_offset int; v_q text;
BEGIN
  IF NOT public.ck_collection_contact_allowed(p_tenant_id,p_collection_office_id,'read') THEN
    RETURN jsonb_build_object('success',false,'reason','denied');
  END IF;
  v_limit  := LEAST(GREATEST(COALESCE(p_limit,50),1),200);
  v_offset := GREATEST(COALESCE(p_offset,0),0);
  v_q := NULLIF(btrim(COALESCE(p_search,'')),'');
  IF v_q IS NOT NULL AND length(v_q) > 100 THEN
    RETURN jsonb_build_object('success',false,'reason','search_too_long');
  END IF;
  -- escape LIKE metacharacters so a search cannot become a pattern
  IF v_q IS NOT NULL THEN
    v_q := '%' || replace(replace(replace(v_q,'\','\\'),'%','\%'),'_','\_') || '%';
  END IF;

  SELECT count(*) INTO v_total FROM public.address_book a
   WHERE a.tenant_id=p_tenant_id AND a.collection_office_id=p_collection_office_id AND a.is_active
     AND (v_q IS NULL OR a.name ILIKE v_q OR a.phone ILIKE v_q OR a.email ILIKE v_q OR a.external_ref ILIKE v_q);

  -- Paging is applied to the ROWS in a subquery, then aggregated (C2-2).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'phone',s.phone,
           'email',s.email,'external_ref',s.external_ref) ORDER BY s.name, s.id),'[]'::jsonb)
    INTO v_rows
    FROM (SELECT a.id,a.name,a.phone,a.email,a.external_ref FROM public.address_book a
           WHERE a.tenant_id=p_tenant_id AND a.collection_office_id=p_collection_office_id AND a.is_active
             AND (v_q IS NULL OR a.name ILIKE v_q OR a.phone ILIKE v_q OR a.email ILIKE v_q OR a.external_ref ILIKE v_q)
           ORDER BY a.name, a.id
           LIMIT v_limit OFFSET v_offset) s;
  RETURN jsonb_build_object('success',true,'rows',v_rows,'total',v_total,'limit',v_limit,'offset',v_offset);
END $$;

-- ── import ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.collection_contacts_import(
  p_tenant_id text, p_collection_office_id uuid, p_replay_key text, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := btrim(COALESCE(p_replay_key,''));
  v_hash text;
  v_claimed boolean := false;
  v_prev public.collection_import_batches;
  v_errors jsonb := '[]'::jsonb;
  v_ambiguous jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_ins int := 0; v_upd int := 0;
  r jsonb; i int := 0; n int;
  v_ref text; v_name text; v_phone text; v_email text; v_country text;
  v_id uuid; v_active boolean; v_hits int; v_result jsonb;
BEGIN
  IF NOT public.ck_collection_contact_allowed(p_tenant_id,p_collection_office_id,'manage') THEN
    RETURN jsonb_build_object('success',false,'changed',false,'reason','denied');
  END IF;
  IF v_key = '' OR length(v_key) > 128 THEN
    RETURN jsonb_build_object('success',false,'changed',false,'reason','replay_key_invalid');
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('success',false,'changed',false,'reason','rows_invalid',
             'errors', jsonb_build_array(jsonb_build_object('index',-1,'field','rows','code','not_an_array')));
  END IF;
  n := jsonb_array_length(p_rows);
  IF n < 1 OR n > 500 THEN
    RETURN jsonb_build_object('success',false,'changed',false,'reason','rows_invalid',
             'errors', jsonb_build_array(jsonb_build_object('index',-1,'field','rows','code','count_out_of_range','count',n)));
  END IF;
  -- jsonb is canonical (key order normalised), so its text is a stable digest input.
  v_hash := encode(sha256(convert_to(p_rows::text,'UTF8')),'hex');

  -- CLAIM FIRST. A concurrent same-key caller blocks here until this
  -- transaction ends, then sees either our committed result or nothing.
  INSERT INTO public.collection_import_batches
    (tenant_id,collection_office_id,replay_key,payload_hash,status,imported_by)
  VALUES (p_tenant_id,p_collection_office_id,v_key,v_hash,'in_progress',v_uid)
  ON CONFLICT (tenant_id,collection_office_id,replay_key) DO NOTHING;
  GET DIAGNOSTICS i = ROW_COUNT;
  v_claimed := i > 0;

  IF NOT v_claimed THEN
    SELECT * INTO v_prev FROM public.collection_import_batches
     WHERE tenant_id=p_tenant_id AND collection_office_id=p_collection_office_id AND replay_key=v_key;
    IF v_prev.payload_hash IS DISTINCT FROM v_hash THEN
      RETURN jsonb_build_object('success',false,'changed',false,'reason','replay_conflict');
    END IF;
    IF v_prev.status = 'in_progress' THEN
      RETURN jsonb_build_object('success',false,'changed',false,'reason','in_progress');
    END IF;
    RETURN COALESCE(v_prev.result,'{}'::jsonb) || jsonb_build_object('changed',false,'replayed',true);
  END IF;

  -- VALIDATE EVERY ROW BEFORE ANY WRITE (atomic policy).
  i := 0;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(r) <> 'object' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('index',i,'field','row','code','not_an_object'));
    ELSE
      v_ref := btrim(COALESCE(r->>'external_ref',''));
      IF r ? 'external_ref' AND (v_ref = '' OR length(v_ref) > 128) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('index',i,'field','external_ref','code','invalid'));
      END IF;
      v_name := btrim(COALESCE(r->>'name',''));
      IF (r ? 'name' OR NOT (r ? 'external_ref')) AND (v_name = '' OR length(v_name) > 200) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('index',i,'field','name','code','invalid'));
      END IF;
      IF r ? 'phone' AND length(btrim(COALESCE(r->>'phone',''))) > 32 THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('index',i,'field','phone','code','too_long'));
      END IF;
      v_email := lower(btrim(COALESCE(r->>'email','')));
      IF r ? 'email' AND v_email <> '' AND (length(v_email) > 254 OR position('@' in v_email) = 0) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('index',i,'field','email','code','invalid'));
      END IF;
      IF r ? 'country' AND upper(btrim(COALESCE(r->>'country',''))) !~ '^[A-Z]{2}$' THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('index',i,'field','country','code','invalid'));
      END IF;
    END IF;
    i := i + 1;
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 THEN
    v_result := jsonb_build_object('success',false,'changed',false,'reason','rows_invalid','errors',v_errors);
    UPDATE public.collection_import_batches
       SET status='failed', finished_at=now(), result=v_result
     WHERE tenant_id=p_tenant_id AND collection_office_id=p_collection_office_id AND replay_key=v_key;
    RETURN v_result;
  END IF;

  -- WRITE.
  i := 0;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_ref   := NULLIF(btrim(COALESCE(r->>'external_ref','')),'');
    v_name  := NULLIF(btrim(COALESCE(r->>'name','')),'');
    v_phone := CASE WHEN r ? 'phone' THEN NULLIF(btrim(COALESCE(r->>'phone','')),'') END;
    v_email := CASE WHEN r ? 'email' THEN NULLIF(lower(btrim(COALESCE(r->>'email',''))),'') END;
    v_country := CASE WHEN r ? 'country' THEN upper(btrim(r->>'country')) ELSE 'US' END;
    v_id := NULL; v_active := NULL;

    IF v_ref IS NOT NULL THEN
      SELECT a.id, a.is_active INTO v_id, v_active FROM public.address_book a
       WHERE a.tenant_id=p_tenant_id AND a.collection_office_id=p_collection_office_id AND a.external_ref=v_ref;
    END IF;

    IF v_id IS NOT NULL AND v_active IS NOT TRUE THEN
      -- Never touch a deactivated contact from an import; report it.
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('index',i,'external_ref',v_ref,'code','inactive_match'));
    ELSIF v_id IS NOT NULL THEN
      -- Update ONLY the supplied fields; office scope is immutable.
      UPDATE public.address_book SET
        name       = COALESCE(v_name, name),
        phone      = CASE WHEN r ? 'phone' THEN v_phone ELSE phone END,
        email      = CASE WHEN r ? 'email' THEN v_email ELSE email END,
        country    = CASE WHEN r ? 'country' THEN v_country ELSE country END,
        updated_at = now()
       WHERE id = v_id AND tenant_id = p_tenant_id AND collection_office_id = p_collection_office_id;
      v_upd := v_upd + 1;
    ELSE
      IF v_phone IS NOT NULL THEN
        SELECT count(*) INTO v_hits FROM public.address_book a
         WHERE a.tenant_id=p_tenant_id AND a.collection_office_id=p_collection_office_id
           AND public.ck_norm_phone(a.phone) = public.ck_norm_phone(v_phone);
        IF v_hits > 0 THEN
          v_ambiguous := v_ambiguous || jsonb_build_array(jsonb_build_object(
            'index',i,'phone',v_phone,'existing_matches',v_hits,
            'note','phone already present for this office; inserted as a NEW contact, not merged'));
        END IF;
      END IF;
      INSERT INTO public.address_book(tenant_id,name,phone,email,country,preferred_language,
             coordinate_status,is_active,source,collection_office_id,external_ref,created_by)
      VALUES (p_tenant_id,v_name,v_phone,v_email,v_country,COALESCE(r->>'preferred_language','en'),
              'missing',true,'collection_import',p_collection_office_id,v_ref,v_uid);
      v_ins := v_ins + 1;
    END IF;
    i := i + 1;
  END LOOP;

  v_result := jsonb_build_object('success',true,'changed',(v_ins + v_upd) > 0,
                'inserted',v_ins,'updated',v_upd,
                'ambiguous',v_ambiguous,'skipped',v_skipped,'replayed',false);
  UPDATE public.collection_import_batches
     SET status='done', finished_at=now(), result=v_result
   WHERE tenant_id=p_tenant_id AND collection_office_id=p_collection_office_id AND replay_key=v_key;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.ck_norm_phone(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.collection_contacts_list(text,uuid,int,int,text)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.collection_contacts_import(text,uuid,text,jsonb)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ck_norm_phone(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_contacts_list(text,uuid,int,int,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_contacts_import(text,uuid,text,jsonb) TO authenticated, service_role;
COMMIT;
