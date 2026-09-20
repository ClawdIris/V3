-- Jeffy RLS suite.
--
-- Three real users, three JWTs, and assertions in both directions: what each
-- role MUST be able to do, and what it must NOT. A policy that merely returns
-- zero rows is tested by counting rows; a policy that must reject a write is
-- tested by asserting the write raises insufficient_privilege (42501).

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists test;

create or replace function test.assert(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_cond then
    raise notice '  PASS  %', p_label;
  else
    raise exception 'FAIL  %', p_label;
  end if;
end;
$$;

-- Runs p_sql as the current role and requires it to be refused by RLS.
-- A statement that merely returns no rows is NOT a denial, so this is only
-- ever used for writes.
create or replace function test.denied(p_sql text, p_label text)
returns void language plpgsql as $$
declare
  refused boolean := false;
begin
  begin
    execute p_sql;
  exception
    when insufficient_privilege then refused := true;
    when others then
      if sqlstate = '42501' then refused := true; else raise; end if;
  end;
  if not refused then
    raise exception 'FAIL  % (statement was allowed but must be denied)', p_label;
  end if;
  raise notice '  PASS  %', p_label;
end;
$$;

-- UPDATE and DELETE behave differently from INSERT under RLS: a USING clause
-- that matches no rows changes nothing and raises nothing. That is the correct
-- security outcome, so it is asserted by row count rather than by exception.
-- Only INSERT, and an UPDATE whose WITH CHECK fails, raise 42501.
create or replace function test.no_rows_changed(p_sql text, p_label text)
returns void language plpgsql as $$
declare
  n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL  % (% row(s) changed; RLS should have matched none)', p_label, n;
  end if;
  raise notice '  PASS  %', p_label;
end;
$$;

grant usage on schema test to authenticated;
grant execute on all functions in schema test to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures: three users. Inserting into auth.users fires handle_new_user().
-- ---------------------------------------------------------------------------

\set owner_id   '11111111-1111-1111-1111-111111111111'
\set stylist_id '22222222-2222-2222-2222-222222222222'
\set other_id   '33333333-3333-3333-3333-333333333333'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'owner_id',   'jeff@example.com',    '{"display_name":"Jeff"}'),
  (:'stylist_id', 'alex@example.com',    '{"display_name":"Alex"}'),
  (:'other_id',   'mallory@example.com', '{"display_name":"Mallory"}');

\echo '== signup trigger =='
do $$
begin
  perform test.assert(
    (select count(*) from public.profiles) = 3, 'signup created a profile per user');
  perform test.assert(
    (select count(*) from public.closets) = 3, 'signup created a closet per user');
  perform test.assert(
    (select count(*) from public.closet_members where role = 'owner' and status = 'accepted') = 3,
    'signup created an accepted owner membership per user');
  perform test.assert(
    (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111') = 'Jeff',
    'display_name carried over from auth metadata');
end;
$$;

-- Capture the owner's closet for later steps.
create temp table t_ctx as
  select c.id as owner_closet, c2.id as other_closet
  from public.closets c, public.closets c2
  where c.owner_id = '11111111-1111-1111-1111-111111111111'
    and c2.owner_id = '33333333-3333-3333-3333-333333333333';

-- Fixture tables are created by the superuser but read while impersonating
-- `authenticated`, so they need an explicit grant.
grant select on t_ctx to authenticated;

-- ---------------------------------------------------------------------------
\echo '== owner can build their closet =='
-- ---------------------------------------------------------------------------

set request.jwt.claim.sub = :'owner_id';
set role authenticated;

insert into public.items (closet_id, created_by, name, category, colors, formality, seasons)
select owner_closet, '11111111-1111-1111-1111-111111111111',
       'Navy oxford shirt', 'top', array['navy'], 3, array['fall','winter']::public.season[]
from t_ctx;

insert into public.items (closet_id, created_by, name, category, colors, formality, seasons)
select owner_closet, '11111111-1111-1111-1111-111111111111',
       'Black slim jeans', 'bottom', array['black'], 2, array['fall','winter','spring']::public.season[]
from t_ctx;

do $$
begin
  perform test.assert((select count(*) from public.items) = 2, 'owner inserted and can read own items');
  perform test.assert((select count(*) from public.closets) = 1, 'owner sees only their own closet');
end;
$$;

-- An owner must not be able to write into somebody else's closet.
select test.denied(
  format($q$insert into public.items (closet_id, created_by, name, category)
            values (%L, %L, 'Trojan horse', 'top')$q$,
         (select other_closet from t_ctx), :'owner_id'),
  'owner cannot insert into a closet they do not own');

reset role;

-- ---------------------------------------------------------------------------
\echo '== a stranger sees nothing =='
-- ---------------------------------------------------------------------------

set request.jwt.claim.sub = :'other_id';
set role authenticated;

do $$
begin
  perform test.assert((select count(*) from public.items) = 0, 'non-member reads zero items');
  perform test.assert((select count(*) from public.closets) = 1, 'non-member sees only their own closet');
  perform test.assert(
    (select count(*) from public.profiles) = 1, 'non-member sees only their own profile');
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
\echo '== invite lifecycle =='
-- ---------------------------------------------------------------------------

set request.jwt.claim.sub = :'owner_id';
set role authenticated;

create temp table t_invite as
  select * from public.create_invite((select owner_closet from t_ctx));

do $$
begin
  perform test.assert((select length(code) from t_invite) = 8, 'invite code is 8 characters');
  perform test.assert(
    (select code from t_invite) ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$',
    'invite code uses the unambiguous alphabet only');
  perform test.assert(
    (select count(*) from public.invites where code_hash = (select code from t_invite)) = 0,
    'plaintext code is NOT stored in code_hash');
  perform test.assert(
    (select code_hash from public.invites) = public.hash_invite_code((select code from t_invite)),
    'stored hash matches the issued code');
end;
$$;

reset role;

-- A non-owner must not be able to mint an invite for someone else's closet.
set request.jwt.claim.sub = :'other_id';
set role authenticated;
do $$
declare refused boolean := false;
begin
  begin
    perform public.create_invite((select owner_closet from t_ctx));
  exception when others then
    refused := (sqlstate = 'JFY01');
  end;
  perform test.assert(refused, 'non-owner cannot create an invite');
end;
$$;
reset role;

\echo '-- redemption --'
set request.jwt.claim.sub = :'stylist_id';
set role authenticated;

do $$
declare r record;
begin
  select * into r from public.redeem_invite('NOTACODE1');
  perform test.assert(r.status = 'invalid', 'unknown code returns invalid');

  select * into r from public.redeem_invite((select code from t_invite));
  perform test.assert(r.status = 'accepted', 'valid code is accepted');
  perform test.assert(r.owner_name = 'Jeff', 'redemption reports the owner name');

  -- Codes are single use.
  select * into r from public.redeem_invite((select code from t_invite));
  perform test.assert(r.status = 'already_used', 'a redeemed code cannot be reused');
end;
$$;

do $$
begin
  perform test.assert(
    (select count(*) from public.items) = 2, 'accepted stylist can read the owner''s items');
  perform test.assert(
    (select count(*) from public.closets) = 2, 'stylist now sees their own closet and the owner''s');
  perform test.assert(
    (select count(*) from public.profiles where display_name = 'Jeff') = 1,
    'stylist can see the owner''s profile');
end;
$$;

-- Case and punctuation are normalised, so a code read aloud still works.
reset role;
set request.jwt.claim.sub = :'owner_id';
set role authenticated;
create temp table t_invite2 as select * from public.create_invite((select owner_closet from t_ctx));
reset role;

set request.jwt.claim.sub = :'other_id';
set role authenticated;
do $$
declare r record; formatted text;
begin
  select lower(substr(code,1,4) || '-' || substr(code,5,4)) into formatted from t_invite2;
  select * into r from public.redeem_invite(formatted);
  perform test.assert(r.status = 'accepted', 'code normalisation accepts "abcd-efgh" for "ABCDEFGH"');
end;
$$;
reset role;

-- The owner cannot redeem an invite into their own closet.
set request.jwt.claim.sub = :'owner_id';
set role authenticated;
create temp table t_invite3 as select * from public.create_invite((select owner_closet from t_ctx));
do $$
declare r record;
begin
  select * into r from public.redeem_invite((select code from t_invite3));
  perform test.assert(r.status = 'own_closet', 'owner cannot redeem an invite to their own closet');
end;
$$;
reset role;

-- Expiry is enforced.
update public.invites set expires_at = now() - interval '1 day'
 where code_hash = public.hash_invite_code((select code from t_invite3));

set request.jwt.claim.sub = :'stylist_id';
set role authenticated;
do $$
declare r record;
begin
  select * into r from public.redeem_invite((select code from t_invite3));
  perform test.assert(r.status = 'expired', 'an expired code is refused');
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
\echo '== stylist is read-only on the closet =='
-- ---------------------------------------------------------------------------

set request.jwt.claim.sub = :'stylist_id';
set role authenticated;

select test.denied(
  format($q$insert into public.items (closet_id, created_by, name, category)
            values (%L, %L, 'Stylist smuggled this in', 'top')$q$,
         (select owner_closet from t_ctx), :'stylist_id'),
  'stylist cannot insert items');

select test.no_rows_changed(
  $q$update public.items set name = 'renamed by stylist'$q$,
  'stylist cannot rename items');

select test.no_rows_changed(
  $q$delete from public.items$q$,
  'stylist cannot delete items');

-- But the stylist CAN do their actual job.
insert into public.style_rules (closet_id, author_id, rule_text, strength)
select owner_closet, '22222222-2222-2222-2222-222222222222',
       'No brown belt with black shoes', 'hard' from t_ctx;

insert into public.outfits (closet_id, created_by, source, occasion, reason)
select owner_closet, '22222222-2222-2222-2222-222222222222',
       'stylist', 'date', 'Clean contrast, and the oxford is overdue a wear' from t_ctx;

insert into public.outfit_items (outfit_id, item_id, closet_id, slot)
select o.id, i.id, i.closet_id, i.category
from public.outfits o, public.items i
where o.source = 'stylist' and i.name = 'Navy oxford shirt';

do $$
begin
  perform test.assert((select count(*) from public.style_rules) = 1, 'stylist can write a style rule');
  perform test.assert((select count(*) from public.outfits) = 1, 'stylist can build an outfit');
  perform test.assert((select count(*) from public.outfit_items) = 1, 'stylist can put items in it');
end;
$$;

-- Feature 4e: the stylist must be able to read the owner's budget.
reset role;
insert into public.budgets (profile_id, category, min_cents, max_cents)
values (:'owner_id', 'top', 2000, 8000);

set request.jwt.claim.sub = :'stylist_id';
set role authenticated;
do $$
begin
  perform test.assert((select count(*) from public.budgets) = 1, 'stylist can read the owner''s budget');
end;
$$;

select test.denied(
  format($q$insert into public.budgets (profile_id, category, min_cents, max_cents)
            values (%L, 'shoes', 0, 100)$q$, :'owner_id'),
  'stylist cannot rewrite the owner''s budget');

reset role;

-- ---------------------------------------------------------------------------
\echo '== cross-closet splicing =='
-- ---------------------------------------------------------------------------

-- Mallory is a stylist on her own closet and (from the normalisation test
-- above) on Jeff's. She must not be able to move items between them.
set request.jwt.claim.sub = :'other_id';
set role authenticated;

insert into public.items (closet_id, created_by, name, category)
select other_closet, '33333333-3333-3333-3333-333333333333', 'Mallory tee', 'top' from t_ctx;

insert into public.outfits (closet_id, created_by, source, occasion)
select owner_closet, '33333333-3333-3333-3333-333333333333', 'stylist', 'errands' from t_ctx;

select test.denied(
  format($q$insert into public.outfit_items (outfit_id, item_id, closet_id, slot)
            select o.id, i.id, %L, 'top'
            from public.outfits o, public.items i
            where o.occasion = 'errands' and i.name = 'Mallory tee'$q$,
         (select owner_closet from t_ctx)),
  'cannot splice another closet''s item into this closet''s outfit');

reset role;

-- ---------------------------------------------------------------------------
\echo '== chat =='
-- ---------------------------------------------------------------------------

set request.jwt.claim.sub = :'stylist_id';
set role authenticated;
insert into public.messages (closet_id, sender_id, body)
select owner_closet, '22222222-2222-2222-2222-222222222222', 'that oxford with the black jeans' from t_ctx;
reset role;

set request.jwt.claim.sub = :'owner_id';
set role authenticated;
do $$
begin
  perform test.assert((select count(*) from public.messages) = 1, 'owner receives the stylist''s message');
end;
$$;

select test.denied(
  format($q$insert into public.messages (closet_id, sender_id, body)
            values (%L, %L, 'spoofed')$q$, (select owner_closet from t_ctx), :'stylist_id'),
  'cannot post a message as another user');

reset role;

-- ---------------------------------------------------------------------------
\echo '== storage paths =='
-- ---------------------------------------------------------------------------

set request.jwt.claim.sub = :'owner_id';
set role authenticated;

insert into storage.objects (bucket_id, name, owner_id)
select 'closet-media', owner_closet || '/items/a/photo.jpg', :'owner_id' from t_ctx;

do $$
begin
  perform test.assert((select count(*) from storage.objects) = 1, 'owner can upload into their items folder');
end;
$$;

reset role;
set request.jwt.claim.sub = :'stylist_id';
set role authenticated;

select test.denied(
  format($q$insert into storage.objects (bucket_id, name, owner_id)
            values ('closet-media', %L, %L)$q$,
         (select owner_closet || '/items/b/photo.jpg' from t_ctx), :'stylist_id'),
  'stylist cannot upload into the items folder');

-- ...but may upload a chat photo.
insert into storage.objects (bucket_id, name, owner_id)
select 'closet-media', owner_closet || '/chat/c/photo.jpg', :'stylist_id' from t_ctx;

do $$
begin
  perform test.assert((select count(*) from storage.objects) = 2, 'stylist can upload a chat photo');
end;
$$;

reset role;
set request.jwt.claim.sub = :'other_id';
set role authenticated;

-- A path whose first segment is not a uuid must fail closed, not error.
select test.denied(
  $q$insert into storage.objects (bucket_id, name, owner_id)
     values ('closet-media', 'not-a-uuid/items/x.jpg', '33333333-3333-3333-3333-333333333333')$q$,
  'malformed storage path is refused rather than erroring');

reset role;

-- ---------------------------------------------------------------------------
\echo '== revocation cuts access immediately =='
-- ---------------------------------------------------------------------------

set request.jwt.claim.sub = :'owner_id';
set role authenticated;
update public.closet_members set status = 'revoked'
 where user_id = '22222222-2222-2222-2222-222222222222'
   and closet_id = (select owner_closet from t_ctx);
reset role;

set request.jwt.claim.sub = :'stylist_id';
set role authenticated;
do $$
begin
  perform test.assert((select count(*) from public.items) = 0, 'revoked stylist reads zero items');
  perform test.assert((select count(*) from public.messages) = 0, 'revoked stylist reads zero messages');
  perform test.assert((select count(*) from public.closets) = 1, 'revoked stylist sees only their own closet');
  perform test.assert((select count(*) from public.budgets) = 0, 'revoked stylist loses budget visibility');
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
\echo '== wear log keeps items in step =='
-- ---------------------------------------------------------------------------

set request.jwt.claim.sub = :'owner_id';
set role authenticated;

insert into public.wear_log (closet_id, item_id, worn_on)
select i.closet_id, i.id, current_date from public.items i where i.name = 'Navy oxford shirt';

do $$
begin
  perform test.assert(
    (select wear_count from public.items where name = 'Navy oxford shirt') = 1,
    'logging a wear increments wear_count');
  perform test.assert(
    (select last_worn_at::date from public.items where name = 'Navy oxford shirt') = current_date,
    'logging a wear sets last_worn_at');
end;
$$;

reset role;

\echo ''
\echo 'RLS suite passed.'
