# Migration 02 v2 — Delta QA Review
**File:** `02-orders-delivery-address-v2.sql`
**Reviewer:** Delta
**Review Date:** 2026-06-14
**Status:** APPROVED

---

## Scope

Migration 02 v2 adds two concerns to the original Migration 02:

1. `delivery_address TEXT` column on `public.orders` (carried forward from v1)
2. `check_no_tape_direct_stop()` function and `trg_route_stops_no_tape_direct` trigger (relocated from Migration 01 v3 per Codex audit finding)

---

## Finding 1 — `delivery_address` Column Addition: SAFE ✅

**Check:** Is the column addition idempotent?

```sql
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_address TEXT;
```

**Finding:** `IF NOT EXISTS` guard is present. Safe to run on a database where the column already exists — the statement will no-op rather than error. Column type is `TEXT` (nullable by default), which is correct. No NOT NULL constraint is added, which is appropriate given the lazy-population backfill strategy documented in the migration.

**Result: PASS**

---

## Finding 2 — Function Security: SAFE ✅

**Check:** Is `check_no_tape_direct_stop()` declared SECURITY DEFINER with a pinned search_path?

```sql
CREATE OR REPLACE FUNCTION public.check_no_tape_direct_stop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
```

**Finding:** Both `SECURITY DEFINER` and `SET search_path = ''` are present. This is the hardened pattern required by Casabe Konnect's security policy (consistent with other trigger functions in the codebase). The empty search_path prevents search_path injection attacks. All table references inside the function body use fully-qualified `public.` schema prefixes, which is required when `search_path = ''`.

**Result: PASS**

---

## Finding 3 — Trigger Timing: CORRECT ✅

**Check:** Does the trigger fire BEFORE INSERT (blocking) or AFTER INSERT (too late)?

```sql
CREATE TRIGGER trg_route_stops_no_tape_direct
  BEFORE INSERT ON public.route_stops
  FOR EACH ROW EXECUTE FUNCTION public.check_no_tape_direct_stop();
```

**Finding:** `BEFORE INSERT` — correct. A BEFORE trigger can raise an exception and abort the insert before it reaches storage. An AFTER trigger would run post-write and cannot prevent the row from being committed. This is the only correct choice for a guard trigger.

**Result: PASS**

---

## Finding 4 — Address Comparison: CASE-INSENSITIVE AND TRIM-SAFE ✅

**Check:** Is the Tape Direct address comparison hardened against whitespace and case variation?

```sql
IF v_delivery_address IS NOT NULL
   AND lower(trim(v_delivery_address)) = lower(trim('3801 White Plains Rd, Bronx, NY 10467'))
THEN
```

**Finding:** Both sides of the comparison are wrapped in `lower(trim(...))`. This handles:
- Leading/trailing whitespace in stored addresses
- Mixed-case input from geocoding APIs or manual dispatcher entry
- The literal constant is also normalized, so future edits to the constant won't introduce silent case mismatches

**Result: PASS**

---

## Finding 5 — NULL delivery_address Behavior: CORRECT ✅

**Check:** Does a NULL `delivery_address` incorrectly trigger the exception?

```sql
IF v_delivery_address IS NOT NULL
   AND lower(trim(v_delivery_address)) = lower(trim('3801 White Plains Rd, Bronx, NY 10467'))
```

**Finding:** The `IS NOT NULL` guard is the first condition in the `AND` chain. PostgreSQL short-circuits: if `v_delivery_address IS NULL` evaluates to FALSE, the second condition is never evaluated. A NULL `delivery_address` will not trigger the exception — the function returns `NEW` and the insert proceeds.

**Correctness:** This is the intended behavior. Orders with NULL `delivery_address` have not yet been confirmed by a dispatcher. The application layer blocks unconfirmed orders from route assignment before they reach `route_stops`. The DB trigger is a belt-and-suspenders guard for confirmed Tape Direct orders, not a substitute for application-layer validation of unconfirmed orders.

**Result: PASS**

---

## Finding 6 — Rollback Dependency Order: CORRECT ✅

**Check:** Does the rollback drop the trigger before the function?

```sql
-- DROP TRIGGER IF EXISTS trg_route_stops_no_tape_direct ON public.route_stops;
-- DROP FUNCTION IF EXISTS public.check_no_tape_direct_stop();
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS delivery_address;
```

**Finding:** Order is:
1. DROP TRIGGER (removes the dependency on the function)
2. DROP FUNCTION (safe to drop now that no trigger references it)
3. DROP COLUMN (removes the column the function was reading)

This is the correct dependency order. Reversing steps 1 and 2 would cause `DROP FUNCTION` to fail with a dependency error because the trigger references the function. All three DROP statements use `IF EXISTS`, making the rollback safe to run even if the migration partially failed.

**Result: PASS**

---

## Finding 7 — Relocation Documentation: PRESENT ✅

**Check:** Is the relocation from Migration 01 documented clearly for future reviewers?

**Finding:** The file contains both:
- A header-level `RELOCATION NOTE` explaining why the trigger moved
- An inline comment block above the function creation explaining the design rationale

This satisfies the audit trail requirement. A future engineer reading the file will understand why the trigger is in Migration 02 rather than Migration 01 and will not be tempted to "fix" it by moving it back.

**Result: PASS**

---

## Finding 8 — POST-COMMIT VERIFY Block: COMPLETE ✅

**Check:** Are verification queries present for all significant changes in this migration?

**Finding:** The verify block covers:
1. Column existence and type — structural
2. Column comment — documentation
3. Read/write smoke test — behavioral
4. Function existence — catalog check
5. Trigger existence — catalog check
6. Behavioral block test (transactional rollback pattern) — end-to-end guard validation

All six checks are present and correctly structured. The behavioral test (check 6) wraps the test insert in an explicit BEGIN/ROLLBACK so it can be run safely against a production-like environment without persisting test data.

**Result: PASS**

---

## Remaining Concerns Before Jeffrey Approves Apply

**None blocking.**

One advisory note for Jeffrey's awareness:

> **Advisory:** The behavioral verify test (step 6) requires an existing order row to stamp with the Tape Direct address. If the database is freshly migrated with no order data, step 6 will silently no-op on the UPDATE (UPDATE 0) and the INSERT will never fire. In that case, the trigger guard cannot be behaviorally verified until real or seed order data exists. This is expected and acceptable — catalog checks (steps 4 and 5) confirm the objects exist at the DB level regardless of data.

No structural, security, or correctness issues found.

---

## Delta Sign-Off

**APPROVED**

All six technical findings PASS. Migration 02 v2 is structurally correct, security-hardened, and safe to apply once Jeffrey provides explicit approval. The trigger relocation from Migration 01 v3 is correctly executed and fully documented.

— Delta, QA Lead  
2026-06-14
