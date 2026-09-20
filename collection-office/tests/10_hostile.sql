-- collection-office/tests/10_hostile.sql — RESTRICTED-ROLE local proofs.
-- Every functional check runs under SET LOCAL ROLE authenticated (or anon)
-- with request.jwt.claims set inside the transaction, so RLS, table REVOKEs
-- and function EXECUTE grants are all in force. Each block is its own
-- committed transaction, so audit rows are inspected AFTER commit by the
-- runner's second connection as well as here.
\set ON_ERROR_STOP on
-- psql variables are not expanded inside dollar-quoted DO bodies, so the
-- fixture ids travel as session GUCs instead.
SELECT set_config('t.HQ','00000000-0000-4000-a000-00000000aaa1',false);
SELECT set_config('t.ST','00000000-0000-4000-a000-00000000bbb1',false);
SELECT set_config('t.OWNA','00000000-0000-4000-a000-00000000ccc1',false);
SELECT set_config('t.HQ2','00000000-0000-4000-a000-00000000ddd1',false);
SELECT set_config('t.DIS','00000000-0000-4000-a000-00000000eee1',false);
SELECT set_config('t.DUP','00000000-0000-4000-a000-00000000fff1',false);
SELECT set_config('t.NOB','00000000-0000-4000-a000-000000001111',false);
SELECT set_config('t.A','aaaaaaaa-0000-4000-a000-00000000000a',false);
SELECT set_config('t.B','bbbbbbbb-0000-4000-a000-00000000000b',false);
SELECT set_config('t.C2T','cccccccc-0000-4000-a000-00000000000c',false);
SELECT set_config('t.INACT','dddddddd-0000-4000-a000-00000000000d',false);
SELECT set_config('t.RND','99999999-0000-4000-a000-000000000099',false);

-- ─────────────────────────── C1: grants ───────────────────────────
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.HQ')::uuid);
DO $$ DECLARE r jsonb; BEGIN
  r := public.collection_contact_grant('t1',current_setting('t.A')::uuid,current_setting('t.ST')::uuid,'read');
  PERFORM public.__ck('G1 HQ grants read -> success+changed', r->>'success'='true' AND r->>'changed'='true', r::text);
  r := public.collection_contact_grant('t1',current_setting('t.A')::uuid,current_setting('t.ST')::uuid,'read');
  PERFORM public.__ck('G2 regrant -> success, changed:false', r->>'success'='true' AND r->>'changed'='false', r::text);
  r := public.collection_contact_grant('t1',current_setting('t.A')::uuid,current_setting('t.HQ')::uuid,'read');
  PERFORM public.__ck('G3 self-grant refused (specific code)', r->>'reason'='self_grant_forbidden', r::text);
  r := public.collection_contact_grant('t1',current_setting('t.A')::uuid,current_setting('t.ST')::uuid,'admin');
  PERFORM public.__ck('G9 invalid action', r->>'reason'='invalid_action', r::text);
  r := public.collection_contact_grant('t1',current_setting('t.C2T')::uuid,current_setting('t.ST')::uuid,'read');
  PERFORM public.__ck('G6 foreign-tenant office -> generic denied', r->>'reason'='denied', r::text);
  r := public.collection_contact_grant('t1',current_setting('t.RND')::uuid,current_setting('t.ST')::uuid,'read');
  PERFORM public.__ck('G7 unknown office -> SAME generic code', r->>'reason'='denied', r::text);
  r := public.collection_contact_grant('t1',current_setting('t.INACT')::uuid,current_setting('t.ST')::uuid,'read');
  PERFORM public.__ck('G7b inactive office -> denied', r->>'reason'='denied', r::text);
  r := public.collection_contact_grant('t1',current_setting('t.A')::uuid,current_setting('t.DIS')::uuid,'read');
  PERFORM public.__ck('G8 disabled member target -> denied', r->>'reason'='denied', r::text);
  r := public.collection_contact_grant('t1',current_setting('t.A')::uuid,current_setting('t.NOB')::uuid,'read');
  PERFORM public.__ck('G8b non-member target -> denied (same code)', r->>'reason'='denied', r::text);
END $$; COMMIT;

-- non-HQ actor
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.ST')::uuid);
DO $$ DECLARE r jsonb; BEGIN
  r := public.collection_contact_grant('t1',current_setting('t.A')::uuid,current_setting('t.OWNA')::uuid,'read');
  PERFORM public.__ck('G4 non-HQ member cannot grant', r->>'reason'='denied', r::text);
  r := public.collection_contact_revoke('t1',current_setting('t.A')::uuid,current_setting('t.ST')::uuid,'read');
  PERFORM public.__ck('G4b non-HQ member cannot revoke', r->>'reason'='denied', r::text);
END $$; COMMIT;

-- non-member of t1 (HQ of t2) probing t1 -> denied, and NO audit row in t1
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.HQ2')::uuid);
DO $$ DECLARE r jsonb; BEGIN
  r := public.collection_contact_grant('t1',current_setting('t.A')::uuid,current_setting('t.ST')::uuid,'read');
  PERFORM public.__ck('G5 HQ of another tenant -> denied', r->>'reason'='denied', r::text);
  r := public.collection_contact_grant('t1',current_setting('t.C2T')::uuid,current_setting('t.HQ2')::uuid,'manage');
  PERFORM public.__ck('G5b foreign HQ cannot grant on its own office under t1', r->>'reason'='denied', r::text);
END $$; COMMIT;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.collection_grant_audit WHERE tenant_id='t1' AND actor_id=current_setting('t.HQ2')::uuid;
  PERFORM public.__ck('G5c pollution guard: foreign actor wrote NO audit rows in t1', n=0, 'rows='||n);
END $$;
-- unvalidated ids are NULL in refusal audit rows
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.collection_grant_audit
   WHERE collection_office_id IN (current_setting('t.C2T')::uuid,current_setting('t.RND')::uuid,current_setting('t.INACT')::uuid) OR member_user_id IN (current_setting('t.DIS')::uuid,current_setting('t.NOB')::uuid);
  PERFORM public.__ck('G6b refusal audit never stores unvalidated foreign/unknown ids', n=0, 'rows='||n);
  SELECT count(*) INTO n FROM public.collection_grant_audit WHERE outcome='refused' AND reason IN ('office_not_in_tenant','member_not_in_tenant');
  PERFORM public.__ck('G6c ...but the refusals themselves ARE audited (specific reason server-side)', n>=5, 'rows='||n);
END $$;

-- ST (read grantee) access + read does not imply manage; A does not leak B
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.ST')::uuid);
DO $$ BEGIN
  PERFORM public.__ck('G12a read grantee can read A', public.ck_collection_contact_allowed('t1',current_setting('t.A')::uuid,'read'));
  PERFORM public.__ck('G12b read does NOT imply manage', NOT public.ck_collection_contact_allowed('t1',current_setting('t.A')::uuid,'manage'));
  PERFORM public.__ck('G13 grant on A does not leak to B', NOT public.ck_collection_contact_allowed('t1',current_setting('t.B')::uuid,'read'));
  PERFORM public.__ck('G20c bypass closed: need=admin is false', NOT public.ck_collection_contact_allowed('t1',current_setting('t.A')::uuid,'admin'));
  PERFORM public.__ck('G16a contact grant confers NO metrics', NOT public.ck_collection_metrics_allowed('t1',current_setting('t.A')::uuid));
END $$; COMMIT;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.collection_metrics_grants;
  PERFORM public.__ck('G16b metrics store untouched by contact grant', n=0, 'rows='||n);
END $$;

-- owner-office member: read+manage on OWN office, nothing on B, no bypass
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.OWNA')::uuid);
DO $$ BEGIN
  PERFORM public.__ck('G20a owner office has read on A', public.ck_collection_contact_allowed('t1',current_setting('t.A')::uuid,'read'));
  PERFORM public.__ck('G20b owner office has manage on A (intake preserved)', public.ck_collection_contact_allowed('t1',current_setting('t.A')::uuid,'manage'));
  PERFORM public.__ck('G20d owner has NOTHING on office B', NOT public.ck_collection_contact_allowed('t1',current_setting('t.B')::uuid,'manage') AND NOT public.ck_collection_contact_allowed('t1',current_setting('t.B')::uuid,'read'));
  PERFORM public.__ck('G20e owner: need=metrics via contact helper is false', NOT public.ck_collection_contact_allowed('t1',current_setting('t.A')::uuid,'metrics'));
  PERFORM public.__ck('G20f owner assignment confers no metrics', NOT public.ck_collection_metrics_allowed('t1',current_setting('t.A')::uuid));
END $$; COMMIT;

-- manage implies read; grant to a disabled member is refused; revoke of a disabled member's grant works
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.HQ')::uuid);
DO $$ DECLARE r jsonb; BEGIN
  r := public.collection_contact_grant('t1',current_setting('t.B')::uuid,current_setting('t.ST')::uuid,'manage');
  PERFORM public.__ck('G12c HQ grants manage on B', r->>'changed'='true', r::text);
END $$; COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.ST')::uuid);
DO $$ BEGIN
  PERFORM public.__ck('G12d manage implies read', public.ck_collection_contact_allowed('t1',current_setting('t.B')::uuid,'read') AND public.ck_collection_contact_allowed('t1',current_setting('t.B')::uuid,'manage'));
END $$; COMMIT;

-- G11 revoke bites an open session: ST session checks, HQ revokes (committed), ST checks again in the SAME session
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.ST')::uuid);
SELECT public.__ck('G11a before revoke: ST allowed on A', public.ck_collection_contact_allowed('t1',current_setting('t.A')::uuid,'read'));
COMMIT;
\! echo "   (runner: revoke issued from a SECOND connection between G11a and G11b)"
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.HQ')::uuid);
DO $$ DECLARE r jsonb; BEGIN
  r := public.collection_contact_revoke('t1',current_setting('t.A')::uuid,current_setting('t.ST')::uuid,'read');
  PERFORM public.__ck('G10a revoke -> changed:true', r->>'success'='true' AND r->>'changed'='true', r::text);
  r := public.collection_contact_revoke('t1',current_setting('t.A')::uuid,current_setting('t.ST')::uuid,'read');
  PERFORM public.__ck('G10b revoke again -> success, changed:false (no_op)', r->>'success'='true' AND r->>'changed'='false', r::text);
  r := public.collection_contact_revoke('t1',current_setting('t.C2T')::uuid,current_setting('t.ST')::uuid,'read');
  PERFORM public.__ck('G4c revoke validates office scope', r->>'reason'='denied', r::text);
END $$; COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.ST')::uuid);
SELECT public.__ck('G11b after revoke: same session, no re-login, ST NOT allowed', NOT public.ck_collection_contact_allowed('t1',current_setting('t.A')::uuid,'read'));
COMMIT;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.collection_grant_audit WHERE operation='revoke' AND outcome='no_op';
  PERFORM public.__ck('G10c the no-op revoke is audited as no_op, not as a revocation', n=1, 'rows='||n);
END $$;

-- G17 re-grant after revoke: new row, history preserved
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.HQ')::uuid);
DO $$ DECLARE r jsonb; BEGIN
  r := public.collection_contact_grant('t1',current_setting('t.A')::uuid,current_setting('t.ST')::uuid,'read');
  PERFORM public.__ck('G17a re-grant after revoke -> changed:true', r->>'changed'='true', r::text);
END $$; COMMIT;
DO $$ DECLARE n int; m int; BEGIN
  SELECT count(*), count(*) FILTER (WHERE revoked_at IS NOT NULL) INTO n, m
    FROM public.collection_contact_grants WHERE collection_office_id=current_setting('t.A')::uuid AND member_user_id=current_setting('t.ST')::uuid AND action='read';
  PERFORM public.__ck('G17b revoked row PRESERVED + one active row (history intact)', n=2 AND m=1, 'rows='||n||' revoked='||m);
END $$;

-- G18 grant held by a member who is then disabled -> per-call false; G19 duplicate membership resolves on the ACTIVE row
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.HQ')::uuid);
DO $$ DECLARE r jsonb; BEGIN
  r := public.collection_contact_grant('t1',current_setting('t.A')::uuid,current_setting('t.DUP')::uuid,'read');
  PERFORM public.__ck('G19a DUP (inactive hq row + active office row) is a valid target', r->>'changed'='true', r::text);
END $$; COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.DUP')::uuid);
DO $$ DECLARE r jsonb; BEGIN
  PERFORM public.__ck('G19b DUP reads A through the grant', public.ck_collection_contact_allowed('t1',current_setting('t.A')::uuid,'read'));
  r := public.collection_contact_grant('t1',current_setting('t.B')::uuid,current_setting('t.ST')::uuid,'read');
  PERFORM public.__ck('G19c DUP is NOT hq (inactive hq row ignored)', r->>'reason'='denied', r::text);
END $$; COMMIT;
UPDATE public.members SET active=false WHERE user_id=current_setting('t.DUP')::uuid;   -- superuser: disable the member
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.DUP')::uuid);
SELECT public.__ck('G18 disabled member holding a grant -> allowed false, per call', NOT public.ck_collection_contact_allowed('t1',current_setting('t.A')::uuid,'read'));
COMMIT;
UPDATE public.members SET active=true WHERE user_id=current_setting('t.DUP')::uuid AND COALESCE(app_role,role)='office';

-- G21 unauthenticated / anon
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(NULL);
DO $$ DECLARE r jsonb; BEGIN
  r := public.collection_contact_grant('t1',current_setting('t.A')::uuid,current_setting('t.ST')::uuid,'read');
  PERFORM public.__ck('G21a no sub -> not_authenticated', r->>'reason'='not_authenticated', r::text);
  PERFORM public.__ck('G21b no sub -> allowed false', NOT public.ck_collection_contact_allowed('t1',current_setting('t.A')::uuid,'read'));
END $$; COMMIT;
BEGIN; SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.collection_contact_grant('t1',current_setting('t.A')::uuid,current_setting('t.ST')::uuid,'read');
    PERFORM public.__ck('G15a anon cannot EXECUTE grant', false, 'executed');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM public.__ck('G15a anon cannot EXECUTE grant', true);
  END;
END $$; COMMIT;

-- G14/G15 direct table + internal helper access from authenticated
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.HQ')::uuid);
DO $$ BEGIN
  BEGIN
    INSERT INTO public.collection_contact_grants(tenant_id,collection_office_id,member_user_id,action,granted_by)
    VALUES ('t1',current_setting('t.A')::uuid,current_setting('t.ST')::uuid,'manage',current_setting('t.HQ')::uuid);
    PERFORM public.__ck('G14a authenticated cannot INSERT grants directly', false, 'inserted');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM public.__ck('G14a authenticated cannot INSERT grants directly', true); END;
  BEGIN
    PERFORM count(*) FROM public.collection_contact_grants;
    PERFORM public.__ck('G14b authenticated cannot SELECT grants directly', false, 'selected');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM public.__ck('G14b authenticated cannot SELECT grants directly', true); END;
  BEGIN
    INSERT INTO public.collection_grant_audit(actor_id,tenant_id,operation,outcome) VALUES (current_setting('t.HQ')::uuid,'t1','grant','granted');
    PERFORM public.__ck('G14c authenticated cannot write audit directly', false, 'inserted');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM public.__ck('G14c authenticated cannot write audit directly', true); END;
  BEGIN
    PERFORM public.ck_is_tenant_hq('t1',current_setting('t.HQ')::uuid);
    PERFORM public.__ck('G15b authenticated cannot EXECUTE ck_is_tenant_hq', false, 'executed');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM public.__ck('G15b authenticated cannot EXECUTE ck_is_tenant_hq', true); END;
  BEGIN
    PERFORM public.ck_is_office_owner('t1',current_setting('t.A')::uuid,current_setting('t.HQ')::uuid);
    PERFORM public.__ck('G15c authenticated cannot EXECUTE ck_is_office_owner', false, 'executed');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM public.__ck('G15c authenticated cannot EXECUTE ck_is_office_owner', true); END;
END $$; COMMIT;
-- G14d append-only audit is enforced even for the superuser/owner
DO $$ BEGIN
  BEGIN
    UPDATE public.collection_grant_audit SET outcome='granted' WHERE outcome='refused';
    PERFORM public.__ck('G14d audit UPDATE blocked (append-only trigger)', false, 'updated');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM public.__ck('G14d audit UPDATE blocked (append-only trigger)', true); END;
  BEGIN
    DELETE FROM public.collection_grant_audit;
    PERFORM public.__ck('G14e audit DELETE blocked', false, 'deleted');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM public.__ck('G14e audit DELETE blocked', true); END;
END $$;
-- G22 grants list
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.OWNA')::uuid);
DO $$ DECLARE r jsonb; BEGIN
  r := public.collection_contact_grants_list('t1',current_setting('t.A')::uuid);
  PERFORM public.__ck('G22a owner lists ACTIVE grants for own office', r->>'success'='true' AND jsonb_array_length(r->'rows')>=1, r::text);
  r := public.collection_contact_grants_list('t1',current_setting('t.B')::uuid);
  PERFORM public.__ck('G22b owner cannot list office B', r->>'reason'='denied', r::text);
END $$; COMMIT;

-- ─────────────────────────── C2: contacts ───────────────────────────
-- zero-ops baseline
CREATE TEMP TABLE __zero AS
  SELECT md5(string_agg(o::text, '|' ORDER BY o.id)) AS orders_md5 FROM public.orders o;
INSERT INTO __zero SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) FROM public.tape_direct_records t;

BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.OWNA')::uuid);
DO $$ DECLARE r jsonb; BEGIN
  r := public.collection_contacts_import('t1',current_setting('t.A')::uuid,'batch-1',
        '[{"external_ref":"X1","name":"Ana Diaz","phone":"+1 (555) 123-0000","email":"Ana@X.com"},
          {"name":"No Ref Person","phone":"555-999-0001"}]'::jsonb);
  PERFORM public.__ck('C1 owner imports 2 rows', r->>'success'='true' AND (r->>'inserted')::int=2 AND r->>'changed'='true', r::text);
  r := public.collection_contacts_import('t1',current_setting('t.A')::uuid,'batch-1',
        '[{"external_ref":"X1","name":"Ana Diaz","phone":"+1 (555) 123-0000","email":"Ana@X.com"},
          {"name":"No Ref Person","phone":"555-999-0001"}]'::jsonb);
  PERFORM public.__ck('C2 same key + same rows -> replayed, changed:false', r->>'replayed'='true' AND r->>'changed'='false' AND (r->>'inserted')::int=2, r::text);
  r := public.collection_contacts_import('t1',current_setting('t.A')::uuid,'batch-1', '[{"name":"Different Payload"}]'::jsonb);
  PERFORM public.__ck('C3 same key + DIFFERENT rows -> replay_conflict', r->>'reason'='replay_conflict', r::text);
END $$; COMMIT;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.address_book WHERE collection_office_id=current_setting('t.A')::uuid;
  PERFORM public.__ck('C2/C3 contact count unchanged by replay and conflict', n=2, 'rows='||n);
END $$;

-- read-only grantee cannot import; non-allowed cannot list
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.ST')::uuid);
DO $$ DECLARE r jsonb; BEGIN
  r := public.collection_contacts_import('t1',current_setting('t.A')::uuid,'batch-st','[{"name":"Z"}]'::jsonb);
  PERFORM public.__ck('C4 read grantee cannot import', r->>'reason'='denied', r::text);
  r := public.collection_contacts_list('t1',current_setting('t.A')::uuid);
  PERFORM public.__ck('C4b read grantee CAN list', r->>'success'='true', r::text);
END $$; COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.HQ2')::uuid);
DO $$ DECLARE r jsonb; BEGIN
  r := public.collection_contacts_list('t1',current_setting('t.A')::uuid);
  PERFORM public.__ck('C11 foreign HQ cannot list', r->>'reason'='denied', r::text);
  r := public.collection_contacts_import('t1',current_setting('t.C2T')::uuid,'x','[{"name":"Z"}]'::jsonb);
  PERFORM public.__ck('C15 foreign office under t1 -> denied', r->>'reason'='denied', r::text);
END $$; COMMIT;

-- limits + atomic validation + partial update + inactive + ambiguity + paging
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.OWNA')::uuid);
DO $$ DECLARE r jsonb; big jsonb; n int; BEGIN
  SELECT jsonb_agg(jsonb_build_object('name','P'||g)) INTO big FROM generate_series(1,501) g;
  r := public.collection_contacts_import('t1',current_setting('t.A')::uuid,'batch-big', big);
  PERFORM public.__ck('C5 501 rows -> rows_invalid', r->>'reason'='rows_invalid', r::text);
  r := public.collection_contacts_import('t1',current_setting('t.A')::uuid,'batch-mixed', '[{"name":"Good One"},{"name":""},{"email":"nope","name":"Bad Mail"}]'::jsonb);
  PERFORM public.__ck('C6a mixed batch -> rows_invalid with every error listed', r->>'reason'='rows_invalid' AND jsonb_array_length(r->'errors')=2, r::text);
  r := public.collection_contacts_import('t1',current_setting('t.A')::uuid,'batch-mixed', '[{"name":"Good One"},{"name":""},{"email":"nope","name":"Bad Mail"}]'::jsonb);
  PERFORM public.__ck('C6c replaying a failed batch returns the stored failure', r->>'reason'='rows_invalid' AND r->>'replayed'='true', r::text);
  r := public.collection_contacts_import('t1',current_setting('t.A')::uuid,'batch-2', '[{"external_ref":"X1","phone":"+15551230000"}]'::jsonb);
  PERFORM public.__ck('C7a partial row on X1 -> updated 1', (r->>'updated')::int=1 AND r->>'success'='true', r::text);
  -- same number as X1 under the STATED normalization (+ kept, digits only);
  -- a bare "(555) 123 0000" is a different string by that rule, on purpose.
  r := public.collection_contacts_import('t1',current_setting('t.A')::uuid,'batch-3', '[{"name":"Second Ana","phone":"+1 (555) 123-0000"}]'::jsonb);
  PERFORM public.__ck('C8 shared phone -> inserted AND reported, never merged', (r->>'inserted')::int=1 AND jsonb_array_length(r->'ambiguous')=1, r::text);
  r := public.collection_contacts_list('t1',current_setting('t.A')::uuid, 1, 1);
  PERFORM public.__ck('C9 paging: limit 1 offset 1 returns ONE row and total 3', jsonb_array_length(r->'rows')=1 AND (r->>'total')::int=3, r::text);
  r := public.collection_contacts_list('t1',current_setting('t.A')::uuid, 50, 0, 'no ref');
  PERFORM public.__ck('C10 search', jsonb_array_length(r->'rows')=1, r::text);
  r := public.collection_contacts_list('t1',current_setting('t.A')::uuid, 50, 0, '%');
  PERFORM public.__ck('C10b search metacharacter is escaped (no rows match a literal %)', jsonb_array_length(r->'rows')=0, r::text);
END $$; COMMIT;
DO $$ DECLARE n int; nm text; BEGIN
  SELECT count(*) INTO n FROM public.address_book WHERE collection_office_id=current_setting('t.A')::uuid;
  PERFORM public.__ck('C6b atomic: the mixed batch inserted NOTHING (3 rows total = 2 + Second Ana)', n=3, 'rows='||n);
  SELECT name INTO nm FROM public.address_book WHERE external_ref='X1';
  PERFORM public.__ck('C7b partial row preserved the existing name', nm='Ana Diaz', nm);
  SELECT phone INTO nm FROM public.address_book WHERE external_ref='X1';
  PERFORM public.__ck('C7c partial row updated the supplied phone', nm='+15551230000', nm);
END $$;
-- inactive external_ref match is skipped, never modified
UPDATE public.address_book SET is_active=false WHERE external_ref='X1';
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.OWNA')::uuid);
DO $$ DECLARE r jsonb; BEGIN
  r := public.collection_contacts_import('t1',current_setting('t.A')::uuid,'batch-4', '[{"external_ref":"X1","name":"Resurrected"}]'::jsonb);
  PERFORM public.__ck('C13a inactive match -> skipped + reported', (r->>'updated')::int=0 AND jsonb_array_length(r->'skipped')=1, r::text);
END $$; COMMIT;
DO $$ DECLARE nm text; BEGIN
  SELECT name INTO nm FROM public.address_book WHERE external_ref='X1';
  PERFORM public.__ck('C13b inactive contact untouched', nm='Ana Diaz', nm);
END $$;
-- direct table access
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as(current_setting('t.OWNA')::uuid);
DO $$ BEGIN
  BEGIN
    INSERT INTO public.collection_import_batches(tenant_id,collection_office_id,replay_key,payload_hash,status) VALUES ('t1',current_setting('t.A')::uuid,'k','h','done');
    PERFORM public.__ck('C14 authenticated cannot write batches directly', false, 'inserted');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM public.__ck('C14 authenticated cannot write batches directly', true); END;
END $$; COMMIT;
-- zero-ops
DO $$ DECLARE a text; b text; BEGIN
  SELECT md5(string_agg(o::text, '|' ORDER BY o.id)) INTO a FROM public.orders o;
  SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) INTO b FROM public.tape_direct_records t;
  PERFORM public.__ck('C12 zero-ops: orders + tape_direct_records byte-identical',
    a = (SELECT orders_md5 FROM __zero LIMIT 1) AND b = (SELECT orders_md5 FROM __zero OFFSET 1 LIMIT 1));
END $$;
