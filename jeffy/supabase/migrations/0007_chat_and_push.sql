-- Jeffy 0007: realtime chat, inline attachments, and push tokens.

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  closet_id  uuid not null references public.closets (id) on delete cascade,
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  body       text,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  -- A message with no text must carry at least one attachment; enforced
  -- after insert by the trigger below, since attachments land separately.
  constraint messages_body_or_attachment check (body is null or length(trim(body)) > 0)
);

create index messages_closet_idx on public.messages (closet_id, created_at desc);

alter table public.messages enable row level security;

create policy messages_select_members on public.messages
  for select to authenticated using (public.is_closet_member(closet_id));

create policy messages_insert_members on public.messages
  for insert to authenticated
  with check (public.is_closet_member(closet_id) and sender_id = (select auth.uid()));

create policy messages_update_sender on public.messages
  for update to authenticated
  using (sender_id = (select auth.uid())) with check (sender_id = (select auth.uid()));

create policy messages_delete_sender on public.messages
  for delete to authenticated using (sender_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- message_attachments: item / outfit / wishlist / inspiration cards, or a photo
-- ---------------------------------------------------------------------------

create table public.message_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages (id) on delete cascade,
  closet_id    uuid not null references public.closets (id) on delete cascade,
  kind         public.attachment_kind not null,
  -- Points at items / outfits / wishlist_items / inspiration_looks depending
  -- on kind. Polymorphic by design: a real FK per kind would mean four
  -- nullable columns and four constraints for no added safety, since RLS
  -- already confines every one of those tables to this closet.
  ref_id       uuid,
  storage_path text,
  thumb_path   text,
  created_at   timestamptz not null default now(),
  constraint message_attachments_ref_or_path check (
    (kind = 'photo' and storage_path is not null)
    or (kind <> 'photo' and ref_id is not null)
  )
);

create index message_attachments_message_idx on public.message_attachments (message_id);

alter table public.message_attachments enable row level security;

create policy message_attachments_select_members on public.message_attachments
  for select to authenticated using (public.is_closet_member(closet_id));

create policy message_attachments_insert_sender on public.message_attachments
  for insert to authenticated
  with check (
    public.is_closet_member(closet_id)
    and exists (
      select 1 from public.messages m
      where m.id = message_attachments.message_id
        and m.sender_id = (select auth.uid())
        and m.closet_id = message_attachments.closet_id
    )
  );

create policy message_attachments_delete_sender on public.message_attachments
  for delete to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = message_attachments.message_id and m.sender_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- push_tokens
-- ---------------------------------------------------------------------------

create table public.push_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  token       text not null unique,
  platform    text not null default 'ios' check (platform in ('ios', 'android')),
  device_name text,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- A user manages only their own tokens. The dispatcher reads them with the
-- service role, so there is no cross-user select policy.
create policy push_tokens_all_self on public.push_tokens
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_attachments;
alter publication supabase_realtime add table public.outfits;
alter publication supabase_realtime add table public.wishlist_items;
