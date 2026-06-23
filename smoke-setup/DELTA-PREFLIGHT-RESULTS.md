# DELTA PREFLIGHT RESULTS
**Project:** Casabe Konnect (`exayifxbqduhsxmmsnxr`)  
**Run date:** 2026-06-10  
**Run by:** Delta (QA/Debugger subagent)  
**Scope:** Read-only live DB preflight — 7-step checklist  
**Note:** All queries were SELECT-only. No mutations, no account creation, no credential output.

---

## Check 1 — members table structure: ✅ PASS

**Query run:** `information_schema.columns` WHERE `table_name = 'members'`

**Full column list:**

| column_name          | data_type                | is_nullable | column_default          |
|----------------------|--------------------------|-------------|-------------------------|
| id                   | uuid                     | NO          | gen_random_uuid()       |
| tenant_id            | text                     | NO          | —                       |
| user_id              | uuid                     | NO          | —                       |
| role                 | text                     | NO          | `'dispatcher'::text`    |
| display_name         | text                     | YES         | —                       |
| active               | boolean                  | NO          | `true`                  |
| created_at           | timestamp with time zone | NO          | `now()`                 |
| updated_at           | timestamp with time zone | NO          | `now()`                 |
| app_role             | text                     | YES         | —                       |
| office_id            | uuid                     | YES         | —                       |
| driver_id            | uuid                     | YES         | —                       |
| assigned_partner_id  | uuid                     | YES         | —                       |
| last_seen_at         | timestamp with time zone | YES         | —                       |
| metadata             | jsonb                    | NO          | `'{}'::jsonb`           |

**Confirmations:**
- ✅ `role` column exists — `text`, NOT NULL, default `'dispatcher'`
- ✅ `app_role` column exists — `text`, NULLABLE
- ✅ `user_id` column exists — `uuid`, NOT NULL
- ✅ `office_id` column exists — `uuid`, NULLABLE (correct — HQ/Driver rows have no office)
- ✅ `tenant_id` column exists — `text`, NOT NULL
- ✅ `active` column exists — `boolean`, NOT NULL, default `true`
- ✅ `display_name` column exists — `text`, NULLABLE

**Constraints (pg_constraint):**

| constraint_name                   | type | definition                                               |
|-----------------------------------|------|----------------------------------------------------------|
| members_app_role_check            | c    | CHECK app_role IN ('hq','office','driver','customer') OR NULL |
| members_user_id_fkey              | f    | FK → auth.users(id) ON DELETE CASCADE                   |
| members_assigned_partner_id_fkey  | f    | FK → partners(id) ON DELETE SET NULL                    |
| members_office_id_fkey            | f    | FK → offices(id) ON DELETE SET NULL                     |
| members_tenant_id_fkey            | f    | FK → companies(id) ON DELETE CASCADE                    |
| members_pkey                      | p    | PRIMARY KEY (id)                                        |
| **members_tenant_id_user_id_key** | u    | **UNIQUE (tenant_id, user_id)**                         |

- ✅ **UNIQUE constraint on (tenant_id, user_id) EXISTS** → `members_tenant_id_user_id_key`
- ⚠️ **Forge note:** The smoke script cannot re-insert the same user into the same tenant. If smoke accounts already exist from a prior run, the INSERT will fail with a unique violation. Check for existing smoke rows before running, or add upsert logic.

---

## Check 2 — members RLS policies: ⚠️ WARNING

**Query run:** `pg_policies WHERE tablename = 'members'`

**RLS enabled on members:** ✅ YES (`relrowsecurity = t`)

**Policies found:**

| policyname           | cmd    | qual                    | with_check              |
|----------------------|--------|-------------------------|-------------------------|
| members_admin_read   | SELECT | `is_admin(tenant_id)`   | —                       |
| members_admin_write  | ALL    | `is_admin(tenant_id)`   | `is_admin(tenant_id)`   |
| members_read_own     | SELECT | `(user_id = auth.uid())`| —                       |

**Confirmations:**
- ✅ RLS is enabled on members
- ✅ `members_read_own` — users can SELECT their own row (`user_id = auth.uid()`)
- ✅ Admin read/write policies exist

**⚠️ WARNINGS for Forge:**
1. **No Driver-specific policy** — Driver role uses `members_read_own` (SELECT own row only). This is acceptable since drivers only need to read their own membership. No gap for driver portal login.
2. **No HQ or Office named policy** — HQ/Office users also rely on `members_admin_read` (`is_admin()`) or `members_read_own`. Confirm `is_admin()` function covers both `hq` and `office` roles, or that `members_read_own` is sufficient for session init.
3. **The PREFLIGHT.md expected named policies** ("Driver role policy", "HQ policy", "Office policy") — these do NOT exist as separately named policies. The actual schema uses a simpler 3-policy model. This is not a hard blocker but Forge should confirm the smoke accounts can read their own membership rows post-login.

---

## Check 3 — can_access_order() function: ✅ PASS

**Query run:** `information_schema.routines WHERE routine_name = 'can_access_order'`

**Function EXISTS.** Full body:

```sql
WITH me AS (
  SELECT tenant_id, app_role, user_id
  FROM public.members
  WHERE user_id = auth.uid() AND active = true
  ORDER BY created_at LIMIT 1
),
target AS (
  SELECT tenant_id AS order_tenant,
         data->>'assignedDriverUserId' AS assigned_driver_user_id
  FROM public.orders WHERE id = p_order_id
)
SELECT COALESCE(
  (SELECT me.tenant_id = target.order_tenant
     AND (me.app_role IN ('hq', 'office')
       OR (me.app_role = 'driver'
           AND target.assigned_driver_user_id = me.user_id::text))
   FROM me, target),
  false
);
```

**Confirmations:**
- ✅ Function exists in `public` schema
- ✅ Checks `data->>'assignedDriverUserId'` (UUID string extracted from JSONB `data` column) against `me.user_id::text` — UUID match, NOT a name-string match
- ✅ Uses `app_role` for role check (not `role`)
- ✅ Tenant isolation: requires `me.tenant_id = target.order_tenant`
- ✅ HQ/Office get broad access; Driver is scoped to assigned orders only

**⚠️ Forge note — CRITICAL:** `can_access_order()` reads `app_role`, but the login flow (Check 5) writes to and reads from `role` column. If smoke Driver accounts are created with `role = 'driver'` but `app_role` is NULL, `can_access_order()` will return `false` for all orders (driver branch will never match because `me.app_role` will be NULL, not `'driver'`). **Forge must ensure `app_role = 'driver'` is written when creating the Driver smoke account.**

---

## Check 4 — orders RLS policies (driver SELECT): ⚠️ WARNING

**Query run:** `pg_policies WHERE tablename = 'orders'`

**RLS enabled on orders:** ✅ YES (`relrowsecurity = t`)

**Policies found:**

| policyname              | cmd    | roles    | qual                                     | with_check                               |
|-------------------------|--------|----------|------------------------------------------|------------------------------------------|
| orders_member_all       | ALL    | {public} | `is_member(tenant_id)`                   | `is_member(tenant_id)`                   |
| test_tenant_anon_insert | INSERT | {anon}   | —                                        | `(tenant_id = 'test-tenant'::text)`      |
| test_tenant_anon_read   | SELECT | {public} | `(tenant_id = 'test-tenant'::text)`      | —                                        |
| test_tenant_anon_update | UPDATE | {anon}   | `(tenant_id = 'test-tenant'::text)`      | `(tenant_id = 'test-tenant'::text)`      |

**is_member() function body:**
```sql
select exists (
  select 1 from members
  where tenant_id = p_tenant_id
    and user_id   = auth.uid()
    and active    = true
);
```

**Confirmations:**
- ✅ A SELECT policy for authenticated users exists: `orders_member_all` (covers ALL cmds including SELECT) using `is_member(tenant_id)`
- ⚠️ **Driver visibility is NOT scoped to assigned orders** — `is_member()` only checks that the user has an active membership in the tenant; it does NOT call `can_access_order()`. Any active member of a tenant can SELECT ANY order in that tenant. This means a Driver can see all orders, not just their assigned ones.
- ⚠️ **`can_access_order()` exists but is NOT referenced in any RLS policy.** It appears to be defined but unapplied to the `orders` table policies. The intended driver-scoped SELECT policy (filtering by `assignedDriverUserId`) has NOT been deployed.
- ⚠️ **`test_tenant_anon_read`** — there is a SELECT policy allowing `public` role to read orders where `tenant_id = 'test-tenant'`. This is a test tenant policy; confirm it does not expose `casabe-xpress` tenant data (it shouldn't, since it's tenant-scoped, but the existence of anon read policies should be reviewed pre-R1).
- ✅ **Anon is NOT able to read `casabe-xpress` orders** — `test_tenant_anon_read` is limited to `tenant_id = 'test-tenant'`

**⚠️ R1 Security Gap:** `can_access_order()` function exists but is not wired to any RLS policy. Drivers can currently read all orders in their tenant. For R1, a driver-scoped SELECT policy using `can_access_order()` should be added to `orders`. This is a data-leak risk but not a hard crash blocker for smoke testing (drivers will see too many orders, not zero).

---

## Check 5 — members.role vs app_role — which does login read?: ✅ PASS (with critical note)

**Source:** `~/casabe-v3/index.html` line 25022

**Exact query from source:**
```javascript
_supabase.from("members").select("tenant_id, role, display_name")
  .eq("user_id", user.id).eq("active", true)
```

**Full login session initialization (lines 25022–25038):**
```javascript
_supabase.from("members").select("tenant_id, role, display_name")
  .eq("user_id", user.id).eq("active", true)
  .then(function(mRes) {
    var rows = mRes.data || [];
    if (rows.length !== 1) { _supabase.auth.signOut(); setSession(false); return; }
    var membership = rows[0];
    var ROLE_MAP = { owner: "hq", admin: "hq", hq: "hq", dispatcher: "office", 
                     driver: "driver", finance: "office", readonly: "office" };
    var tenantId = membership.tenant_id;
    _db.init(tenantId);
    setSession({
      userId:      user.id,
      email:       user.email,
      roleKey:     ROLE_MAP[membership.role] || "office",
      displayName: membership.display_name || user.email,
      dbRole:      membership.role,
      tenantId:    tenantId
    });
  });
```

**Confirmations:**
- ✅ Login reads **`role`** column only — NOT `app_role`
- ✅ `role` column is NOT NULL with default `'dispatcher'` → login will always get a value
- ⚠️ **`app_role` is NOT read by the login flow** — the UI session is driven by `role`
- ⚠️ **CRITICAL MISMATCH:** `can_access_order()` reads `app_role`, but the login flow only writes/reads `role`. For driver portal order visibility to work correctly, **`app_role` must be populated**. If the smoke Driver account has `role = 'driver'` but `app_role = NULL`, the UI will show the Driver portal (role → ROLE_MAP → "driver") but the DB function will deny all order access.
- **Forge action required:** Smoke script must write BOTH `role = 'driver'` AND `app_role = 'driver'` for the Driver account.

---

## Check 6 — Real office_id from live data: ✅ PASS (with context)

**Query 1** (members with role='office' and office_id set): **0 rows** — no current members have a role='office' row with office_id populated.

**Query 2** (offices table):

| id (masked)                              | name                    | tenant_id      |
|------------------------------------------|-------------------------|----------------|
| `9838c5e1-****-****-****-************`   | Casabe Xpress NY        | casabe-xpress  |
| `be135363-****-****-****-************`   | Test Office             | casabe-test    |
| `0185fa77-****-****-****-************`   | Test Office (Smoke)     | test-tenant    |

**Confirmations:**
- ✅ Real office_id UUIDs exist in the live DB
- ✅ `casabe-xpress` tenant has one office: **Casabe Xpress NY** — use this UUID as `SMOKE_OFFICE_ID`
- Full UUID available in DB; Forge should retrieve it directly before running the script: `SELECT id FROM offices WHERE tenant_id = 'casabe-xpress' LIMIT 1`
- ⚠️ No existing members row uses `office_id` — the Office smoke account will be the first to populate this FK. Confirm FK constraint allows newly created members to reference this office (it should; FK is to `offices(id)` which now contains valid rows).

---

## Check 7 — Existing orders confirm data.payment shape: ✅ PASS

**Query run:** `SELECT id, data->'payment' FROM orders WHERE data->'payment' IS NOT NULL LIMIT 3`

**Results (3 real orders, PII masked):**

```json
// Order 1
{
  "paid": 200,
  "amount": 200,
  "method": "cash",
  "status": "paid",
  "commission": 0,
  "commissionRate": 0
}

// Order 2
{
  "paid": 260,
  "amount": 260,
  "method": "cash",
  "status": "paid",
  "commission": 50.0,
  "commissionRate": 17
}

// Order 3
{
  "paid": 0,
  "amount": 260,
  "method": "pending",
  "status": "unpaid",
  "commission": 0,
  "commissionRate": 0
}
```

**Confirmations:**
- ✅ `payment` is nested inside `data` JSONB — NOT a top-level column
- ✅ `method` field present (values seen: `"cash"`, `"pending"`)
- ✅ `status` field present (values seen: `"paid"`, `"unpaid"`)
- ✅ `amount` field present
- ✅ `paid` field present
- ✅ Extra fields: `commission`, `commissionRate` also present (Driver receipt renderer uses `amount` + `paid`; these extra fields won't cause crashes)
- ✅ Shape is consistent with index.html expectations (`o.payment.method`, `o.payment.status`, `o.payment.amount`, `o.payment.paid`)

---

## Final Verdict

| # | Check                                   | Status      | Notes                                                                 |
|---|-----------------------------------------|-------------|-----------------------------------------------------------------------|
| 1 | `members` NOT NULL / UNIQUE constraints | ✅ CONFIRMED | UNIQUE(tenant_id, user_id) exists. No re-insert of same user.        |
| 2 | RLS policies on members                 | ⚠️ WARNING  | No named Driver/HQ/Office policies — simple 3-policy model. Functional but different from expected. |
| 3 | `can_access_order()` exists             | ✅ CONFIRMED | Function exists, checks `assignedDriverUserId` UUID correctly. Reads `app_role`. |
| 4 | Orders RLS (driver visibility)          | ⚠️ WARNING  | `can_access_order()` NOT wired to RLS. Drivers see all tenant orders. Security gap, not a crash. |
| 5 | `role` vs `app_role` — login read       | ✅ CONFIRMED | Login reads `role` only. `app_role` drives `can_access_order()`. Both must be populated. |
| 6 | Real `office_id` for smoke Office acct  | ✅ CONFIRMED | Casabe Xpress NY office exists for `casabe-xpress` tenant.           |
| 7 | `data.payment` JSONB shape              | ✅ CONFIRMED | Nested in `data`, includes `method`, `status`, `amount`, `paid`.     |

---

## 🚦 OVERALL VERDICT

**NOT HARD-BLOCKED — BUT HOLDS APPLY**

No single check is a hard-block for running the smoke account creation script. However, Forge must acknowledge the following **before Jefe approves execution:**

### 🔴 Critical Action Required (Forge)

1. **Dual-write `app_role`:** The smoke Driver account MUST be created with BOTH `role = 'driver'` AND `app_role = 'driver'`. If `app_role` is NULL, `can_access_order()` will deny all order access for the driver and smoke testing will produce false failures.

2. **Similarly for HQ/Office accounts:** `app_role` should be set to `'hq'` or `'office'` respectively so `can_access_order()` grants them broad access. Confirm `create-smoke-accounts.js` writes `app_role` in addition to `role`.

### ⚠️ R1 Pre-release Issues (Jefe awareness)

3. **Orders RLS gap — driver over-exposure:** `can_access_order()` function is defined but NOT applied to any orders RLS policy. All authenticated tenant members can read all orders. For R1, a driver-scoped SELECT policy should be added. Recommend Jefe accepts or resolves this before go-live.

4. **Test tenant anon policies exist:** `test_tenant_anon_read/insert/update` policies allow unauthenticated access to `test-tenant` data. These are likely dev-only and should be removed or scoped before R1 production launch.

5. **Unique constraint on (tenant_id, user_id):** If smoke accounts were partially created in a previous run, the script will fail on duplicate insert. Forge should verify no stale smoke rows exist before running.

---

*Report generated by Delta — QA/Debugger subagent. Read-only queries only. No mutations performed.*
