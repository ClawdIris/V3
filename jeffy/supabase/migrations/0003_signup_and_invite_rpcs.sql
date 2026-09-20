-- Jeffy 0003: signup bootstrap and the invite RPCs.

-- ---------------------------------------------------------------------------
-- Signup: every new user gets a profile, their own closet, and an owner row.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_closet uuid;
  v_name   text;
begin
  v_name := nullif(trim(coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    ''
  )), '');

  insert into public.profiles (id, display_name)
  values (new.id, v_name)
  on conflict (id) do nothing;

  -- Sign in with Apple can deliver a second identity row for the same user;
  -- only create the closet if this user does not already have one.
  select c.id into v_closet from public.closets c where c.owner_id = new.id limit 1;

  if v_closet is null then
    insert into public.closets (owner_id) values (new.id) returning id into v_closet;

    insert into public.closet_members (closet_id, user_id, role, status, accepted_at)
    values (v_closet, new.id, 'owner', 'accepted', now())
    on conflict (closet_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Invite codes
-- ---------------------------------------------------------------------------

-- 32-character alphabet with I, O, 0 and 1 removed so codes survive being read
-- aloud or typed from a screenshot. 256 % 32 = 0, so the byte-modulo draw is
-- unbiased.
create or replace function public.gen_invite_code()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes    bytea := extensions.gen_random_bytes(8);
  result   text  := '';
  i        int;
begin
  for i in 0 .. 7 loop
    result := result || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
  end loop;
  return result;
end;
$$;

create or replace function public.hash_invite_code(p_code text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  -- Normalised the same way on both sides: uppercase, letters and digits only,
  -- so "abcd-efgh", "ABCD EFGH" and "abcdefgh" are the same code.
  select encode(
    extensions.digest(upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g')), 'sha256'),
    'hex'
  );
$$;

-- Returns the plaintext code exactly once. Only the hash is stored.
create or replace function public.create_invite(
  p_closet uuid,
  p_ttl    interval default interval '7 days'
)
returns table (code text, invite_id uuid, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_code    text;
  v_id      uuid;
  v_expires timestamptz;
  v_attempt int := 0;
begin
  if not public.is_closet_owner(p_closet) then
    raise exception 'Only the closet owner can create invites'
      using errcode = 'JFY01';
  end if;

  if p_ttl <= interval '0' or p_ttl > interval '30 days' then
    raise exception 'Invite lifetime must be between 0 and 30 days'
      using errcode = 'JFY02';
  end if;

  v_expires := now() + p_ttl;

  loop
    v_attempt := v_attempt + 1;
    v_code := public.gen_invite_code();

    begin
      insert into public.invites (closet_id, code_hash, code_hint, created_by, expires_at)
      values (
        p_closet,
        public.hash_invite_code(v_code),
        right(v_code, 4),
        (select auth.uid()),
        v_expires
      )
      returning id into v_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'Could not allocate a unique invite code' using errcode = 'JFY03';
      end if;
    end;
  end loop;

  return query select v_code, v_id, v_expires;
end;
$$;

-- Expected failures come back as a status string rather than an exception, so
-- the client can render a specific message and the flow stays unit-testable.
create or replace function public.redeem_invite(p_code text)
returns table (
  status      text,
  closet_id   uuid,
  closet_name text,
  owner_name  text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
-- The RETURNS TABLE column names (status, closet_id, ...) are also plpgsql
-- variables, and they shadow the identically named columns of closet_members
-- in the ON CONFLICT clause below. Resolve ambiguity to the column: this
-- function never reads its OUT parameters, it only RETURN QUERYs positionally.
#variable_conflict use_column
declare
  v_invite public.invites%rowtype;
  v_user   uuid := (select auth.uid());
  v_closet public.closets%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = 'JFY04';
  end if;

  select * into v_invite
  from public.invites i
  where i.code_hash = public.hash_invite_code(p_code);

  if not found then
    return query select 'invalid'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if v_invite.revoked_at is not null then
    return query select 'revoked'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if v_invite.redeemed_at is not null then
    return query select 'already_used'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if v_invite.expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::text, null::text;
    return;
  end if;

  select * into v_closet from public.closets c where c.id = v_invite.closet_id;

  if v_closet.owner_id = v_user then
    return query select 'own_closet'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if exists (
    select 1 from public.closet_members m
    where m.closet_id = v_invite.closet_id
      and m.user_id = v_user
      and m.status = 'accepted'
  ) then
    return query select 'already_member'::text, null::uuid, null::text, null::text;
    return;
  end if;

  insert into public.closet_members (closet_id, user_id, role, status, invited_by, accepted_at)
  values (v_invite.closet_id, v_user, v_invite.role, 'accepted', v_invite.created_by, now())
  on conflict (closet_id, user_id) do update
    set status      = 'accepted',
        role        = excluded.role,
        invited_by  = excluded.invited_by,
        accepted_at = now();

  update public.invites
     set redeemed_at = now(), redeemed_by = v_user
   where id = v_invite.id;

  return query
    select 'accepted'::text,
           v_closet.id,
           v_closet.name,
           (select p.display_name from public.profiles p where p.id = v_closet.owner_id);
end;
$$;

revoke execute on function public.create_invite(uuid, interval) from public, anon;
revoke execute on function public.redeem_invite(text)           from public, anon;
revoke execute on function public.gen_invite_code()             from public, anon, authenticated;
grant  execute on function public.create_invite(uuid, interval) to authenticated;
grant  execute on function public.redeem_invite(text)           to authenticated;
