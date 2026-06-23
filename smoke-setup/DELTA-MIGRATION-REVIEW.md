# DELTA MIGRATION REVIEW — Orders Driver RLS Migration
**Project:** Casabe Konnect (`exayifxbqduhsxmmsnxr`)  
**Date:** 2026-06-10  
**Reviewer:** Delta (QA/Debugger subagent)  
**File reviewed:** `~/casabe-v3/smoke-setup/orders-driver-rls-migration.sql`  
**Scope:** Read-only live DB + source code analysis. No mutations performed.

---

## ⚠️ VERDICT: NEEDS MORE WORK — Option C Confirmed

**Gap 1 Answer: OPTION C**

Dropping `orders_member_all` will break all HQ/Office INSERT, UPDATE, and DELETE operations. These writes go through the authenticated Supabase ANON_KEY JWT — not the service role — and no separate write policies exist.

---

## Evidence for Option C

### Query 1 — Full Live Orders Policy List

```
policyname              | cmd    | roles    | qual                              | with_check
------------------------+--------+----------+-----------------------------------+-----------------------------------
orders_member_all       | ALL    | {public} | is_member(tenant_id)              | is_member(tenant_id)
test_tenant_anon_insert | INSERT | {anon}   | —                                 | (tenant_id = 'test-tenant'::text)
test_tenant_anon_read   | SELECT | {public} | (tenant_id = 'test-tenant'::text) | —
test_tenant_anon_update | UPDATE | {anon}   | (tenant_id = 'test-tenant'::text) | (tenant_id = 'test-tenant'::text)
```

**Findings:**
- `orders_member_all` is the ONLY policy covering INSERT, UPDATE, and DELETE for authenticated users.
- `test_tenant_anon_*` policies are scoped to `tenant_id = 'test-tenant'` only — they do NOT cover `casabe-xpress`.
- **No separate HQ/Office INSERT, UPDATE, or DELETE policy exists.**

### Query 2 — Service Role Bypass Check

```
relrowsecurity | relforcerowsecurity
---------------+---------------------
t              | f
```

**Finding:**
- `relforcerowsecurity = false` ✅ — service role DOES bypass RLS by default in Postgres/Supabase.
- **However, the app does NOT use the service role key for writes.**

### Query 3 — Authenticated Client Used for All Writes

From `index.html` line 51:
```javascript
var _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

The entire app — including the `_db.upsert()` function used for all order mutations — uses the **ANON_KEY** client. There is no second client initialized with a service role key anywhere in the codebase.

`_db.upsert()` (line 23454+) calls:
```javascript
return _supabase
  .from(table)
  .upsert([row], { onConflict: "id,tenant_id" })
```

This is the authenticated JWT client. RLS applies fully. Once `orders_member_all` is dropped, HQ/Office users will receive RLS violations on any INSERT, UPDATE, or DELETE — **including all order creation, status changes, and saves.**

### Query 3b — Driver UPDATE via Authenticated JWT

Driver portal `onStatusChange` calls `changeStatus()` (line 25664+), which calls:
```javascript
_db.upsert("orders", id, updatedOrder);
```

This is the same `_db.upsert` using `SUPABASE_ANON_KEY`. Driver status updates (e.g. `in_warehouse`, `attempted`, `box_dropped_off`) are also going through the authenticated JWT and will be blocked if no UPDATE policy exists for drivers post-migration.

**Driver UPDATE policy is needed: YES**

---

## Gap Resolution — Required Policies Before Apply

The migration file already includes the correct commented-out policy templates in the `GAPS FOR DELTA REVIEW` section. Forge must uncomment/add these before Jefe approval:

### HQ/Office INSERT
```sql
CREATE POLICY orders_hq_office_insert ON public.orders
  FOR INSERT
  WITH CHECK (
    is_member(tenant_id)
    AND (get_user_role() = 'hq' OR get_user_role() = 'office')
  );
```

### HQ/Office UPDATE
```sql
CREATE POLICY orders_hq_office_update ON public.orders
  FOR UPDATE
  USING (
    is_member(tenant_id)
    AND (get_user_role() = 'hq' OR get_user_role() = 'office')
  )
  WITH CHECK (
    is_member(tenant_id)
    AND (get_user_role() = 'hq' OR get_user_role() = 'office')
  );
```

### HQ/Office DELETE
```sql
CREATE POLICY orders_hq_office_delete ON public.orders
  FOR DELETE
  USING (
    is_member(tenant_id)
    AND (get_user_role() = 'hq' OR get_user_role() = 'office')
  );
```

### Driver UPDATE (status changes — required)
Drivers update order status via `onStatusChange → changeStatus → _db.upsert` using the authenticated JWT.
```sql
CREATE POLICY orders_driver_update ON public.orders
  FOR UPDATE
  USING (
    is_member(tenant_id)
    AND get_user_role() = 'driver'
    AND can_access_order(id)
  )
  WITH CHECK (
    is_member(tenant_id)
    AND get_user_role() = 'driver'
    AND can_access_order(id)
  );
```

---

## Migration File Review

File: `~/casabe-v3/smoke-setup/orders-driver-rls-migration.sql`

### Function Name Verification

| Function | Status | Used in Migration |
|---|---|---|
| `is_member(tenant_id)` | ✅ live | ✅ used in both SELECT policies |
| `get_user_role()` | ✅ live (reads COALESCE(app_role, role)) | ✅ used in both SELECT policies |
| `can_access_order(id)` | ✅ live | ✅ used in `orders_driver_select` |
| `get_user_tenant_id()` | ❌ does NOT exist | ✅ correctly omitted |

### Policy Logic Review

**`orders_hq_office_select`:**
```sql
USING (
  is_member(tenant_id)
  AND (
    get_user_role() = 'hq'
    OR get_user_role() = 'office'
  )
)
```
- ✅ Correct. Tenant-scoped via `is_member(tenant_id)`. Role checked via `get_user_role()`.
- ✅ Matches pattern: `is_member(tenant_id) AND (get_user_role() = 'hq' OR get_user_role() = 'office')`

**`orders_driver_select`:**
```sql
USING (
  is_member(tenant_id)
  AND get_user_role() = 'driver'
  AND can_access_order(id)
)
```
- ✅ Correct. Tenant guard first, role guard second, function call last (fast-fail ordering).
- ✅ Matches pattern: `is_member(tenant_id) AND get_user_role() = 'driver' AND can_access_order(id)`
- ✅ `can_access_order()` confirmed to check `assignedDriverUserId = me.user_id::text` — UUID string match, not name match.

### Rollback SQL
- ✅ Present and correct.
- Restores `orders_member_all` as `FOR ALL` with `is_member(tenant_id)` USING and WITH CHECK — identical to current live policy.

### Verification Queries
- ✅ 5 verification queries present (policy list, can_access_order reference, orders_member_all absence, get_user_role existence, can_access_order existence).
- ✅ All queries are SELECT-only, safe to run post-apply.

### Syntax / Typo Check
- ✅ No typos or syntax errors detected.
- ✅ `DROP POLICY IF EXISTS` used safely (idempotent).
- ✅ `CREATE POLICY ... FOR SELECT USING (...)` correct form.
- ✅ All function calls use correct argument forms: `is_member(tenant_id)` (column ref), `get_user_role()` (no args), `can_access_order(id)` (column ref).

---

## Non-Blocking Cleanup Items

### `test_tenant_anon_*` policies
Three policies (`test_tenant_anon_insert`, `test_tenant_anon_read`, `test_tenant_anon_update`) allow unauthenticated access to `tenant_id = 'test-tenant'` data. They do not affect `casabe-xpress`. **Schedule removal before R1 launch** — not a blocker for this migration.

### `get_user_role()` COALESCE behavior
`get_user_role()` reads `COALESCE(app_role, role)`. Smoke accounts must have `app_role` populated (in addition to `role`) for the new SELECT policies to work correctly. Confirmed `create-smoke-accounts.js` writes both columns — no gap here.

---

## Summary for Iris

| Item | Result |
|---|---|
| **Gap 1 Answer** | **OPTION C** — HQ/Office writes use authenticated JWT (ANON_KEY). No service role path. No existing write policies. Dropping `orders_member_all` WILL break all order creation and updates. |
| **Migration Verdict** | **NEEDS MORE WORK** — 4 policies must be added before apply: `orders_hq_office_insert`, `orders_hq_office_update`, `orders_hq_office_delete`, `orders_driver_update`. |
| **Driver UPDATE policy needed** | **YES** — Driver status changes (mark picked up, mark delivered, mark attempted) all call `_db.upsert("orders", ...)` via the ANON_KEY authenticated client. Confirmed in source at lines 6478, 6628–6684. |
| **Remaining blockers** | (1) HQ/Office INSERT/UPDATE/DELETE policies missing. (2) Driver UPDATE policy missing. Both must be added to migration file before Jefe approval. |
| **Non-blockers** | `test_tenant_anon_*` policies — cleanup before R1, not before migration apply. |

---

## Recommended Action for Forge

Add the four policies listed above in the **Gap Resolution** section to `orders-driver-rls-migration.sql`. After adding them, the migration will be complete and ready for Jefe sign-off.

The migration file's existing SELECT policies (`orders_hq_office_select`, `orders_driver_select`) are **correct as written** — only the write policies are missing.

---

*Report generated by Delta — QA/Debugger subagent. Read-only queries only. No mutations performed.*
