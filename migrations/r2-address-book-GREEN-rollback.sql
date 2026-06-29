-- ════════════════════════════════════════════════════════════════════════════
-- r2-address-book-GREEN-rollback.sql
-- Reverses r2-address-book-GREEN.sql. Safe to run if the GREEN apply needs undo.
-- Does NOT drop set_updated_at() (pre-existing, shared by other triggers).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

DROP FUNCTION IF EXISTS public.import_contacts_from_orders(TEXT);

DROP TRIGGER IF EXISTS trg_ab_updated_at ON public.address_book;

DROP POLICY IF EXISTS ab_hq_office_all  ON public.address_book;
DROP POLICY IF EXISTS ab_driver_select  ON public.address_book;
DROP POLICY IF EXISTS ab_anon_blocked   ON public.address_book;

DROP INDEX IF EXISTS public.idx_ab_tenant_id;
DROP INDEX IF EXISTS public.idx_ab_phone;
DROP INDEX IF EXISTS public.idx_ab_tags;
DROP INDEX IF EXISTS public.idx_ab_coords;
DROP INDEX IF EXISTS public.idx_ab_is_active;

DROP TABLE IF EXISTS public.address_book;

COMMIT;
