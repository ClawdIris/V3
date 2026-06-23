# Smoke Order Creation Blocker

## Status

**BLOCKED:** Do not create SMOKE-001 or SMOKE-002 yet.

## Live Finding

Logged into `https://casabe-connect.netlify.app/?debug=1` as Smoke HQ and opened
the New Order form. The Assigned Driver dropdown contains only:

- `Joe Sr.`

It does not contain `Smoke Driver A`.

## Root Cause

The smoke-account script creates `auth.users` and `public.members` records.
However, the New Order driver dropdown reads:

```text
tenant_settings.main.data.drivers -> tenant.drivers -> tenantDrivers
```

It does not currently load authenticated driver members or a relational drivers
table. Therefore, the newly created Smoke Driver A account cannot be selected,
and the order form cannot dual-write its UUID into `assignedDriverUserId`.

Creating orders assigned to Joe Sr. or leaving them unassigned would not test
the R1 requirement and would produce a misleading smoke result.

## Forge Fix

Choose one canonical driver source and align all driver selectors to it.

Recommended platform fix:

1. Load active driver identities from the authenticated tenant's driver/member
   source, including display name and auth user UUID.
2. Merge or replace legacy `tenant_settings.main.data.drivers` entries.
3. Ensure every selectable driver has a non-empty UUID.
4. Make the New Order form dual-write:
   - `assignedDriver`: display name
   - `assignedDriverUserId`: auth user UUID
5. Do not allow UUID-less driver assignments for new orders.

Temporary smoke-only patch is acceptable only if it adds Smoke Driver A to the
same canonical source with the exact UUID created by `create-smoke-accounts.js`.

## Delta Acceptance Test

1. Log in as Smoke HQ.
2. Open New Order.
3. Confirm `Smoke Driver A` appears in Assigned Driver.
4. Create a temporary draft/order assigned to Smoke Driver A.
5. Verify the saved order has:
   - `data.assignedDriver = "Smoke Driver A"`
   - `data.assignedDriverUserId = <Smoke Driver A auth UUID>`
6. Verify Driver A can read it and Driver B cannot.
7. Remove the temporary verification order.
8. Then create SMOKE-001 and SMOKE-002 through the production UI.

