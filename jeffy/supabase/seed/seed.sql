-- Jeffy seed data.
--
-- Gives a fresh project enough of a closet to exercise outfit suggestions,
-- filtering and the stats screen without photographing forty things by hand.
--
--   psql "$DATABASE_URL" -v owner_id=<uuid> -f supabase/seed/seed.sql
--
-- owner_id must be a real auth.users id (sign up first, then copy it from the
-- dashboard). Items are seeded WITHOUT photos: Storage objects cannot be
-- created from SQL, so the grid shows placeholder tiles until you add photos
-- through the app.

\if :{?owner_id}
\else
  \echo 'ERROR: pass -v owner_id=<uuid>'
  \quit 1
\endif

-- psql does not interpolate :variables inside a dollar-quoted body, so the
-- owner id is handed over as a session setting instead.
select set_config('jeffy.seed_owner', :'owner_id', false);

do $$
declare
  v_owner  uuid := current_setting('jeffy.seed_owner')::uuid;
  v_closet uuid;
begin
  select id into v_closet from public.closets where owner_id = v_owner;
  if v_closet is null then
    raise exception 'No closet for %. Sign that user up first.', v_owner;
  end if;

  delete from public.items where closet_id = v_closet;

  insert into public.items
    (closet_id, created_by, name, category, subcategory, colors, pattern, material,
     formality, seasons, brand, size, purchase_price_cents, tags, is_favorite)
  values
    (v_closet, v_owner, 'Navy oxford shirt', 'top', 'Oxford', array['navy'], 'solid', 'cotton',
     4, array['spring','fall','winter']::public.season[], 'Uniqlo', 'M', 3990, array['work'], true),
    (v_closet, v_owner, 'White oxford shirt', 'top', 'Oxford', array['white'], 'solid', 'cotton',
     4, array['spring','summer','fall','winter']::public.season[], 'Uniqlo', 'M', 3990, array['work'], false),
    (v_closet, v_owner, 'Grey crewneck tee', 'top', 'T-shirt', array['grey'], 'solid', 'cotton',
     2, array['spring','summer','fall']::public.season[], null, 'M', 1500, array['everyday'], false),
    (v_closet, v_owner, 'Olive overshirt', 'top', 'Overshirt', array['olive'], 'solid', 'cotton twill',
     3, array['fall','spring']::public.season[], null, 'M', 6500, array[]::text[], false),
    (v_closet, v_owner, 'Black slim jeans', 'bottom', 'Jeans', array['black'], 'solid', 'denim',
     3, array['fall','winter','spring']::public.season[], 'Levi''s', '32x30', 7900, array['everyday'], true),
    (v_closet, v_owner, 'Stone chinos', 'bottom', 'Chinos', array['stone'], 'solid', 'cotton',
     4, array['spring','summer']::public.season[], null, '32x30', 5500, array['work'], false),
    (v_closet, v_owner, 'Charcoal trousers', 'bottom', 'Trousers', array['charcoal'], 'solid', 'wool blend',
     5, array['fall','winter']::public.season[], null, '32x30', 12000, array['formal'], false),
    (v_closet, v_owner, 'Navy gym shorts', 'bottom', 'Shorts', array['navy'], 'solid', 'polyester',
     1, array['summer']::public.season[], null, 'M', 2500, array['gym'], false),
    (v_closet, v_owner, 'White leather sneakers', 'shoes', 'Sneakers', array['white'], 'solid', 'leather',
     3, array[]::public.season[], null, '10.5', 9500, array['everyday'], true),
    (v_closet, v_owner, 'Brown chelsea boots', 'shoes', 'Boots', array['brown'], 'solid', 'suede',
     4, array['fall','winter']::public.season[], null, '10.5', 16000, array[]::text[], false),
    (v_closet, v_owner, 'Black derbies', 'shoes', 'Dress shoes', array['black'], 'solid', 'leather',
     5, array[]::public.season[], null, '10.5', 18000, array['formal'], false),
    (v_closet, v_owner, 'Navy quilted jacket', 'outerwear', 'Quilted jacket', array['navy'], 'solid', 'nylon',
     3, array['fall','spring']::public.season[], null, 'M', 14000, array[]::text[], false),
    (v_closet, v_owner, 'Charcoal wool coat', 'outerwear', 'Overcoat', array['charcoal'], 'solid', 'wool',
     5, array['winter']::public.season[], null, 'M', 29000, array['formal'], false),
    (v_closet, v_owner, 'Brown leather belt', 'accessory', 'Belt', array['brown'], 'solid', 'leather',
     4, array[]::public.season[], null, '34', 4500, array[]::text[], false),
    (v_closet, v_owner, 'Black leather belt', 'accessory', 'Belt', array['black'], 'solid', 'leather',
     4, array[]::public.season[], null, '34', 4500, array[]::text[], false);

  -- Budget ranges, so the wishlist and store-find checks have something to
  -- compare against.
  insert into public.budgets (profile_id, category, min_cents, max_cents) values
    (v_owner, 'top', 2000, 8000),
    (v_owner, 'bottom', 4000, 12000),
    (v_owner, 'outerwear', 8000, 30000),
    (v_owner, 'shoes', 6000, 20000),
    (v_owner, 'accessory', 1500, 6000)
  on conflict (profile_id, category) do update
    set min_cents = excluded.min_cents, max_cents = excluded.max_cents;

  update public.profiles
     set monthly_budget_cents = coalesce(monthly_budget_cents, 15000),
         shirt_size  = coalesce(shirt_size, 'M'),
         pants_waist = coalesce(pants_waist, 32),
         pants_length = coalesce(pants_length, 30),
         shoe_size   = coalesce(shoe_size, 10.5),
         onboarded_at = coalesce(onboarded_at, now())
   where id = v_owner;

  -- A style rule with a machine form, so the outfit engine has a hard
  -- constraint to enforce rather than only prose for the model.
  insert into public.style_rules (closet_id, author_id, rule_text, strength, machine_rule)
  values (
    v_closet, v_owner, 'No brown belt with black shoes', 'hard',
    '{"type":"never_pair","a":{"kind":"color","color":"brown"},"b":{"kind":"color","color":"black"}}'::jsonb
  );

  -- A few wears, so "most worn" and the recent-wear cooldown do something.
  insert into public.wear_log (closet_id, item_id, worn_on)
  select v_closet, i.id, current_date - (n || ' days')::interval
  from public.items i
  cross join generate_series(1, 3) n
  where i.closet_id = v_closet and i.name in ('Grey crewneck tee', 'Black slim jeans')
  on conflict do nothing;

  raise notice 'Seeded % items for closet %',
    (select count(*) from public.items where closet_id = v_closet), v_closet;
end;
$$;
