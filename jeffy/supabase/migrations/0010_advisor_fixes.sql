-- Jeffy 0010: findings from Supabase's security and performance advisors,
-- run against the live project after 0001-0009 were applied.

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------

-- touch_updated_at had no pinned search_path. It touches only NEW, so this was
-- not exploitable, but every function here should be pinned as a matter of
-- course.
alter function public.touch_updated_at() set search_path = public, pg_temp;

-- Trigger functions were executable by anon and authenticated through
-- PostgREST's /rpc/ endpoint. Postgres refuses to call a `returns trigger`
-- function outside a trigger, so this was not a live hole -- but the grant
-- served no purpose and tripped the linter, so it goes.
revoke execute on function public.handle_new_user()  from public, anon, authenticated;
revoke execute on function public.sync_item_wear()   from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- Deliberately NOT changed, despite the linter: create_invite, redeem_invite,
-- is_closet_member and is_closet_owner are SECURITY DEFINER and callable by
-- authenticated users because that is their job. Each checks auth.uid()
-- itself and returns only a boolean or a status.

-- ---------------------------------------------------------------------------
-- Performance: one policy per action
--
-- A `for all` policy also applies to SELECT, so these six tables evaluated
-- two permissive policies on every read. Splitting into insert / update /
-- delete keeps behaviour identical (the RLS suite proves it) and halves the
-- work per row.
-- ---------------------------------------------------------------------------

-- budgets: owner writes their own
drop policy budgets_write_self on public.budgets;
create policy budgets_insert_self on public.budgets
  for insert to authenticated with check (profile_id = (select auth.uid()));
create policy budgets_update_self on public.budgets
  for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
create policy budgets_delete_self on public.budgets
  for delete to authenticated using (profile_id = (select auth.uid()));

-- item_photos: owner writes
drop policy item_photos_write_owner on public.item_photos;
create policy item_photos_insert_owner on public.item_photos
  for insert to authenticated with check (public.is_closet_owner(closet_id));
create policy item_photos_update_owner on public.item_photos
  for update to authenticated
  using (public.is_closet_owner(closet_id)) with check (public.is_closet_owner(closet_id));
create policy item_photos_delete_owner on public.item_photos
  for delete to authenticated using (public.is_closet_owner(closet_id));

-- wear_log: owner writes
drop policy wear_log_write_owner on public.wear_log;
create policy wear_log_insert_owner on public.wear_log
  for insert to authenticated with check (public.is_closet_owner(closet_id));
create policy wear_log_update_owner on public.wear_log
  for update to authenticated
  using (public.is_closet_owner(closet_id)) with check (public.is_closet_owner(closet_id));
create policy wear_log_delete_owner on public.wear_log
  for delete to authenticated using (public.is_closet_owner(closet_id));

-- inspiration_pieces: any member writes
drop policy inspiration_pieces_write_members on public.inspiration_pieces;
create policy inspiration_pieces_insert_members on public.inspiration_pieces
  for insert to authenticated with check (public.is_closet_member(closet_id));
create policy inspiration_pieces_update_members on public.inspiration_pieces
  for update to authenticated
  using (public.is_closet_member(closet_id)) with check (public.is_closet_member(closet_id));
create policy inspiration_pieces_delete_members on public.inspiration_pieces
  for delete to authenticated using (public.is_closet_member(closet_id));

-- shopping_options: any member writes
drop policy shopping_options_write_members on public.shopping_options;
create policy shopping_options_insert_members on public.shopping_options
  for insert to authenticated with check (public.is_closet_member(closet_id));
create policy shopping_options_update_members on public.shopping_options
  for update to authenticated
  using (public.is_closet_member(closet_id)) with check (public.is_closet_member(closet_id));
create policy shopping_options_delete_members on public.shopping_options
  for delete to authenticated using (public.is_closet_member(closet_id));

-- outfit_items: the owner, or the outfit's author; and never an item from
-- another closet (the anti-splicing check moves into the insert/update
-- WITH CHECK, exactly where it was).
drop policy outfit_items_write_members on public.outfit_items;

create policy outfit_items_insert_members on public.outfit_items
  for insert to authenticated
  with check (
    public.is_closet_member(closet_id)
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

create policy outfit_items_update_members on public.outfit_items
  for update to authenticated
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

create policy outfit_items_delete_members on public.outfit_items
  for delete to authenticated
  using (
    public.is_closet_member(closet_id)
    and exists (
      select 1 from public.outfits o
      where o.id = outfit_items.outfit_id
        and (public.is_closet_owner(o.closet_id) or o.created_by = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- Performance: covering indexes on the foreign keys the app filters by
--
-- Every child table's closet_id is what a screen queries on, and the
-- created_by / author columns back "who wrote this" displays. Left out on
-- purpose: invites.redeemed_by, closet_members.invited_by,
-- shopping_options.chosen_by and the wishlist back-references, which are
-- read as columns of a row already fetched, never filtered on.
-- ---------------------------------------------------------------------------

create index item_photos_closet_idx          on public.item_photos (closet_id);
create index outfit_items_closet_idx         on public.outfit_items (closet_id);
create index outfit_feedback_closet_idx      on public.outfit_feedback (closet_id);
create index message_attachments_closet_idx  on public.message_attachments (closet_id);
create index inspiration_pieces_closet_idx   on public.inspiration_pieces (closet_id);
create index shopping_options_closet_idx     on public.shopping_options (closet_id);

create index items_created_by_idx            on public.items (created_by);
create index items_primary_photo_idx         on public.items (primary_photo_id);
create index outfits_created_by_idx          on public.outfits (created_by);
create index outfit_feedback_author_idx      on public.outfit_feedback (author_id);
create index style_rules_author_idx          on public.style_rules (author_id);
create index messages_sender_idx             on public.messages (sender_id);
create index wishlist_created_by_idx         on public.wishlist_items (created_by);
create index inspiration_looks_created_by_idx on public.inspiration_looks (created_by);
create index inspiration_looks_saved_outfit_idx on public.inspiration_looks (saved_outfit_id);
create index inspiration_pieces_matched_item_idx on public.inspiration_pieces (matched_item_id);
create index wear_log_outfit_idx             on public.wear_log (outfit_id);
