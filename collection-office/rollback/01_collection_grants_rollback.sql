-- Rollback for 01_collection_grants.CANDIDATE.sql. FILE-ONLY.
-- Data-bearing tables are dropped here because this candidate has only ever
-- been applied to a disposable local cluster. On any real target the grant and
-- audit tables must be EXPORTED first and the drop needs an explicit decision.
BEGIN;
DROP FUNCTION IF EXISTS public.ck_collection_metrics_allowed(text,uuid);
DROP FUNCTION IF EXISTS public.ck_collection_contact_allowed(text,uuid,text);
DROP FUNCTION IF EXISTS public.collection_contact_grants_list(text,uuid);
DROP FUNCTION IF EXISTS public.collection_contact_revoke(text,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.collection_contact_grant(text,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.ck_is_office_owner(text,uuid,uuid);
DROP FUNCTION IF EXISTS public.ck_office_in_tenant(text,uuid);
DROP FUNCTION IF EXISTS public.ck_is_tenant_hq(text,uuid);
DROP FUNCTION IF EXISTS public.ck_is_tenant_member(text,uuid);
DROP TABLE IF EXISTS public.collection_grant_audit;
DROP FUNCTION IF EXISTS public.collection_grant_audit_immutable();
DROP TABLE IF EXISTS public.collection_metrics_grants;
DROP TABLE IF EXISTS public.collection_contact_grants;
COMMIT;
