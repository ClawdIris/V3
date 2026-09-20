-- Jeffy 0006: wishlist, inspiration board, shopping options, lookup cache.

create table public.wishlist_items (
  id            uuid primary key default gen_random_uuid(),
  closet_id     uuid not null references public.closets (id) on delete cascade,
  created_by    uuid not null references public.profiles (id) on delete restrict,

  name          text not null,
  brand         text,
  category      public.item_category,
  size          text,
  colors        text[] not null default '{}',
  price_cents   integer check (price_cents >= 0),
  store_name    text,
  url           text,
  image_path    text,      -- private bucket object, when the user photographed it
  image_url     text,      -- remote stock image from a lookup or web search

  source        public.wishlist_source not null default 'owner',
  -- Denormalised so "Recommended by Alex" survives the stylist being revoked.
  recommended_by uuid references public.profiles (id) on delete set null,
  note          text,

  barcode       text,
  style_number  text,

  -- Feature 6: the fit-check verdict, kept so the card reads the same when
  -- reopened without re-running the model.
  fit_summary   text,
  pairs_with    uuid[] not null default '{}',
  over_budget   boolean not null default false,
  similar_item_id uuid references public.items (id) on delete set null,

  status        public.wishlist_status not null default 'open',
  purchased_item_id uuid references public.items (id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index wishlist_closet_idx on public.wishlist_items (closet_id, status, created_at desc);

create trigger wishlist_touch before update on public.wishlist_items
  for each row execute function public.touch_updated_at();

alter table public.wishlist_items enable row level security;

create policy wishlist_select_members on public.wishlist_items
  for select to authenticated using (public.is_closet_member(closet_id));

-- The stylist recommends things into the owner's wishlist (feature 4e), so
-- both roles insert here.
create policy wishlist_insert_members on public.wishlist_items
  for insert to authenticated
  with check (public.is_closet_member(closet_id) and created_by = (select auth.uid()));

create policy wishlist_update_owner_or_author on public.wishlist_items
  for update to authenticated
  using (public.is_closet_owner(closet_id) or created_by = (select auth.uid()))
  with check (public.is_closet_owner(closet_id) or created_by = (select auth.uid()));

create policy wishlist_delete_owner_or_author on public.wishlist_items
  for delete to authenticated
  using (public.is_closet_owner(closet_id) or created_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- inspiration board
-- ---------------------------------------------------------------------------

create table public.inspiration_looks (
  id             uuid primary key default gen_random_uuid(),
  closet_id      uuid not null references public.closets (id) on delete cascade,
  created_by     uuid not null references public.profiles (id) on delete restrict,
  storage_path   text not null,
  thumb_path     text not null,
  title          text,
  note           text,
  status         public.look_status not null default 'pending',
  analysis_error text,
  saved_outfit_id uuid references public.outfits (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index inspiration_looks_closet_idx on public.inspiration_looks (closet_id, created_at desc);

create trigger inspiration_looks_touch before update on public.inspiration_looks
  for each row execute function public.touch_updated_at();

alter table public.inspiration_looks enable row level security;

create policy inspiration_looks_select_members on public.inspiration_looks
  for select to authenticated using (public.is_closet_member(closet_id));

create policy inspiration_looks_insert_members on public.inspiration_looks
  for insert to authenticated
  with check (public.is_closet_member(closet_id) and created_by = (select auth.uid()));

create policy inspiration_looks_update_owner_or_author on public.inspiration_looks
  for update to authenticated
  using (public.is_closet_owner(closet_id) or created_by = (select auth.uid()))
  with check (public.is_closet_owner(closet_id) or created_by = (select auth.uid()));

create policy inspiration_looks_delete_owner_or_author on public.inspiration_looks
  for delete to authenticated
  using (public.is_closet_owner(closet_id) or created_by = (select auth.uid()));

create table public.inspiration_pieces (
  id             uuid primary key default gen_random_uuid(),
  look_id        uuid not null references public.inspiration_looks (id) on delete cascade,
  closet_id      uuid not null references public.closets (id) on delete cascade,
  description    text not null,
  category       public.item_category,
  colors         text[] not null default '{}',
  match_status   public.piece_match not null default 'missing',
  matched_item_id uuid references public.items (id) on delete set null,
  confidence     numeric(3, 2) check (confidence between 0 and 1),
  position       smallint not null default 0,
  created_at     timestamptz not null default now()
);

create index inspiration_pieces_look_idx on public.inspiration_pieces (look_id, position);

alter table public.inspiration_pieces enable row level security;

create policy inspiration_pieces_select_members on public.inspiration_pieces
  for select to authenticated using (public.is_closet_member(closet_id));

create policy inspiration_pieces_write_members on public.inspiration_pieces
  for all to authenticated
  using (public.is_closet_member(closet_id)) with check (public.is_closet_member(closet_id));

-- ---------------------------------------------------------------------------
-- shopping_options: buy options found for a missing piece
-- ---------------------------------------------------------------------------

create table public.shopping_options (
  id          uuid primary key default gen_random_uuid(),
  piece_id    uuid references public.inspiration_pieces (id) on delete cascade,
  closet_id   uuid not null references public.closets (id) on delete cascade,
  title       text not null,
  store_name  text,
  price_cents integer check (price_cents >= 0),
  url         text,
  image_url   text,
  note        text,
  tier        public.price_tier not null default 'mid',
  over_budget boolean not null default false,
  local_store boolean not null default false,
  -- Web-search results go stale; the UI shows this rather than implying the
  -- price is live.
  checked_at  timestamptz not null default now(),
  chosen_by   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index shopping_options_piece_idx on public.shopping_options (piece_id, price_cents);

alter table public.shopping_options enable row level security;

create policy shopping_options_select_members on public.shopping_options
  for select to authenticated using (public.is_closet_member(closet_id));

create policy shopping_options_write_members on public.shopping_options
  for all to authenticated
  using (public.is_closet_member(closet_id)) with check (public.is_closet_member(closet_id));

-- ---------------------------------------------------------------------------
-- product_lookup_cache
--
-- Global rather than per-closet: a UPC means the same thing for everyone, and
-- the point is that the same code never costs a second API call (feature 7g).
-- Readable by any signed-in user, writable only by the Edge Function's service
-- role — there is deliberately no INSERT or UPDATE policy here.
-- ---------------------------------------------------------------------------

create table public.product_lookup_cache (
  barcode     text primary key,
  provider    text not null,
  found       boolean not null,
  payload     jsonb,
  -- Negative results are cached too, with a shorter TTL applied in the
  -- function, so a miss does not burn the daily quota repeatedly.
  fetched_at  timestamptz not null default now(),
  hit_count   integer not null default 0
);

create index product_lookup_cache_fetched_idx on public.product_lookup_cache (fetched_at);

alter table public.product_lookup_cache enable row level security;

create policy product_lookup_cache_select on public.product_lookup_cache
  for select to authenticated using (true);
