# STAGED — Create "Joe Sr." Driver Account (CK-L1-011, Option B)

**Date:** 2026-06-29 · **Author:** FixForge · **Tier:** 3 (auth/identity) — **STAGED, NOT EXECUTED. Requires Jeffrey sign-off before any write.**
**Project:** app/orders `exayifxbqduhsxmmsnxr` · tenant `casabe-xpress`
**Decision of record:** Jeffrey chose Option B — create a real account for "Joe Sr." and link the 4 legacy orders to it.

## Why this is NOT a plain SQL insert
`members.user_id` must reference a real Supabase **Auth** user. Inserting directly into
`auth.users` via SQL is unsafe — it bypasses password hashing, identity rows, and the
GoTrue invariants Supabase relies on. The correct path is the **Supabase Admin API**
(`auth.admin.createUser`) to mint the auth user, THEN a single `members` INSERT, THEN
link the 4 orders. All three steps are gated on Jeffrey.

## Verified facts (read-only, 2026-06-29)
- Tenant `casabe-xpress` exists in `public.companies` (FK target satisfied). ✔
- `members.role` template for drivers: `role='driver'`, `app_role='driver'`, `active=true`.
  (Mirrors existing row: Smoke Driver A, user_id `4dd81b60-…`.)
- `members.app_role` CHECK allows `'driver'`. ✔
- No separate `drivers` table — the assign dropdown reads `members` where role/app_role=driver,
  so a members row is sufficient to make "Joe Sr." selectable going forward.
- 4 legacy orders to link (all tenant casabe-xpress, currently assignedDriverUserId empty):
  `CC202606018994`, `CC2026051807BD`, `CC20260518198B`, `CC20260628E749` (latter has
  legacy `assignedDriverId='joe-sr'`).

## STEP 1 (Jeffrey-run) — create the Auth user via Admin API
Run with the service-role key (NOT committed). Node example:
```js
// requires SUPABASE_URL + SERVICE_ROLE key for exayifxbqduhsxmmsnxr
import { createClient } from '@supabase/supabase-js';
const admin = createClient(process.env.SB_URL, process.env.SB_SERVICE_ROLE, { auth: { autoRefreshToken:false, persistSession:false } });
const { data, error } = await admin.auth.admin.createUser({
  email: 'joe.sr@casabe-xpress.internal',     // CONFIRM the email/domain you want
  email_confirm: true,
  password: '<set-a-strong-temp-password-or-use-invite>',
  user_metadata: { display_name: 'Joe Sr.', app_role: 'driver' }
});
if (error) throw error;
console.log('JOE_SR_UID=', data.user.id);   // capture this UUID for STEP 2 + 3
```
(Alternatively `admin.auth.admin.inviteUserByEmail(...)` if Joe should set his own password.)

## STEP 2 (Jeffrey-run) — insert the members row (substitute the captured UID)
```sql
-- :joe_uid = the UUID printed by STEP 1
INSERT INTO public.members (tenant_id, user_id, role, display_name, active, app_role)
VALUES ('casabe-xpress', :'joe_uid', 'driver', 'Joe Sr.', true, 'driver');
```

## STEP 3 (Jeffrey-run) — link the 4 legacy orders to the new UID
```sql
-- preview first:
SELECT id, data->>'assignedDriver' AS name, data->>'assignedDriverUserId' AS uid
  FROM public.orders
 WHERE tenant_id='casabe-xpress' AND data->>'assignedDriver'='Joe Sr.';
-- then backfill (only the 4 Joe Sr. orders):
UPDATE public.orders
   SET data = jsonb_set(data, '{assignedDriverUserId}', to_jsonb(:'joe_uid'::text), true),
       updated_at = now()
 WHERE tenant_id='casabe-xpress' AND data->>'assignedDriver'='Joe Sr.';
-- expect: UPDATE 4
```

## VERIFY (post-apply)
```sql
SELECT id, data->>'assignedDriver' AS name, data->>'assignedDriverUserId' AS uid
  FROM public.orders WHERE tenant_id='casabe-xpress' AND data->>'assignedDriver'='Joe Sr.';
-- all 4 rows should now show uid = JOE_SR_UID
```
Then log in as Joe Sr. (or impersonate) and confirm the driver portal shows exactly those
4 orders (RLS `can_access_order` now matches assignedDriverUserId=auth.uid()).

## ROLLBACK
```sql
-- unlink orders:
UPDATE public.orders SET data = data - 'assignedDriverUserId'
 WHERE tenant_id='casabe-xpress' AND data->>'assignedDriver'='Joe Sr.';
-- remove member row:
DELETE FROM public.members WHERE tenant_id='casabe-xpress' AND display_name='Joe Sr.' AND user_id=:'joe_uid';
-- delete auth user (Admin API):
--   await admin.auth.admin.deleteUser('<JOE_SR_UID>');
```

## OPEN QUESTIONS FOR JEFFREY (confirm before running)
1. **Email/domain** for Joe's account — `joe.sr@casabe-xpress.internal`, or a real address?
2. **Password vs invite** — set a temp password, or send an invite email so he sets his own?
3. Any **driver_id / office_id** linkage needed, or leave NULL like the smoke drivers?

## What I did NOT do
- No Auth user created, no members insert, no order update. Read-only inspection + this staged doc only.
