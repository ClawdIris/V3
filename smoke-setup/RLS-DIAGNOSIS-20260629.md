# RLS Diagnosis — CK-L1-022 / CK-L1-023 (orders tenant + driver isolation)

**Date:** 2026-06-29 · **Investigator:** FixForge · **Tier:** 3 (auth/RLS) — **DIAGNOSE-ONLY, no DB writes**
**Access:** read-only `psql` via `.env.local DATABASE_URL` (app project `exayifxbqduhsxmmsnxr`).

## Headline: RLS is ALREADY correctly wired. The old "blocker" note is stale.
The MEMORY note said `can_access_order()` "must be wired into orders SELECT policy" and that a
broad `orders_member_all` read "must be scoped." **Both are already done on live.** Current state:

### `orders` policies (all PERMISSIVE, roles = PUBLIC, but gated by is_member/role fns)
| policy | cmd | predicate |
|---|---|---|
| orders_driver_select | SELECT | `is_member(tenant_id) AND get_user_role()='driver' AND can_access_order(id)` |
| orders_hq_office_select | SELECT | `is_member(tenant_id) AND (get_user_role() IN ('hq','office'))` |
| orders_hq_office_insert | INSERT | (hq/office) |
| orders_hq_office_update | UPDATE | `is_member(tenant_id) AND (hq/office)` |
| orders_hq_office_delete | DELETE | `is_member(tenant_id) AND (hq/office)` |

- **No `orders_member_all` policy exists** — the broad read is already gone.
- **`can_access_order(text)`** is SECURITY DEFINER, resolves the caller's member row, and returns true
  only when `me.tenant_id = order.tenant_id` AND (hq/office) OR (driver AND
  `order.data->>'assignedDriverUserId' = me.user_id`). Correct driver-isolation logic.
- RLS is ENABLED on both `orders` and `members`. No anon/public bypass policy.

### CK-L1-022 (driver sees ONLY their own stops): **ENFORCED at DB.**
A driver's SELECT is filtered by `can_access_order(id)` → only orders whose
`assignedDriverUserId` equals their `auth.uid()`. Verified the predicate path.

### CK-L1-023 (office sees own orders; HQ sees all in tenant): **ENFORCED at DB.**
Both scoped by `is_member(tenant_id)`. (Note: this is tenant-scoped; "office sees only ITS OWN
orders" within a tenant — i.e. office-level sub-scoping below tenant — is NOT separately enforced.
If office-vs-office isolation within one tenant is required, that's a NEW policy decision — flag
for Jeffrey. Current behavior: HQ and office both see all orders in their tenant.)

## The ONE real gap (data, not policy) — folds in CK-L1-011
- **0 of 248 casabe-xpress orders have `assignedDriverUserId` set.** Drivers are assigned by NAME
  (`data->>'assignedDriver'`, e.g. "Joe Sr." on 4 orders) but the RLS-authoritative field
  `assignedDriverUserId` is empty everywhere.
- **Consequence:** with isolation correctly enforced, a real driver login currently sees **ZERO
  orders** — not because RLS is broken, but because no order is linked to a driver's user id.
- This is why CK-L1-022 "cannot verify: driver auth times out; no orders seeded" — two causes:
  (1) the tenant-slug keystone (now fixed), and (2) no driver-linked orders to see.

## Recommended next steps (ALL Jeffrey-gated — no autonomous apply)
1. **No RLS migration needed.** The policies are correct. Update the stale MEMORY/blocker note to
   reflect that `can_access_order` is already wired and `orders_member_all` is already gone.
2. **Assignment write-path gap (app, Tier 2/3 boundary):** when HQ/office assigns a driver, the
   save path should populate `assignedDriverUserId` (the driver's auth uid from the members/drivers
   table), not just the display name. Code already READS `assignedDriverUserId` (index.html 3250,
   4035, 6045) and warns if a driver has no linked account — but the existing 248 orders predate
   that and carry name-only. Decision for Jeffrey: (a) backfill `assignedDriverUserId` on existing
   orders by matching driver name→members row (DB write, Tier 3), and/or (b) confirm the current
   assign UI writes the uid going forward.
3. **Office sub-scoping:** confirm whether office-vs-office isolation within a tenant is required.
   If yes, that's a new policy (Tier 3) to author + stage.

## What I did NOT do
- No DB writes. No policy changes. No backfill. All read-only inspection + this staged writeup.
