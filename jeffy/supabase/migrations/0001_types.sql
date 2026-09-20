-- Jeffy 0001: extensions, enum types, and the updated_at trigger.
--
-- The RLS helper functions live in 0002, immediately after the tables they
-- read: they are `language sql`, whose body Postgres parses at CREATE time,
-- so they cannot be declared before closet_members exists.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.item_category as enum ('top', 'bottom', 'outerwear', 'shoes', 'accessory');
create type public.season          as enum ('spring', 'summer', 'fall', 'winter');
create type public.closet_role     as enum ('owner', 'stylist');
create type public.member_status   as enum ('pending', 'accepted', 'revoked');
create type public.item_status     as enum ('active', 'donated');
create type public.outfit_source   as enum ('ai', 'stylist', 'owner');
create type public.outfit_status   as enum ('suggested', 'saved', 'worn', 'archived');
create type public.feedback_verdict as enum ('approved', 'rejected', 'edited', 'comment');
create type public.rule_strength   as enum ('hard', 'soft');
create type public.wishlist_source as enum ('owner', 'stylist', 'ai', 'inspiration');
create type public.wishlist_status as enum ('open', 'purchased', 'dismissed');
create type public.piece_match     as enum ('have', 'close', 'missing');
create type public.look_status     as enum ('pending', 'analyzing', 'analyzed', 'failed', 'saved');
create type public.attachment_kind as enum ('item', 'outfit', 'wishlist', 'inspiration', 'photo');
create type public.price_tier      as enum ('budget', 'mid', 'premium');

comment on type public.item_status is
  'active or donated. Laundry state is items.is_dirty, which is orthogonal.';

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
