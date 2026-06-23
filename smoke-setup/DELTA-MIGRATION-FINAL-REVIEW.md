# DELTA — Migration Final Review
**File:** `orders-driver-rls-migration.sql`
**Reviewer:** Delta (QA/Debugger)
**Date:** 2026-06-10
**Status:** ✅ APPROVED — send to Jefe for sign-off

---

## Policy Correctness

### 1. `orders_hq_office_select` (Lines 73–81) ✅ CORRECT

```sql
CREATE POLICY orders_hq_office_select ON public.orders
  FOR SELECT
  USING (
    is_member(tenant_id)
    AND (
      get_user_role() = 'hq'
      OR get_user_role() = 'office'
    )
  );
```

- **Tenant isolation:** `is_member(tenant_id)` ✅
- **Role check:** `get_user_role() = 'hq' OR get_user_role() = 'office'` ✅
- **Command:** `FOR SELECT` ✅
- **USING clause only (no WITH CHECK needed for SELECT):** ✅
- No `USING (true)`, no unscoped access ✅

---

### 2. `orders_driver_select` (Lines 96–102) ✅ CORRECT

```sql
CREATE POLICY orders_driver_select ON public.orders
  FOR SELECT
  USING (
    is_member(tenant_id)
    AND get_user_role() = 'driver'
    AND can_access_order(id)
  );
```

- **Tenant isolation:** `is_member(tenant_id)` as fast short-circuit guard ✅
- **Role check:** `get_user_role() = 'driver'` ✅
- **Order-level scope:** `can_access_order(id)` ✅ (internally checks assignedDriverUserId = auth.uid() + tenant match)
- **Command:** `FOR SELECT` ✅
- **USING clause only (no WITH CHECK needed for SELECT):** ✅

---

### 3. `orders_hq_office_insert` (Lines 111–116) ✅ CORRECT

```sql
CREATE POLICY orders_hq_office_insert ON public.orders
  FOR INSERT
  WITH CHECK (
    is_member(tenant_id)
    AND (get_user_role() = 'hq' OR get_user_role() = 'office')
  );
```

- **Tenant isolation:** `is_member(tenant_id)` ✅
- **Role check:** `hq OR office` ✅
- **Command:** `FOR INSERT` ✅
- **WITH CHECK (not USING — correct for INSERT):** ✅
- No USING clause on INSERT is correct PostgreSQL behavior ✅

---

### 4. `orders_hq_office_update` (Lines 124–133) ✅ CORRECT

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

- **Both USING and WITH CHECK present:** ✅
- **USING** (which rows can be targeted): `is_member + hq/office` ✅
- **WITH CHECK** (what the row can look like post-update): `is_member + hq/office` ✅
- Symmetric — prevents privilege escalation via UPDATE ✅

---

### 5. `orders_hq_office_delete` (Lines 141–146) ✅ CORRECT

```sql
CREATE POLICY orders_hq_office_delete ON public.orders
  FOR DELETE
  USING (
    is_member(tenant_id)
    AND (get_user_role() = 'hq' OR get_user_role() = 'office')
  );
```

- **Tenant isolation:** `is_member(tenant_id)` ✅
- **Role check:** `hq OR office` ✅
- **Command:** `FOR DELETE` ✅
- **USING only (no WITH CHECK needed for DELETE):** ✅

---

### 6. `orders_driver_update` (Lines 156–167) ✅ CORRECT

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

- **Both USING and WITH CHECK present:** ✅
- **USING** (which rows driver can target): `is_member + driver role + can_access_order(id)` ✅
- **WITH CHECK** (post-update row state): same conditions ✅ — prevents a driver from updating a row in a way that would change their own eligibility criteria
- **No unscoped tenant access:** `can_access_order(id)` internally enforces tenant isolation + assignment ✅

---

## Coverage Check

| Check | Result |
|-------|--------|
| `DROP POLICY IF EXISTS orders_member_all` comes before all CREATEs (line 61) | ✅ |
| No policy uses `USING (true)` | ✅ |
| No unscoped tenant access | ✅ |
| No anon access left open for casabe-xpress data | ✅ |
| `test_tenant_anon_*` cleanup note at line 1 | ✅ |

---

## Rollback Block (Lines 176–186) ✅ CORRECT

All 6 new policies have `DROP POLICY IF EXISTS` statements:

```sql
-- DROP POLICY IF EXISTS orders_hq_office_select ON public.orders;   ✅ line 177
-- DROP POLICY IF EXISTS orders_driver_select ON public.orders;       ✅ line 178
-- DROP POLICY IF EXISTS orders_hq_office_insert ON public.orders;    ✅ line 179
-- DROP POLICY IF EXISTS orders_hq_office_update ON public.orders;    ✅ line 180
-- DROP POLICY IF EXISTS orders_hq_office_delete ON public.orders;    ✅ line 181
-- DROP POLICY IF EXISTS orders_driver_update ON public.orders;       ✅ line 182
```

- **6/6 DROP IF EXISTS present** ✅
- Rollback restores `orders_member_all` as `FOR ALL` with `USING (is_member(tenant_id))` and `WITH CHECK (is_member(tenant_id))` — matches original policy pattern ✅
- Rollback is commented out (safe, won't accidentally run) ✅

---

## Verification Queries

| Query | Present | Correct |
|-------|---------|---------|
| Verify 1: Full policy list on `orders` table | ✅ line 196–199 | ✅ |
| Verify 2: `can_access_order` reference check (`qual LIKE '%can_access_order%'`) | ✅ lines 203–207 | ✅ |
| Verify 3: Confirm `orders_member_all` is gone (expects 0 rows) | ✅ lines 210–213 | ✅ |
| Verify 4: `get_user_role()` function exists | ✅ lines 217–220 | ✅ |
| Verify 5: `can_access_order()` function exists | ✅ lines 224–227 | ✅ |
| **Verify 6: 6-policy name check (expects 6 rows)** | ✅ lines 230–241 | ✅ |

All 6 policy names are correctly listed in Verify 6. ✅

> **Note on Verify 2:** The query checks for `can_access_order` in `qual` (USING clause). It will now match **two** policies — `orders_driver_select` AND `orders_driver_update`. The comment says "Expected: 1 row" (written when only the SELECT policy existed). This is a **stale comment only** — the query itself is still valid and the result of 2 rows is correct behavior. No SQL change needed.

---

## Logic Gaps — Driver INSERT / DELETE

**Does a driver need INSERT?** → **NO** ✅ intentional by design
- HQ/Office creates orders. `orders_hq_office_insert` covers this.
- No driver INSERT policy exists, which is correct. Drivers receive orders, they do not originate them.

**Does a driver need DELETE?** → **NO** ✅ intentional by design
- Order deletion is an administrative action. HQ/Office handles it via `orders_hq_office_delete`.
- No driver DELETE policy is correct.

**Driver UPDATE only — is this complete?** → **YES** ✅
- `orders_driver_update` covers status change use case (onStatusChange → changeStatus → `_db.upsert`).
- Scoped to assigned orders via `can_access_order(id)` in both USING and WITH CHECK.

---

## Stale Section: "GAPS FOR DELTA REVIEW" (Lines 244–307)

⚠️ **Informational note for Jefe:** The `GAPS FOR DELTA REVIEW` section at the bottom of the file (lines 244–307) was written for the v1 draft of this migration, when INSERT/UPDATE/DELETE policies had not yet been added. The actual migration now includes all 4 write policies (Steps 4–7). The gap section is **now stale** — it accurately describes a concern that was subsequently resolved in the same file.

**No action required** — the commented-out "recommended pattern" SQL in the gaps section matches exactly what was implemented in Steps 4–7. The section is historical context only.

Recommendation: This section can optionally be pruned or annotated before archiving, but it does **not** affect correctness and does **not** block approval.

---

## Summary Scorecard

| Policy | Status |
|--------|--------|
| `orders_hq_office_select` | ✅ CORRECT |
| `orders_driver_select` | ✅ CORRECT |
| `orders_hq_office_insert` | ✅ CORRECT |
| `orders_hq_office_update` | ✅ CORRECT |
| `orders_hq_office_delete` | ✅ CORRECT |
| `orders_driver_update` | ✅ CORRECT |
| DROP before CREATE | ✅ |
| No `USING (true)` / no unscoped access | ✅ |
| No anon access for casabe-xpress | ✅ |
| `test_tenant_anon_*` cleanup note | ✅ |
| Rollback: 6/6 DROP IF EXISTS | ✅ |
| Rollback: restores `orders_member_all` correctly | ✅ |
| 6-policy check query (Verify 6) | ✅ |
| `can_access_order` reference query | ✅ |
| Driver no INSERT (intentional) | ✅ |
| Driver no DELETE (intentional) | ✅ |

---

## ✅ FINAL VERDICT: APPROVED — send to Jefe for sign-off

All 6 policies are syntactically and semantically correct. Coverage is complete. Rollback is sound. Verification queries are present. The driver INSERT/DELETE omission is intentional and correct by design.

**One minor stale-comment note** (Verify 2 expected-row count, gaps section) — documentation only, no SQL changes needed.

**This migration is ready for Jefe approval and apply.**

---

*Delta — QA/Debugger sign-off 2026-06-10*
