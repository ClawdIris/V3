-- Jeffy 0002: identity, closets, membership, and the invite lifecycle.
--
-- Ordering matters here. The RLS helpers are `language sql`, so their bodies
-- are parsed at CREATE time: every table they read must already exist. Hence
-- all four tables are declared first, then the helpers, then every policy.

-- ===========================================================================
-- Tables
-- ===========================================================================

create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  display_name        text,
  avatar_path         text,
  shirt_size          text,
  pants_waist         smallint check (pants_waist between 20 and 60),
  pants_length        smallint check (pants_length between 24 and 40),
  shoe_size           numeric(4, 1) check (shoe_size between 3 and 20),
  jacket_size         text,
  monthly_budget_cents integer check (monthly_budget_cents >= 0),
  -- Coarse home location, used to seed weather when the user declines the
  -- foreground location permission. Never street-level.
  home_lat            numeric(8, 4),
  home_lon            numeric(8, 4),
  onboarded_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create table public.budgets (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  category    public.item_category not null,
  min_cents   integer not null default 0 check (min_cents >= 0),
  max_cents   integer not null check (max_cents >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, category),
  constraint budgets_range_ordered check (max_cents >= min_cents)
);

create trigger budgets_touch before update on public.budgets
  for each row execute function public.touch_updated_at();

create table public.closets (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null default 'My Closet',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index closets_owner_idx on public.closets (owner_id);

create trigger closets_touch before update on public.closets
  for each row execute function public.touch_updated_at();

create table public.closet_members (
  id          uuid primary key default gen_random_uuid(),
  closet_id   uuid not null references public.closets (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.closet_role   not null,
  status      public.member_status not null default 'pending',
  invited_by  uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (closet_id, user_id)
);

create index closet_members_user_idx   on public.closet_members (user_id, status);
create index closet_members_closet_idx on public.closet_members (closet_id, status);

-- Exactly one owner row per closet.
create unique index closet_members_single_owner_idx
  on public.closet_members (closet_id) where role = 'owner';

create trigger closet_members_touch before update on public.closet_members
  for each row execute function public.touch_updated_at();

-- ===========================================================================
-- Membership helpers
--
-- SECURITY DEFINER with a pinned search_path. These read closet_members with
-- RLS bypassed, which is what stops a policy ON closet_members from recursing
-- into itself. They take no table name and return only a boolean, so the
-- definer's rights cannot be turned into a read of anything else.
--
-- `language sql` (not plpgsql) so the planner can inline them into policy
-- predicates instead of paying a function call per row.
-- ===========================================================================

create or replace function public.is_closet_member(p_closet uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.closet_members m
    where m.closet_id = p_closet
      and m.user_id   = (select auth.uid())
      and m.status    = 'accepted'
  );
$$;

create or replace function public.is_closet_owner(p_closet uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.closet_members m
    where m.closet_id = p_closet
      and m.user_id   = (select auth.uid())
      and m.role      = 'owner'
      and m.status    = 'accepted'
  );
$$;

revoke execute on function public.is_closet_member(uuid) from public, anon;
revoke execute on function public.is_closet_owner(uuid)  from public, anon;
grant  execute on function public.is_closet_member(uuid) to authenticated;
grant  execute on function public.is_closet_owner(uuid)  to authenticated;

-- ===========================================================================
-- Policies
-- ===========================================================================

alter table public.profiles       enable row level security;
alter table public.budgets        enable row level security;
alter table public.closets        enable row level security;
alter table public.closet_members enable row level security;

-- --- profiles ---------------------------------------------------------------
-- A stylist needs the owner's display name and avatar, and vice versa. Rather
-- than expose every profile in the database, expose profiles that share an
-- accepted closet membership with the caller.
create policy profiles_select_self_or_shared_closet on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.closet_members mine
      join public.closet_members theirs on theirs.closet_id = mine.closet_id
      where mine.user_id   = (select auth.uid())
        and mine.status    = 'accepted'
        and theirs.user_id = profiles.id
        and theirs.status  = 'accepted'
    )
  );

create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- --- budgets ----------------------------------------------------------------
-- Feature 4e: the stylist is meant to see the owner's ranges so their
-- recommendations stay realistic. Only the owner may change them.
create policy budgets_select_self_or_stylist on public.budgets
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or exists (
      select 1 from public.closets c
      where c.owner_id = budgets.profile_id
        and public.is_closet_member(c.id)
    )
  );

create policy budgets_write_self on public.budgets
  for all to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

-- --- closets ----------------------------------------------------------------
create policy closets_select_members on public.closets
  for select to authenticated using (public.is_closet_member(id));

create policy closets_update_owner on public.closets
  for update to authenticated
  using (public.is_closet_owner(id)) with check (public.is_closet_owner(id));

-- --- closet_members ---------------------------------------------------------
create policy closet_members_select on public.closet_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_closet_member(closet_id));

-- Revoking or re-instating a stylist is the owner's call. Membership rows are
-- never inserted directly by a client: the owner's row comes from the signup
-- trigger and the stylist's from redeem_invite(). There is deliberately no
-- INSERT policy.
create policy closet_members_update_owner on public.closet_members
  for update to authenticated
  using (public.is_closet_owner(closet_id))
  with check (public.is_closet_owner(closet_id) and role = 'stylist');

-- A stylist may walk away on their own.
create policy closet_members_delete_self on public.closet_members
  for delete to authenticated
  using (user_id = (select auth.uid()) and role = 'stylist');

-- ===========================================================================
-- invites
--
-- Only the SHA-256 of the code is stored. The plaintext is returned exactly
-- once, by create_invite() in 0003, and never persisted server-side.
-- ===========================================================================

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  closet_id   uuid not null references public.closets (id) on delete cascade,
  code_hash   text not null unique,
  -- Last four characters, so the owner can tell pending codes apart in the
  -- settings list without the server knowing the code itself.
  code_hint   text not null,
  role        public.closet_role not null default 'stylist',
  created_by  uuid not null references public.profiles (id) on delete cascade,
  expires_at  timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles (id) on delete set null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint invites_role_is_stylist check (role = 'stylist')
);

create index invites_closet_idx on public.invites (closet_id, created_at desc);

alter table public.invites enable row level security;

-- No INSERT policy and no lookup-by-code policy: a client must not be able to
-- probe code_hash. Creation and redemption both go through the SECURITY
-- DEFINER RPCs in 0003.
create policy invites_select_owner on public.invites
  for select to authenticated using (public.is_closet_owner(closet_id));

create policy invites_update_owner on public.invites
  for update to authenticated
  using (public.is_closet_owner(closet_id)) with check (public.is_closet_owner(closet_id));
