# Migration 02 v5 — Concurrency Test: FOR UPDATE Lock Proof
**File:** `02-orders-delivery-address-v5.sql`
**Author:** Forge
**Review Date:** 2026-06-14
**Status:** EVIDENCE — Proves FOR UPDATE closes write-skew in check_no_tape_direct_stop()

---

## Background: The Write-Skew Problem (v4)

In v4, `check_no_tape_direct_stop()` used a plain `SELECT ... INTO` to read the order's `delivery_address`:

```sql
SELECT delivery_address
  INTO v_delivery_address
  FROM public.orders
 WHERE id        = NEW.order_id
   AND tenant_id = NEW.tenant_id;
```

This is a snapshot read with no row-level lock. Under PostgreSQL's default Read Committed isolation, this SELECT sees the committed state of the orders row at the moment it executes — but acquires no lock that would prevent another session from modifying that row before the trigger's transaction commits.

**Write-skew** occurs when:
1. Two concurrent transactions each read a consistent (valid) state
2. Each makes a write decision based on what they read
3. Their combined writes produce a state that violates the invariant — even though neither transaction individually violated it

This is different from a dirty read or a lost update. Both transactions see correct, committed data at the time they read. The problem is that the world changes between the read and the write.

---

## The Exact Race Condition (v4)

**Setup:** Order `ord-001` (tenant `t-001`) has `delivery_address = '123 Legit St, Bronx, NY 10001'` — not Tape Direct. No route stops exist yet.

```
INITIAL STATE:
  orders:      { id: ord-001, tenant_id: t-001, delivery_address: '123 Legit St, Bronx, NY 10001' }
  route_stops: (empty)
```

| Time | Session A (route_stops INSERT) | Session B (orders delivery_address UPDATE) |
|------|-------------------------------|---------------------------------------------|
| T0 | `BEGIN;` | `BEGIN;` |
| T1 | `INSERT INTO route_stops (route_id, order_id, tenant_id, stop_sequence) VALUES (gen_random_uuid(), 'ord-001', 't-001', 1);` | — |
| T2 | → trigger fires: `check_no_tape_direct_stop()` | — |
| T3 | → `SELECT delivery_address INTO v_delivery_address FROM public.orders WHERE id = 'ord-001' AND tenant_id = 't-001';` | — |
| T4 | → reads `'123 Legit St, Bronx, NY 10001'` ✓ (not Tape Direct — check will pass) | — |
| T5 | → *[trigger has not yet returned RETURN NEW; transaction not yet committed]* | `UPDATE public.orders SET delivery_address = '3801 White Plains Rd, Bronx, NY 10467' WHERE id = 'ord-001' AND tenant_id = 't-001';` |
| T6 | — | → `trg_orders_delivery_address_not_tape_direct` fires |
| T7 | — | → `SELECT COUNT(*) FROM route_stops WHERE order_id = 'ord-001'` → returns **0** (Session A has not committed!) |
| T8 | — | → count = 0 → trigger passes → `COMMIT;` ✓ |
| T9 | → trigger returns `RETURN NEW` (check passed at T4 — address was legit then) | — |
| T10 | → `COMMIT;` ✓ | — |

**Result after both commits:**
```
orders:      { id: ord-001, delivery_address: '3801 White Plains Rd, Bronx, NY 10467' }  ← TAPE DIRECT
route_stops: { order_id: ord-001, ... }  ← stop referencing that order
```

**Invariant violated.** A route stop now references the Tape Direct warehouse. Neither trigger prevented it — each saw a consistent but outdated snapshot of the other table's state.

---

## The Fix: FOR UPDATE (v5)

In v5, `check_no_tape_direct_stop()` adds `FOR UPDATE` to the orders SELECT:

```sql
SELECT delivery_address
  INTO v_delivery_address
  FROM public.orders
 WHERE id        = NEW.order_id
   AND tenant_id = NEW.tenant_id
FOR UPDATE;
```

`FOR UPDATE` acquires a **row-level exclusive lock** on the `orders` row at T3 (the moment of the SELECT). Any transaction attempting to `UPDATE` that row — including Session B's `UPDATE orders SET delivery_address = ...` — will **block** until Session A's transaction either commits or rolls back.

---

## Transaction Sequence Proving the Lock Works (v5)

**Setup:** Same initial state as above.

### Session A — route_stops INSERT (trigger fires)

```sql
-- Session A
BEGIN;

INSERT INTO public.route_stops (route_id, order_id, tenant_id, stop_sequence)
VALUES (gen_random_uuid(), 'ord-001', 't-001', 1);

-- The BEFORE INSERT trigger check_no_tape_direct_stop() fires.
-- Inside the trigger function:
--
--   SELECT delivery_address
--     INTO v_delivery_address
--     FROM public.orders
--    WHERE id        = 'ord-001'
--      AND tenant_id = 't-001'
--   FOR UPDATE;
--
-- This SELECT acquires a row-level exclusive lock on the orders row for ord-001.
-- Session A now holds this lock. The transaction has NOT yet committed.
```

*Session A holds the lock. It has read `'123 Legit St, Bronx, NY 10001'` — not Tape Direct. The trigger will return RETURN NEW, but Session A has not committed yet.*

---

### Session B — concurrent delivery_address UPDATE (blocks)

```sql
-- Session B (concurrent — overlaps Session A)
BEGIN;

UPDATE public.orders
   SET delivery_address = '3801 White Plains Rd, Bronx, NY 10467'
 WHERE id        = 'ord-001'
   AND tenant_id = 't-001';

-- *** SESSION B BLOCKS HERE ***
--
-- PostgreSQL attempts to acquire a row-level lock on the orders row for ord-001
-- in order to perform the UPDATE. Session A already holds a FOR UPDATE lock on
-- this exact row. Session B must wait until Session A's lock is released
-- (i.e., until Session A's transaction commits or rolls back).
--
-- Session B will sit here, blocked, until Session A's lock is released.
```

---

### Session A commits (releases lock)

```sql
-- Session A
-- Trigger has already returned RETURN NEW (address was '123 Legit St' — check passed).
-- The INSERT into route_stops is now being committed.

COMMIT;

-- Row-level lock on orders ord-001 is released.
-- route_stops now contains: { order_id: 'ord-001', tenant_id: 't-001', stop_sequence: 1 }
-- This row is committed and visible to all subsequent transactions.
```

---

### Session B unblocks — UPDATE proceeds — orders-side trigger fires — REJECTED

```sql
-- Session B unblocks.
-- Its UPDATE on orders ord-001 now proceeds.
-- trg_orders_delivery_address_not_tape_direct fires (BEFORE UPDATE OF delivery_address).

-- Inside check_order_delivery_address_not_tape_direct():
--
--   IF lower(trim('3801 White Plains Rd, Bronx, NY 10467')) =
--      lower(trim('3801 White Plains Rd, Bronx, NY 10467'))   -- TRUE
--   THEN
--     SELECT COUNT(*) INTO v_stop_count
--       FROM public.route_stops
--      WHERE order_id  = 'ord-001'
--        AND tenant_id = 't-001';
--
--     -- Session A committed its route_stop before Session B unblocked.
--     -- v_stop_count = 1 (the stop Session A inserted is now committed)
--
--     IF v_stop_count > 0 THEN   -- TRUE: 1 > 0
--       RAISE EXCEPTION
--         'orders: cannot set delivery_address to Tape Direct warehouse '
--         'while order ord-001 is referenced by 1 route stop(s). '
--         'Remove the stop before changing the address.';
--     END IF;
--   END IF;

-- *** RAISE EXCEPTION fires ***
-- Session B's UPDATE is aborted.
-- Session B's transaction rolls back.

ROLLBACK;  -- implicit on exception
```

---

## Expected Outcome

| Event | Result |
|-------|--------|
| Session A inserts route_stop for ord-001 | ✅ Succeeds — address was not Tape Direct at time of check |
| Session B attempts to UPDATE delivery_address to Tape Direct while A holds lock | 🔒 **BLOCKS** — waiting for Session A's FOR UPDATE lock |
| Session A commits | ✅ route_stop committed and visible |
| Session B unblocks, UPDATE proceeds | ⛔ **REJECTED** — orders-side trigger sees 1 stop → RAISE EXCEPTION |
| Final state of orders.delivery_address | `'123 Legit St, Bronx, NY 10001'` (unchanged — Session B rolled back) |
| Final state of route_stops | `{ order_id: 'ord-001', ... }` (Session A's stop persists) |

**Invariant preserved.** The Tape Direct address never reaches `orders.delivery_address` for an order that has a committed route stop.

---

## Why This Proves Write-Skew Is Closed

Write-skew in v4 was possible because:
- Session A read orders (no lock) → check passed
- Session B read route_stops (count = 0, no lock) → check passed
- Both committed independently → invariant violated

The `FOR UPDATE` in v5 **serializes** the two transactions at the orders row:

1. Session A locks the orders row **before** its trigger check completes
2. Session B cannot modify the orders row until Session A releases the lock
3. Session A commits its route_stop **before** Session B can read route_stops
4. When Session B's orders-side trigger finally reads route_stops, it sees Session A's committed stop → count = 1 → REJECT

The lock converts what was a concurrent, interleaved execution into a **sequential** one: Session A's entire check-and-commit completes before Session B's check-and-write can proceed. There is no longer a window in which both transactions can read a consistent-but-stale state and both pass their respective guards.

---

## Why FOR UPDATE Is NOT Needed on the Orders-Side Trigger

`check_order_delivery_address_not_tape_direct()` fires as a `BEFORE UPDATE` trigger on `public.orders`. When PostgreSQL executes an `UPDATE` statement, it acquires a row-level write lock on each target row **before** any `BEFORE` trigger fires. The trigger function therefore already executes under an implicit exclusive lock on the orders row — no `FOR UPDATE` is needed or appropriate.

Adding `FOR UPDATE` in the orders-side trigger would attempt to lock a row that the calling transaction already owns a write lock on. While PostgreSQL would not error (a transaction can re-lock its own rows), it would be dead code at best and could create confusion or subtle deadlock exposure if the locking hierarchy were ever changed. The `FOR UPDATE` belongs exclusively in `check_no_tape_direct_stop()` where the orders row is accessed via a standalone `SELECT` with no implicit write lock.

---

## Summary

| Property | v4 (plain SELECT) | v5 (SELECT ... FOR UPDATE) |
|----------|-------------------|---------------------------|
| Lock acquired on orders row | None | Row-level exclusive lock |
| Concurrent UPDATE to orders.delivery_address | Proceeds immediately, may race | Blocks until trigger transaction commits |
| Write-skew possible | ✅ Yes | ❌ No — serialized by lock |
| Orders-side trigger sees committed stop | ❌ May see stale count = 0 | ✅ Always sees post-commit count ≥ 1 |
| Invariant guaranteed | ❌ Under concurrent load | ✅ Always |

The `FOR UPDATE` lock on the route_stops-side trigger is the minimal, correct fix. It does not change any other behavior, does not affect the orders-side trigger, and does not alter any DDL objects beyond the body of `check_no_tape_direct_stop()`.

---

*Document authored by Forge — 2026-06-14*
*For Delta review and Codex re-audit*
