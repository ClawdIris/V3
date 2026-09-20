-- Stubs the objects a hosted Supabase project provides, so the real migrations
-- can be applied to a throwaway local Postgres and exercised.
--
-- This file is TEST-ONLY. It is never applied to a Supabase project, where all
-- of these already exist. The definitions mirror Supabase's own so that a
-- policy which passes here behaves the same in production.

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role;

-- --- auth -------------------------------------------------------------------

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Byte-for-byte the shape Supabase ships: the session's JWT `sub` claim,
-- or null when unauthenticated. Tests impersonate a user by setting
-- request.jwt.claim.sub.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

-- --- storage ----------------------------------------------------------------

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null unique,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner_id   text,
  created_at timestamptz not null default now(),
  metadata   jsonb,
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;

grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

-- Supabase's own definition: every path segment except the final filename.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end;
$$;

grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- --- realtime ---------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
