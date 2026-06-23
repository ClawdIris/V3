# Delta Preflight Checklist

> ⚠️  **SECURITY: Run queries MANUALLY in a trusted local terminal or the Supabase SQL Editor only.**  
> Do NOT execute via OpenClaw, Codex, or any agent session.  
> Credentials visible in this flow — agent sessions retain output in logs.  
> After running: immediately save any retrieved credentials to your password manager and clear your terminal history.
**Project:** Casabe Konnect  
**Scope:** Smoke test environment readiness verification  
**Who runs this:** Delta (DBA / DB reviewer)  
**When:** Before `create-smoke-accounts.js` is executed and before any orders are placed  
**Purpose:** Ensure live DB schema matches assumptions baked into the account-creation script

> All queries below are **read-only**. Run them in the Supabase SQL Editor  
> (project `exayifxbqduhsxmmsnxr`) or via `psql` with the DB URL from `.env.local`.  
> **Do NOT modify anything during preflight.**

---

## ✅ Checklist

### 1. Verify `members` table constraints (NOT NULL / UNIQUE)

```sql
SELECT
  column_name,
  is_nullable,
  column_default,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'members'
ORDER BY ordinal_position;
```

**What to record:**
- Which columns are `NOT NULL`?
- Does `office_id` allow NULL? (Required for HQ / Driver rows that have no office)
- Does `tenant_id` allow NULL?
- Is there a UNIQUE constraint on `(user_id, tenant_id)`? If so, the script cannot create the same user twice.

```sql
SELECT
  conname AS constraint_name,
  contype AS constraint_type,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.members'::regclass
ORDER BY contype;
```

**Expected / blockers:**
- `user_id` → should be NOT NULL (script provides this from `createUser()`)
- `tenant_id` → should be NOT NULL (script uses `TENANT_ID` env var)
- `active` → confirm column exists; script sets it to `true`
- `display_name` → confirm column exists; script sets it

---

### 2. Verify `app_role` vs `role` column name

The login flow in `index.html` (line 25022) reads:
```
members.select("tenant_id, role, display_name")
```
But `get_user_role()` SQL function uses:
```sql
SELECT COALESCE(app_role, role) INTO user_role FROM public.members ...
```

**Verification query:**
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'members'
  AND column_name IN ('role', 'app_role');
```

**Decision matrix:**
| Columns found | `create-smoke-accounts.js` action |
|---|---|
| Only `role` exists | Leave `ROLE_COLUMN=role` (default — no change needed) |
| Only `app_role` exists | Set env var `SMOKE_ROLE_COLUMN=app_role` before running |
| Both exist | Set `SMOKE_ROLE_COLUMN=app_role`; confirm which RLS policies actually read |

**Note:** RLS policies in `SECURITY-FIX-PATCH.sql` use `COALESCE(app_role, role)`, so writing to `role` alone may be sufficient — but confirm live policy definitions in step 4.

---

### 3. Verify `can_access_order()` function exists

This function is referenced by the Driver portal (index.html ~line 4014) for order visibility. If it doesn't exist, driver RLS will fail silently or fall back to the `assignedDriver` text field.

```sql
SELECT
  routine_name,
  routine_type,
  security_type,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'can_access_order';
```

**If the function does NOT exist:**
- **Status: ❌ BLOCKED** — do not proceed with authenticated smoke testing
- Missing server-side driver RLS enforcement blocks R1 release approval. Do not proceed with authenticated smoke until this function is confirmed live or Jefe explicitly accepts the risk in writing.
- Do NOT create this function during preflight — flag it as a blocker for Jefe immediately

**If the function EXISTS, record its signature and what column it checks.**  
Expected: it reads `orders.assignedDriverUserId` and compares to `auth.uid()`.

---

### 4. Verify orders RLS policies — what columns driver visibility checks

```sql
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'orders'
ORDER BY policyname;
```

**What to record:**
- Does a driver SELECT policy exist?
- Does it reference `assignedDriverUserId` or `assignedDriver` (text)?
- Does it call `can_access_order()`?
- Does it reference `members` table for role resolution?

**Blocker:** If no orders SELECT policy exists for drivers, the Driver portal will  
show zero orders regardless of assignment. Flag this for Jefe before smoke test.

---

### 5. Confirm `payment` JSONB column on orders — shape and existence

The Driver Route page (index.html ~line 6368) reads:
```js
o.payment.method === "cash"
o.payment.status !== "paid"
```
And the receipt renderer (line 5124) reads:
```js
o.payment.amount, o.payment.paid
```

```sql
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'orders'
  AND column_name = 'data';
```

**Payment is stored inside the `data` JSONB column, not as a top-level column.** Use this query to inspect real payment shapes:

```sql
SELECT id, data->'payment' AS payment_shape
FROM orders
WHERE data->'payment' IS NOT NULL
LIMIT 3;
```

**Expected shape (from seed data in index.html):**
```json
{
  "status":  "unpaid" | "deposit" | "paid",
  "method":  "cash" | "zelle" | "card" | ...,
  "amount":  <float>,
  "paid":    <float>
}
```

**Blocker:** If `data->'payment'` returns nothing for any existing orders, the Driver  
page will crash when rendering those orders. HQ-created orders must produce a valid  
`payment` object nested inside `data`. Confirm the HQ order creation form populates  
all four subfields and writes them under `data.payment`.

---

### 6. Confirm `office_id` column on orders

```sql
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'orders'
  AND column_name = 'office_id';
```

**Expected:** Column exists, type `uuid`, nullable (orders may not be office-routed).

**Also check** that the HQ order creation form in index.html (line 3154) dual-writes  
`office_id` when an office is selected. Confirm this in the UI during HQ order creation.

---

### 7. Get a real `office_id` from live data (or confirm sentinel)

```sql
SELECT id, name, city
FROM offices
ORDER BY created_at
LIMIT 10;
```

**Decision:**
- If rows exist → copy a real `id` UUID, pass it as `SMOKE_OFFICE_ID` env var when running the script
- If table is **empty** → the sentinel approach applies: `office_id = NULL` in members row; flag this as a gap and document that Office account RLS will not scope correctly until an office is created

**If offices exist but belong to a specific tenant:**
```sql
SELECT id, name, tenant_id
FROM offices
WHERE tenant_id = 'casabe-xpress'   -- replace with real tenant_id
ORDER BY created_at
LIMIT 10;
```

---

## 📋 Preflight Sign-Off

Complete this table and send to Forge before script is run:

| # | Check | Status | Notes |
|---|---|---|---|
| 1 | `members` NOT NULL / UNIQUE constraints | ⬜ PENDING | |
| 2 | `app_role` vs `role` column name | ⬜ PENDING | |
| 3 | `can_access_order()` exists | ⬜ PENDING | |
| 4 | Orders RLS policies (driver visibility) | ⬜ PENDING | |
| 5 | `payment` JSONB column shape | ⬜ PENDING | |
| 6 | `office_id` column on orders | ⬜ PENDING | |
| 7 | Real `office_id` value for Office account | ⬜ PENDING | |

**Status values:** ✅ CONFIRMED | ⚠️ GAP (document) | ❌ BLOCKER (do not proceed)

---

## 🔧 Environment Setup for Script Run

After preflight sign-off, Forge runs the script with:

```bash
export SUPABASE_URL=https://exayifxbqduhsxmmsnxr.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard — Settings > API>
export SMOKE_TENANT_ID=casabe-xpress          # confirm real value from DB
export SMOKE_OFFICE_ID=<UUID from step 7>     # real offices.id value
export SMOKE_ROLE_COLUMN=role                 # or 'app_role' per step 2
node smoke-setup/create-smoke-accounts.js
```

> Passwords print once to stdout. Copy to a password manager immediately.  
> Do not redirect stdout to a file.
