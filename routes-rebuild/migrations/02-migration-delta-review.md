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

---

# Migration 02 v3 — Delta QA Review
**File:** `02-orders-delivery-address-v3.sql`
**Reviewer:** Delta
**Review Date:** 2026-06-14
**Status:** APPROVED

---

## Scope of V3 Change

Single targeted fix addressing the Codex re-audit NO-GO finding:

> **Finding:** `trg_route_stops_no_tape_direct` fired `BEFORE INSERT` only (v2).  
> An existing `route_stops` row could have its `order_id` UPDATE'd to point to  
> a Tape Direct order after insertion, bypassing the invariant entirely.

V3 changes exactly one line in the migration:

| | v2 | v3 |
|---|---|---|
| Trigger declaration | `BEFORE INSERT ON public.route_stops` | `BEFORE INSERT OR UPDATE ON public.route_stops` |

All other content is identical to v2.

---

## Finding V3-1 — Trigger Covers BEFORE INSERT OR UPDATE: CORRECT ✅

**Check:** Does the trigger now fire on both INSERT and UPDATE?

```sql
-- V3 CHANGE: BEFORE INSERT OR UPDATE (was BEFORE INSERT in v2)
CREATE TRIGGER trg_route_stops_no_tape_direct
  BEFORE INSERT OR UPDATE ON public.route_stops
  FOR EACH ROW EXECUTE FUNCTION public.check_no_tape_direct_stop();
```

**Finding:** `BEFORE INSERT OR UPDATE` is present. PostgreSQL fires this trigger for both `INSERT` and `UPDATE` DML on `route_stops`. The UPDATE bypass that existed in v2 is now closed at the database level.

**Result: PASS**

---

## Finding V3-2 — Function Body Correct for UPDATE Path: CORRECT ✅

**Check:** Does `check_no_tape_direct_stop()` work correctly when invoked on UPDATE?

```sql
SELECT delivery_address
  INTO v_delivery_address
  FROM public.orders
 WHERE id        = NEW.order_id
   AND tenant_id = NEW.tenant_id;
```

**Finding:** The function body is unchanged from v2. In PostgreSQL, `NEW` is available for both INSERT and UPDATE row-level triggers — it always reflects the incoming row state (the new values being written). `NEW.order_id` and `NEW.tenant_id` correctly refer to the post-update values of the row being modified, which is exactly what we want: if someone UPDATEs a `route_stops` row to point at a different `order_id`, the trigger reads that new `order_id` and checks it against the Tape Direct address. The logic is sound for both paths.

No function body change is required.

**Result: PASS**

---

## Finding V3-3 — Verify Step 5 Updated (INSERT OR UPDATE catalog check): CORRECT ✅

**Check:** Does verify step 5 confirm the trigger covers both INSERT and UPDATE?

```sql
-- 5. Tape Direct trigger exists on route_stops — covers BOTH INSERT and UPDATE (V3)
--    SELECT trigger_name, event_manipulation
--    FROM information_schema.triggers
--    WHERE event_object_schema = 'public'
--      AND event_object_table = 'route_stops'
--      AND trigger_name = 'trg_route_stops_no_tape_direct'
--    ORDER BY event_manipulation;
--    EXPECTED: 2 rows — one for INSERT and one for UPDATE
```

**Finding:** Verify step 5 has been updated to query `event_manipulation` and expect **2 rows** (one for INSERT, one for UPDATE). This correctly reflects how `information_schema.triggers` represents multi-event triggers in PostgreSQL — one row per event per trigger name. A reviewer running this check against the v2-applied DB would only see 1 row; against v3 they will see 2, confirming the fix landed.

**Result: PASS**

---

## Finding V3-4 — Verify Step 6b Present (UPDATE Smoke Test): CORRECT ✅

**Check:** Is a step 6b present that proves the UPDATE bypass is blocked?

**Finding:** Step 6b is present and correctly structured:

1. Inserts a `route_stops` row against a **non**-Tape-Direct order (should succeed — baseline)
2. Changes that order's `delivery_address` to the Tape Direct warehouse address
3. `UPDATE`s the `route_stops` row's `order_id` to that order
4. **Expected:** `ERROR — 'route_stops: order ... has delivery_address matching Tape Direct warehouse'`
5. Wrapped in `BEGIN`/`ROLLBACK` — safe to run in a production-like environment

This test directly exercises the bypass path that was open in v2. If the trigger were still INSERT-only, step 4 would silently succeed (wrong). The test will only pass when `BEFORE INSERT OR UPDATE` is in place.

**Result: PASS**

---

## Finding V3-5 — V3 Change Summary Block: PRESENT ✅

**Check:** Is the change documented at the top of the file for future reviewers?

**Finding:** A `-- V3 CHANGE SUMMARY` block is present immediately after the status header. It documents:
- What was wrong in v2 (INSERT-only trigger, UPDATE bypass)
- What changed in v3 (trigger declaration: `INSERT OR UPDATE`)
- What did NOT change (function body — unchanged, works for both paths)
- Why the function body is correct for UPDATE (`NEW` is valid in both INSERT and UPDATE triggers)

**Result: PASS**

---

## Remaining Concerns Before Jeffrey Approves Apply

**None blocking.**

One advisory (carried forward from v2, unchanged):

> **Advisory:** The behavioral verify tests (steps 6 and 6b) require an existing order row. On a freshly migrated database with no order data, the UPDATE in step 6b will be a no-op and the final `UPDATE public.route_stops` will match zero rows. In that case, the trigger guard cannot be behaviorally verified until seed/real order data exists. Catalog check (step 5, expecting 2 rows) confirms the trigger is registered correctly regardless of data.

---

## Delta Sign-Off

**APPROVED**

Single targeted fix. All V3 findings PASS. The Tape Direct invariant now covers `BEFORE INSERT OR UPDATE` on `route_stops`. The function body requires no change — `NEW.order_id` and `NEW.tenant_id` are correct for both INSERT and UPDATE row transitions. Verify step 6b provides an explicit UPDATE smoke test that proves the bypass is closed.

Migration 02 v3 is structurally correct, security-hardened, and safe to apply once Codex re-audit confirms and Jeffrey provides explicit approval.

— Delta, QA Lead  
2026-06-14
