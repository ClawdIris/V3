-- Jeffy 0009: explicit table grants.
--
-- Supabase's default privileges hand every new table in `public` to anon,
-- authenticated and service_role. RLS still gates the rows, but anon has no
-- policies on any Jeffy table and therefore no business holding the grant --
-- so we state the grants we want rather than inheriting them.

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- The lookup cache is written only by the Edge Function's service role.
revoke insert, update, delete on public.product_lookup_cache from authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  revoke all on tables from anon;
