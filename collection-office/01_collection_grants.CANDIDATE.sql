-- ═══════════════════════════════════════════════════════════════════════════
-- C1 — COLLECTION CONTACT GRANTS / REVOKE / AUDIT.  CORRECTED CANDIDATE.
-- FILE-ONLY. Applied ONLY to a disposable local cluster for the local proofs
-- in collection-office/tests. Never staging, never production. Not a GO.
-- Supersedes .handoff/CAND/sql/01_collection_grants.sql (kept intact) per
-- GRANTS-CONTACT-REVIEW-C1-C2-20260920.md findings C1-1 … C1-10 and Finding 0.
--
-- Convention (R1, O1): every RPC returns jsonb { success, changed, reason? }.
-- Clients MUST check success === true; changed === true is the only positive
-- change signal. Planned refusals RETURN (no exception) so the refusal audit
-- row commits in the same ordinary transaction. This is NOT an autonomous
-- audit guarantee: an outer rollback or a later unhandled failure still rolls
-- it back. Unexpected failures (audit storage etc.) RAISE and roll everything
-- back, so a grant can never proceed unaudited.
--
-- Identity (C1-1): grants are keyed by members.user_id, and the column and the
-- parameter are NAMED for it (member_user_id). members.id is never accepted.
-- Membership is resolved per call against the ACTIVE row(s) for that user in
-- the tenant, so a disabled member, a reassigned member and a duplicate
-- membership all resolve to what is currently active.
--
-- Audit scoping (C1-2, C1-4): a refusal is audited under tenant T only when the
-- actor is an ACTIVE MEMBER of T. Target ids are recorded only after they are
-- validated to belong to T; unvalidated ids are stored as NULL. A caller with
-- no membership in T receives the generic denial and writes NO audit row in T:
-- that is what stops arbitrary foreign-tenant audit pollution. Whether such
-- probes belong in a separate global security log is a target-gate question.
--
-- Refusal payload (C1-10): a single generic code 'denied' covers not-HQ,
-- non-member, unknown/foreign/inactive office and unknown/disabled member, so
-- the payload never reveals which id resolved. The specific reason lives only
-- in the audit row. Input errors (invalid_action, self_grant_forbidden,
-- not_authenticated) reveal nothing about foreign data and stay specific.
--
-- Owner intake (helper): an active member whose assigned_partner_id is the
-- office has read AND manage on THAT office without a grant. That is the
-- legitimate owning-office permission and is preserved. What is removed is the
-- bypass: any p_need outside ('read','manage') is false for everyone, and no
-- role, assignment or contact grant answers a metrics question — metrics is a
-- separate store with its own helper that never reads contact grants.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── stores ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.collection_contact_grants (
  id                   bigserial PRIMARY KEY,
  tenant_id            text NOT NULL,
  collection_office_id uuid NOT NULL,
  member_user_id       uuid NOT NULL,          -- members.user_id
  action               text NOT NULL CHECK (action IN ('read','manage')),
  granted_by           uuid NOT NULL,
  granted_at           timestamptz NOT NULL DEFAULT now(),
  revoked_by           uuid,
  revoked_at           timestamptz,
  CHECK ((revoked_by IS NULL) = (revoked_at IS NULL))
);
-- One ACTIVE grant per key; revoked rows stay as history (C1-5).
CREATE UNIQUE INDEX IF NOT EXISTS collection_contact_grants_active_uk
  ON public.collection_contact_grants (tenant_id, collection_office_id, member_user_id, action)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS collection_contact_grants_member_ix
  ON public.collection_contact_grants (tenant_id, member_user_id);

-- Metrics grants: SEPARATE store. No contact helper reads it; no metrics helper
-- reads contact grants. RPCs for it are out of this candidate's scope.
CREATE TABLE IF NOT EXISTS public.collection_metrics_grants (
  id                   bigserial PRIMARY KEY,
  tenant_id            text NOT NULL,
  collection_office_id uuid NOT NULL,
  member_user_id       uuid NOT NULL,
  granted_by           uuid NOT NULL,
  granted_at           timestamptz NOT NULL DEFAULT now(),
  revoked_by           uuid,
  revoked_at           timestamptz,
  CHECK ((revoked_by IS NULL) = (revoked_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS collection_metrics_grants_active_uk
  ON public.collection_metrics_grants (tenant_id, collection_office_id, member_user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.collection_grant_audit (
  id                   bigserial PRIMARY KEY,
  at                   timestamptz NOT NULL DEFAULT now(),
  actor_id             uuid NOT NULL,
  tenant_id            text NOT NULL,        -- tenant the ACTOR is an active member of
  collection_office_id uuid,                 -- only once validated in tenant_id
  member_user_id       uuid,                 -- only once validated in tenant_id
  action               text,
  operation            text NOT NULL CHECK (operation IN ('grant','revoke')),
  outcome              text NOT NULL CHECK (outcome IN ('granted','revoked','no_op','refused')),
  reason               text
);
-- Append-only is a MECHANISM here, not a claim (C1-8).
CREATE OR REPLACE FUNCTION public.collection_grant_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='collection_grant_audit is append-only'; END $$;
DROP TRIGGER IF EXISTS collection_grant_audit_no_row_change ON public.collection_grant_audit;
CREATE TRIGGER collection_grant_audit_no_row_change
  BEFORE UPDATE OR DELETE ON public.collection_grant_audit
  FOR EACH ROW EXECUTE FUNCTION public.collection_grant_audit_immutable();
DROP TRIGGER IF EXISTS collection_grant_audit_no_truncate ON public.collection_grant_audit;
CREATE TRIGGER collection_grant_audit_no_truncate
  BEFORE TRUNCATE ON public.collection_grant_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.collection_grant_audit_immutable();

-- No client role touches the stores directly. RLS enabled with no policies
-- denies even if a table privilege were ever granted by mistake.
REVOKE ALL ON TABLE public.collection_contact_grants, public.collection_metrics_grants,
                    public.collection_grant_audit FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.collection_contact_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_metrics_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_grant_audit   ENABLE ROW LEVEL SECURITY;

-- ── membership helpers (per call; never a claim, never cached) ───────────────
CREATE OR REPLACE FUNCTION public.ck_is_tenant_member(p_tenant_id text, p_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.members m
                  WHERE m.user_id = p_uid AND m.tenant_id = p_tenant_id AND m.active IS TRUE) $$;
CREATE OR REPLACE FUNCTION public.ck_is_tenant_hq(p_tenant_id text, p_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.members m
                  WHERE m.user_id = p_uid AND m.tenant_id = p_tenant_id AND m.active IS TRUE
                    AND COALESCE(m.app_role, m.role) = 'hq') $$;
CREATE OR REPLACE FUNCTION public.ck_office_in_tenant(p_tenant_id text, p_office uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.partners pa
                  WHERE pa.id = p_office AND pa.tenant_id = p_tenant_id AND pa.is_active IS NOT FALSE) $$;
CREATE OR REPLACE FUNCTION public.ck_is_office_owner(p_tenant_id text, p_office uuid, p_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.members m
                  WHERE m.user_id = p_uid AND m.tenant_id = p_tenant_id AND m.active IS TRUE
                    AND m.assigned_partner_id = p_office) $$;

-- ── grant ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.collection_contact_grant(
  p_tenant_id text, p_collection_office_id uuid, p_member_user_id uuid, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text; v_code text;
  v_office uuid; v_member uuid;           -- recorded in audit only once validated
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'changed',false,'reason','not_authenticated');
  END IF;
  -- Non-members of the tenant get the generic denial and write nothing here.
  IF NOT public.ck_is_tenant_member(p_tenant_id, v_uid) THEN
    RETURN jsonb_build_object('success',false,'changed',false,'reason','denied');
  END IF;

  IF NOT public.ck_is_tenant_hq(p_tenant_id, v_uid) THEN
    v_reason := 'not_hq'; v_code := 'denied';
  ELSIF p_action IS NULL OR p_action NOT IN ('read','manage') THEN
    v_reason := 'invalid_action'; v_code := 'invalid_action';
  ELSIF p_member_user_id IS NOT NULL AND v_uid = p_member_user_id THEN
    v_reason := 'self_grant_forbidden'; v_code := 'self_grant_forbidden';
  ELSIF NOT public.ck_office_in_tenant(p_tenant_id, p_collection_office_id) THEN
    v_reason := 'office_not_in_tenant'; v_code := 'denied';
  ELSE
    v_office := p_collection_office_id;
    IF NOT public.ck_is_tenant_member(p_tenant_id, p_member_user_id) THEN
      v_reason := 'member_not_in_tenant'; v_code := 'denied';
    ELSE
      v_member := p_member_user_id;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.collection_grant_audit
      (actor_id,tenant_id,collection_office_id,member_user_id,action,operation,outcome,reason)
    VALUES (v_uid,p_tenant_id,v_office,v_member,
            CASE WHEN p_action IN ('read','manage') THEN p_action END,'grant','refused',v_reason);
    RETURN jsonb_build_object('success',false,'changed',false,'reason',v_code);
  END IF;

  -- Serialise concurrent grants for the same key; the partial unique index is
  -- the backstop if two sessions still race past this.
  PERFORM pg_advisory_xact_lock(hashtext('ccg:'||p_tenant_id||':'||v_office::text||':'||v_member::text||':'||p_action));

  IF EXISTS (SELECT 1 FROM public.collection_contact_grants g
              WHERE g.tenant_id=p_tenant_id AND g.collection_office_id=v_office
                AND g.member_user_id=v_member AND g.action=p_action AND g.revoked_at IS NULL) THEN
    INSERT INTO public.collection_grant_audit
      (actor_id,tenant_id,collection_office_id,member_user_id,action,operation,outcome)
    VALUES (v_uid,p_tenant_id,v_office,v_member,p_action,'grant','no_op');
    RETURN jsonb_build_object('success',true,'changed',false,'action',p_action);
  END IF;

  BEGIN
    INSERT INTO public.collection_contact_grants
      (tenant_id,collection_office_id,member_user_id,action,granted_by)
    VALUES (p_tenant_id,v_office,v_member,p_action,v_uid);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO public.collection_grant_audit
      (actor_id,tenant_id,collection_office_id,member_user_id,action,operation,outcome)
    VALUES (v_uid,p_tenant_id,v_office,v_member,p_action,'grant','no_op');
    RETURN jsonb_build_object('success',true,'changed',false,'action',p_action);
  END;

  INSERT INTO public.collection_grant_audit
    (actor_id,tenant_id,collection_office_id,member_user_id,action,operation,outcome)
  VALUES (v_uid,p_tenant_id,v_office,v_member,p_action,'grant','granted');
  RETURN jsonb_build_object('success',true,'changed',true,'action',p_action);
END $$;

-- ── revoke ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.collection_contact_revoke(
  p_tenant_id text, p_collection_office_id uuid, p_member_user_id uuid, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text; v_code text; v_office uuid; v_member uuid; v_n int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'changed',false,'reason','not_authenticated');
  END IF;
  IF NOT public.ck_is_tenant_member(p_tenant_id, v_uid) THEN
    RETURN jsonb_build_object('success',false,'changed',false,'reason','denied');
  END IF;

  IF NOT public.ck_is_tenant_hq(p_tenant_id, v_uid) THEN
    v_reason := 'not_hq'; v_code := 'denied';
  ELSIF p_action IS NULL OR p_action NOT IN ('read','manage') THEN
    v_reason := 'invalid_action'; v_code := 'invalid_action';
  ELSIF NOT public.ck_office_in_tenant(p_tenant_id, p_collection_office_id) THEN
    v_reason := 'office_not_in_tenant'; v_code := 'denied';
  ELSE
    v_office := p_collection_office_id;
    -- Revocation must work for a DISABLED member too, so require the membership
    -- row to exist in the tenant, active or not.
    IF NOT EXISTS (SELECT 1 FROM public.members m
                    WHERE m.user_id = p_member_user_id AND m.tenant_id = p_tenant_id) THEN
      v_reason := 'member_not_in_tenant'; v_code := 'denied';
    ELSE
      v_member := p_member_user_id;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.collection_grant_audit
      (actor_id,tenant_id,collection_office_id,member_user_id,action,operation,outcome,reason)
    VALUES (v_uid,p_tenant_id,v_office,v_member,
            CASE WHEN p_action IN ('read','manage') THEN p_action END,'revoke','refused',v_reason);
    RETURN jsonb_build_object('success',false,'changed',false,'reason',v_code);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ccg:'||p_tenant_id||':'||v_office::text||':'||v_member::text||':'||p_action));
  UPDATE public.collection_contact_grants
     SET revoked_by=v_uid, revoked_at=now()
   WHERE tenant_id=p_tenant_id AND collection_office_id=v_office
     AND member_user_id=v_member AND action=p_action AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO public.collection_grant_audit
    (actor_id,tenant_id,collection_office_id,member_user_id,action,operation,outcome)
  VALUES (v_uid,p_tenant_id,v_office,v_member,p_action,'revoke',
          CASE WHEN v_n > 0 THEN 'revoked' ELSE 'no_op' END);
  RETURN jsonb_build_object('success',true,'changed',v_n > 0,'action',p_action);
END $$;

-- ── list ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.collection_contact_grants_list(
  p_tenant_id text, p_collection_office_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_uid uuid := auth.uid(); v jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success',false,'reason','not_authenticated'); END IF;
  IF NOT (public.ck_is_tenant_hq(p_tenant_id, v_uid)
          OR public.ck_is_office_owner(p_tenant_id, p_collection_office_id, v_uid)) THEN
    RETURN jsonb_build_object('success',false,'reason','denied');
  END IF;
  IF NOT public.ck_office_in_tenant(p_tenant_id, p_collection_office_id) THEN
    RETURN jsonb_build_object('success',false,'reason','denied');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('member_user_id',g.member_user_id,'action',g.action,
           'granted_by',g.granted_by,'granted_at',g.granted_at) ORDER BY g.granted_at),'[]'::jsonb)
    INTO v FROM public.collection_contact_grants g
   WHERE g.tenant_id=p_tenant_id AND g.collection_office_id=p_collection_office_id AND g.revoked_at IS NULL;
  RETURN jsonb_build_object('success',true,'rows',v);
END $$;

-- ── effective access, PER CALL ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ck_collection_contact_allowed(
  p_tenant_id text, p_collection_office_id uuid, p_need text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  -- Only the two contact needs exist. Anything else is false for everyone —
  -- this helper never answers metrics, admin, or any other question.
  IF p_need IS NULL OR p_need NOT IN ('read','manage') THEN RETURN false; END IF;
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF NOT public.ck_is_tenant_member(p_tenant_id, v_uid) THEN RETURN false; END IF;
  IF NOT public.ck_office_in_tenant(p_tenant_id, p_collection_office_id) THEN RETURN false; END IF;
  IF public.ck_is_tenant_hq(p_tenant_id, v_uid) THEN RETURN true; END IF;
  -- Owning office: read + manage on its OWN office (legitimate intake path).
  IF public.ck_is_office_owner(p_tenant_id, p_collection_office_id, v_uid) THEN RETURN true; END IF;
  -- Explicit grant: manage implies read; read never implies manage.
  RETURN EXISTS (SELECT 1 FROM public.collection_contact_grants g
                  WHERE g.tenant_id=p_tenant_id AND g.collection_office_id=p_collection_office_id
                    AND g.member_user_id=v_uid AND g.revoked_at IS NULL
                    AND (g.action=p_need OR (p_need='read' AND g.action='manage')));
END $$;

-- Metrics: separate helper, separate store. Reads NOTHING from contact grants.
CREATE OR REPLACE FUNCTION public.ck_collection_metrics_allowed(
  p_tenant_id text, p_collection_office_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF NOT public.ck_is_tenant_member(p_tenant_id, v_uid) THEN RETURN false; END IF;
  IF public.ck_is_tenant_hq(p_tenant_id, v_uid) THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM public.collection_metrics_grants g
                  WHERE g.tenant_id=p_tenant_id AND g.collection_office_id=p_collection_office_id
                    AND g.member_user_id=v_uid AND g.revoked_at IS NULL);
END $$;

-- ── privileges ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.ck_is_tenant_member(text,uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ck_is_tenant_hq(text,uuid)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ck_office_in_tenant(text,uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ck_is_office_owner(text,uuid,uuid)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collection_grant_audit_immutable()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collection_contact_grant(text,uuid,uuid,text)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.collection_contact_revoke(text,uuid,uuid,text)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.collection_contact_grants_list(text,uuid)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ck_collection_contact_allowed(text,uuid,text)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ck_collection_metrics_allowed(text,uuid)             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collection_contact_grant(text,uuid,uuid,text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_contact_revoke(text,uuid,uuid,text)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_contact_grants_list(text,uuid)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ck_collection_contact_allowed(text,uuid,text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ck_collection_metrics_allowed(text,uuid)          TO authenticated, service_role;
COMMIT;
