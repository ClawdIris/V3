-- Jeffy 0005: outfits (AI, stylist, and hand-built), feedback, and style rules.

create table public.outfits (
  id              uuid primary key default gen_random_uuid(),
  closet_id       uuid not null references public.closets (id) on delete cascade,
  created_by      uuid not null references public.profiles (id) on delete restrict,

  name            text,
  occasion        text,
  source          public.outfit_source not null,
  status          public.outfit_status not null default 'suggested',

  -- One-line justification from whoever built it (feature 3c / 4b).
  reason          text,
  note            text,

  -- Snapshot of the context the suggestion was made under, so a saved outfit
  -- still explains itself in six months.
  weather_summary text,
  temp_c          numeric(4, 1),
  generated_for   date,

  -- Feature 4c: the owner flags an AI outfit for the stylist to rule on.
  flagged_for_review boolean not null default false,

  worn_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index outfits_closet_idx  on public.outfits (closet_id, created_at desc);
create index outfits_status_idx  on public.outfits (closet_id, status);
create index outfits_review_idx  on public.outfits (closet_id) where flagged_for_review;

create trigger outfits_touch before update on public.outfits
  for each row execute function public.touch_updated_at();

alter table public.wear_log
  add constraint wear_log_outfit_fk
  foreign key (outfit_id) references public.outfits (id) on delete set null;

alter table public.outfits enable row level security;

create policy outfits_select_members on public.outfits
  for select to authenticated using (public.is_closet_member(closet_id));

-- The stylist building an outfit for the owner is the whole point of the app,
-- so any accepted member may create one.
create policy outfits_insert_members on public.outfits
  for insert to authenticated
  with check (public.is_closet_member(closet_id) and created_by = (select auth.uid()));

-- The owner can act on anything in their closet; a stylist can revise what
-- they themselves sent.
create policy outfits_update_owner_or_author on public.outfits
  for update to authenticated
  using (public.is_closet_owner(closet_id) or created_by = (select auth.uid()))
  with check (public.is_closet_owner(closet_id) or created_by = (select auth.uid()));

create policy outfits_delete_owner_or_author on public.outfits
  for delete to authenticated
  using (public.is_closet_owner(closet_id) or created_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- outfit_items
-- ---------------------------------------------------------------------------

create table public.outfit_items (
  outfit_id  uuid not null references public.outfits (id) on delete cascade,
  item_id    uuid not null references public.items (id) on delete cascade,
  closet_id  uuid not null references public.closets (id) on delete cascade,
  slot       public.item_category not null,
  position   smallint not null default 0,
  created_at timestamptz not null default now(),
  primary key (outfit_id, item_id)
);

create index outfit_items_item_idx on public.outfit_items (item_id);

alter table public.outfit_items enable row level security;

create policy outfit_items_select_members on public.outfit_items
  for select to authenticated using (public.is_closet_member(closet_id));

create policy outfit_items_write_members on public.outfit_items
  for all to authenticated
  using (
    public.is_closet_member(closet_id)
    and exists (
      select 1 from public.outfits o
      where o.id = outfit_items.outfit_id
        and (public.is_closet_owner(o.closet_id) or o.created_by = (select auth.uid()))
    )
  )
  with check (
    public.is_closet_member(closet_id)
    -- An outfit may only ever contain items from its own closet. Without this
    -- a stylist on two closets could splice one person's items into another's.
    and exists (
      select 1 from public.items i
      where i.id = outfit_items.item_id and i.closet_id = outfit_items.closet_id
    )
    and exists (
      select 1 from public.outfits o
      where o.id = outfit_items.outfit_id
        and o.closet_id = outfit_items.closet_id
        and (public.is_closet_owner(o.closet_id) or o.created_by = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- outfit_feedback: the stylist's approve / reject / edit / comment
-- ---------------------------------------------------------------------------

create table public.outfit_feedback (
  id         uuid primary key default gen_random_uuid(),
  outfit_id  uuid not null references public.outfits (id) on delete cascade,
  closet_id  uuid not null references public.closets (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  verdict    public.feedback_verdict not null,
  note       text,
  created_at timestamptz not null default now()
);

create index outfit_feedback_outfit_idx on public.outfit_feedback (outfit_id, created_at desc);

alter table public.outfit_feedback enable row level security;

create policy outfit_feedback_select_members on public.outfit_feedback
  for select to authenticated using (public.is_closet_member(closet_id));

create policy outfit_feedback_insert_members on public.outfit_feedback
  for insert to authenticated
  with check (public.is_closet_member(closet_id) and author_id = (select auth.uid()));

create policy outfit_feedback_modify_author on public.outfit_feedback
  for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));

create policy outfit_feedback_delete_author on public.outfit_feedback
  for delete to authenticated using (author_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- style_rules
--
-- rule_text is what the human wrote and what the model is shown. machine_rule
-- is the optional structured form the outfit engine can enforce as a hard
-- filter before the model is ever called.
-- ---------------------------------------------------------------------------

create table public.style_rules (
  id           uuid primary key default gen_random_uuid(),
  closet_id    uuid not null references public.closets (id) on delete cascade,
  author_id    uuid not null references public.profiles (id) on delete cascade,
  rule_text    text not null check (length(trim(rule_text)) > 0),
  strength     public.rule_strength not null default 'soft',
  machine_rule jsonb,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index style_rules_closet_idx on public.style_rules (closet_id) where is_active;

create trigger style_rules_touch before update on public.style_rules
  for each row execute function public.touch_updated_at();

alter table public.style_rules enable row level security;

create policy style_rules_select_members on public.style_rules
  for select to authenticated using (public.is_closet_member(closet_id));

-- Feature 4d: either person may write rules, and either may edit them. The
-- author is recorded and shown, but authorship does not gate editing.
create policy style_rules_insert_members on public.style_rules
  for insert to authenticated
  with check (public.is_closet_member(closet_id) and author_id = (select auth.uid()));

create policy style_rules_update_members on public.style_rules
  for update to authenticated
  using (public.is_closet_member(closet_id)) with check (public.is_closet_member(closet_id));

create policy style_rules_delete_owner_or_author on public.style_rules
  for delete to authenticated
  using (public.is_closet_owner(closet_id) or author_id = (select auth.uid()));
