-- Rollback for 02_collection_contacts.CANDIDATE.sql. FILE-ONLY.
-- Removes the functions, batch table, index and FK. The two address_book
-- columns are NOT dropped (imported contacts would lose their identity); on a
-- real target that is an explicit owner decision after export.
BEGIN;
DROP FUNCTION IF EXISTS public.collection_contacts_import(text,uuid,text,jsonb);
DROP FUNCTION IF EXISTS public.collection_contacts_list(text,uuid,int,int,text);
DROP TABLE IF EXISTS public.collection_import_batches;
DROP INDEX IF EXISTS public.ab_collection_phone_norm_ix;
DROP FUNCTION IF EXISTS public.ck_norm_phone(text);
DROP INDEX IF EXISTS public.ab_collection_external_ref_uk;
ALTER TABLE public.address_book DROP CONSTRAINT IF EXISTS ab_collection_same_tenant_fk;
-- partners_id_tenant_uk is left in place: other objects may depend on it.
COMMIT;
