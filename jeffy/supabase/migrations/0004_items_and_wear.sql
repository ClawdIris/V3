-- Jeffy 0004: the closet itself — items, their photos, and the wear log.

create type public.item_source as enum ('manual', 'ai_single', 'ai_rack', 'scan');

create table public.items (
  id                 uuid primary key default gen_random_uuid(),
  closet_id          uuid not null references public.closets (id) on delete cascade,
  created_by         uuid not null references public.profiles (id) on delete restrict,

  name               text not null,
  category           public.item_category not null,
  subcategory        text,
  colors             text[] not null default '{}',
  pattern            text,
  material           text,
  -- 1 = gym/loungewear, 3 = business casual, 5 = black tie.
  formality          smallint not null default 3 check (formality between 1 and 5),
  seasons            public.season[] not null default '{}',

  brand              text,
  size               text,
  barcode            text,
  style_number       text,
  purchase_price_cents integer check (purchase_price_cents >= 0),

  tags               text[] not null default '{}',
  notes              text,

  is_favorite        boolean not null default false,
  -- In the laundry: excluded from suggestions until cleared. Orthogonal to
  -- status, because a dirty item is still owned.
  is_dirty           boolean not null default false,
  status             public.item_status not null default 'active',

  last_worn_at       timestamptz,
  wear_count         integer not null default 0 check (wear_count >= 0),

  source             public.item_source not null default 'manual',
  ai_confidence      numeric(3, 2) check (ai_confidence between 0 and 1),
  -- What the model originally proposed, kept so a bad tag can be diagnosed
  -- after the user has corrected it.
  ai_raw             jsonb,

  primary_photo_id   uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index items_closet_status_idx on public.items (closet_id, status);
create index items_closet_cat_idx    on public.items (closet_id, category) where status = 'active';
create index items_last_worn_idx     on public.items (closet_id, last_worn_at desc nulls last);
create index items_colors_idx        on public.items using gin (colors);
create index items_tags_idx          on public.items using gin (tags);
create index items_seasons_idx       on public.items using gin (seasons);

-- Feature 7f: a rescan of the same tag must say "already in your closet"
-- rather than create a duplicate.
create unique index items_barcode_unique_idx
  on public.items (closet_id, barcode) where barcode is not null;

create index items_search_idx on public.items
  using gin (to_tsvector('simple',
    coalesce(name, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(subcategory, '')));

create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

alter table public.items enable row level security;

create policy items_select_members on public.items
  for select to authenticated using (public.is_closet_member(closet_id));

-- Cataloguing is the owner's job; the stylist reads. Widening this to any
-- accepted member is a one-line change if that turns out to be wanted.
create policy items_insert_owner on public.items
  for insert to authenticated
  with check (public.is_closet_owner(closet_id) and created_by = (select auth.uid()));

create policy items_update_owner on public.items
  for update to authenticated
  using (public.is_closet_owner(closet_id)) with check (public.is_closet_owner(closet_id));

create policy items_delete_owner on public.items
  for delete to authenticated using (public.is_closet_owner(closet_id));

-- ---------------------------------------------------------------------------
-- item_photos
--
-- closet_id is denormalised so the policy is a single helper call and so the
-- storage path can be derived without a join.
-- ---------------------------------------------------------------------------

create table public.item_photos (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.items (id) on delete cascade,
  closet_id    uuid not null references public.closets (id) on delete cascade,
  storage_path text not null unique,
  thumb_path   text not null,
  width        integer check (width > 0),
  height       integer check (height > 0),
  bytes        integer check (bytes > 0),
  position     smallint not null default 0,
  created_at   timestamptz not null default now()
);

create index item_photos_item_idx on public.item_photos (item_id, position);

alter table public.items
  add constraint items_primary_photo_fk
  foreign key (primary_photo_id) references public.item_photos (id) on delete set null;

alter table public.item_photos enable row level security;

create policy item_photos_select_members on public.item_photos
  for select to authenticated using (public.is_closet_member(closet_id));

create policy item_photos_write_owner on public.item_photos
  for all to authenticated
  using (public.is_closet_owner(closet_id)) with check (public.is_closet_owner(closet_id));

-- ---------------------------------------------------------------------------
-- wear_log: drives "avoid what I wore in the last few days" and the stats tab.
-- ---------------------------------------------------------------------------

create table public.wear_log (
  id         uuid primary key default gen_random_uuid(),
  closet_id  uuid not null references public.closets (id) on delete cascade,
  item_id    uuid not null references public.items (id) on delete cascade,
  outfit_id  uuid,
  worn_on    date not null default current_date,
  created_at timestamptz not null default now(),
  unique (item_id, worn_on, outfit_id)
);

create index wear_log_closet_idx on public.wear_log (closet_id, worn_on desc);
create index wear_log_item_idx   on public.wear_log (item_id, worn_on desc);

alter table public.wear_log enable row level security;

create policy wear_log_select_members on public.wear_log
  for select to authenticated using (public.is_closet_member(closet_id));

create policy wear_log_write_owner on public.wear_log
  for all to authenticated
  using (public.is_closet_owner(closet_id)) with check (public.is_closet_owner(closet_id));

-- Keep items.last_worn_at and wear_count in step with the log, so suggestion
-- queries never need to aggregate wear_log at read time.
create or replace function public.sync_item_wear()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item uuid := coalesce(new.item_id, old.item_id);
begin
  update public.items i
     set last_worn_at = sub.last_worn,
         wear_count   = sub.n
    from (
      select max(w.worn_on)::timestamptz as last_worn, count(*)::int as n
      from public.wear_log w
      where w.item_id = v_item
    ) sub
   where i.id = v_item;
  return null;
end;
$$;

create trigger wear_log_sync
  after insert or delete on public.wear_log
  for each row execute function public.sync_item_wear();
