-- collection-office/tests/00_base.sql
-- SYNTHETIC base schema + fixtures for the DISPOSABLE local cluster ONLY.
-- Never point this at an existing database: it creates schema auth and public
-- tables. Stand-ins mirror the columns the candidates and the repo's own SQL
-- reference; they are not the production schema.
\set ON_ERROR_STOP on

-- Supabase-shaped roles (NOLOGIN, membership via SET LOCAL ROLE from the
-- superuser test connection).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
-- auth.uid() as Supabase defines it: the JWT sub from the request claims GUC.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true),'')::json->>'sub')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.partners(id uuid PRIMARY KEY, tenant_id text NOT NULL, slug text, name text,
  parent_partner_id uuid, commission_model jsonb DEFAULT '{}'::jsonb, default_office_id uuid,
  is_active boolean DEFAULT true);
-- NOTE: members.assigned_partner_id does not appear in any local repo SQL; it is
-- the candidate's assumed owner-office link and is flagged as a target-gate
-- schema verification item. The stand-in carries it so the owner rule is testable.
CREATE TABLE public.members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,
  user_id uuid NOT NULL, role text, app_role text, active boolean DEFAULT true,
  office_id uuid, assigned_partner_id uuid, display_name text, metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.address_book(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,
  name text NOT NULL, phone text, email text, country text NOT NULL DEFAULT 'US',
  preferred_language text NOT NULL DEFAULT 'en', lat double precision, lon double precision,
  coordinate_status text NOT NULL DEFAULT 'missing', is_active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'manual', created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid);
CREATE TABLE public.orders(id text, tenant_id text, data jsonb, PRIMARY KEY(id,tenant_id));
CREATE TABLE public.tape_direct_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL, cost numeric, status text NOT NULL DEFAULT 'active');
-- Tables that exist in production are readable by app roles there through RLS;
-- the stand-ins deny everything to app roles so the only reachable paths are
-- the SECURITY DEFINER functions under test.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Test result sink, writable from restricted roles through a definer function.
CREATE TABLE public.__ck_results(n serial PRIMARY KEY, name text, pass boolean, detail text);
CREATE OR REPLACE FUNCTION public.__ck(p_name text, p_pass boolean, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  INSERT INTO public.__ck_results(name,pass,detail) VALUES (p_name, COALESCE(p_pass,false), p_detail);
  IF COALESCE(p_pass,false) THEN RAISE NOTICE 'PASS  %', p_name;
  ELSE RAISE WARNING 'FAIL  %  -> %', p_name, p_detail; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.__ck(text,boolean,text) TO PUBLIC;
-- Claims helper: sets the JWT sub for the current transaction.
CREATE OR REPLACE FUNCTION public.__as(p_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub',p_uid)::text END, true) $$;
GRANT EXECUTE ON FUNCTION public.__as(uuid) TO PUBLIC;

-- ── fixtures (all synthetic) ──
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-a000-00000000aaa1','hq@t1'),
 ('00000000-0000-4000-a000-00000000bbb1','staff@t1'),
 ('00000000-0000-4000-a000-00000000ccc1','owner-a@t1'),     -- assigned to office A
 ('00000000-0000-4000-a000-00000000ddd1','hq@t2'),
 ('00000000-0000-4000-a000-00000000eee1','disabled@t1'),    -- inactive member
 ('00000000-0000-4000-a000-00000000fff1','dup@t1'),         -- two membership rows
 ('00000000-0000-4000-a000-000000001111','nobody');         -- no membership anywhere
INSERT INTO public.partners(id,tenant_id,name) VALUES
 ('aaaaaaaa-0000-4000-a000-00000000000a','t1','Collection A'),
 ('bbbbbbbb-0000-4000-a000-00000000000b','t1','Collection B'),
 ('cccccccc-0000-4000-a000-00000000000c','t2','Other Tenant CO');
INSERT INTO public.partners(id,tenant_id,name,is_active) VALUES
 ('dddddddd-0000-4000-a000-00000000000d','t1','Inactive Office',false);
INSERT INTO public.members(tenant_id,user_id,role,app_role,active,assigned_partner_id,created_at) VALUES
 ('t1','00000000-0000-4000-a000-00000000aaa1','hq','hq',true,NULL,now()),
 ('t1','00000000-0000-4000-a000-00000000bbb1','office','office',true,NULL,now()),
 ('t1','00000000-0000-4000-a000-00000000ccc1','partner_agent','partner_agent',true,'aaaaaaaa-0000-4000-a000-00000000000a',now()),
 ('t2','00000000-0000-4000-a000-00000000ddd1','hq','hq',true,NULL,now()),
 ('t1','00000000-0000-4000-a000-00000000eee1','office','office',false,NULL,now()),
 -- duplicate memberships: an older INACTIVE hq row and a newer ACTIVE office row
 ('t1','00000000-0000-4000-a000-00000000fff1','hq','hq',false,NULL,now() - interval '10 days'),
 ('t1','00000000-0000-4000-a000-00000000fff1','office','office',true,NULL,now());
INSERT INTO public.orders(id,tenant_id,data) VALUES ('O-1','t1','{"status":"ready_pickup"}'),('O-2','t2','{"status":"delivered"}');
INSERT INTO public.tape_direct_records(tenant_id,cost) VALUES ('t1',10),('t1',20);
