-- Jeffy 0008: private Storage buckets and their policies.
--
-- Every object path begins with the closet id (or the user id, for avatars),
-- so a single foldername() lookup reuses the same membership helpers the
-- table policies use. Nothing is public; the app reads through signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('closet-media', 'closet-media', false, 15728640,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('avatars', 'avatars', false, 5242880,
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- A path whose first segment is not a uuid yields null, and is_closet_member
-- (null) is false — so a malformed path fails closed rather than erroring.
create or replace function public.safe_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function public.safe_uuid(text) to authenticated;

-- ---------------------------------------------------------------------------
-- closet-media:  {closet_id}/{area}/...
--   area = items       -> owner writes, members read
--   area = inspiration | chat | wishlist -> members write, members read
-- ---------------------------------------------------------------------------

create policy closet_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'closet-media'
    and public.is_closet_member(public.safe_uuid((storage.foldername(name))[1]))
  );

create policy closet_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'closet-media'
    and public.is_closet_member(public.safe_uuid((storage.foldername(name))[1]))
    and (
      (storage.foldername(name))[2] in ('inspiration', 'chat', 'wishlist')
      or (
        (storage.foldername(name))[2] = 'items'
        and public.is_closet_owner(public.safe_uuid((storage.foldername(name))[1]))
      )
    )
  );

create policy closet_media_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'closet-media'
    and public.is_closet_owner(public.safe_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id = 'closet-media'
    and public.is_closet_owner(public.safe_uuid((storage.foldername(name))[1]))
  );

-- The owner can clear anything from their closet; a stylist can remove only
-- what they uploaded (owner_id is the uploading user, set by Storage).
create policy closet_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'closet-media'
    and (
      public.is_closet_owner(public.safe_uuid((storage.foldername(name))[1]))
      or (
        public.is_closet_member(public.safe_uuid((storage.foldername(name))[1]))
        and owner_id = (select auth.uid()::text)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- avatars: {user_id}/...
-- Readable by anyone who shares an accepted closet with that user, so the
-- chat and the "Outfit from Alex" badge can show a face.
-- ---------------------------------------------------------------------------

create policy avatars_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = (select auth.uid()::text)
      or exists (
        select 1
        from public.closet_members mine
        join public.closet_members theirs on theirs.closet_id = mine.closet_id
        where mine.user_id   = (select auth.uid())
          and mine.status    = 'accepted'
          and theirs.status  = 'accepted'
          and theirs.user_id = public.safe_uuid((storage.foldername(name))[1])
      )
    )
  );

create policy avatars_write_self on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy avatars_update_self on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy avatars_delete_self on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
