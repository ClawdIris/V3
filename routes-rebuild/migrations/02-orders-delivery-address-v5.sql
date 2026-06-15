-- =============================================================================
-- Migration 02 — delivery_address Column on orders + Tape Direct Guard Triggers
-- Project: Casabe Konnect R4
-- Author: Forge (prepared for Delta review — NOT APPLIED)
-- Status: V5 DRAFT — FOR UPDATE lock in check_no_tape_direct_stop — DO NOT APPLY without Jeffrey/Codex approval
-- HOLD: Do not apply until Migration 01 v3 is applied and Jeffrey approves this file.
-- =============================================================================
-- Purpose:
--   Add delivery_address TEXT to public.orders so that:
--     • The confirm_order_address RPC can persist a verified customer address
--     • The address correction flow can write back to the order record
--     • HQ Operations and Office order views both read the same corrected address
--
-- Additionally (V2 addition):
--   Create check_no_tape_direct_stop() and trg_route_stops_no_tape_direct
--   to prevent any route_stops insert where the associated order's delivery_address
--   matches the Tape Direct warehouse address. Placed here because these objects
--   reference orders.delivery_address, which is added by this migration.
--
-- Prereq: public.orders table must exist. Migration 01 (routes schema) must be applied.
-- This migration does NOT remove or alter any existing columns.
-- Do NOT apply until Delta confirms orders table column compatibility.
-- =============================================================================

-- RELOCATION NOTE: check_no_tape_direct_stop() and trg_route_stops_no_tape_direct
-- were originally authored in Migration 01 v1/v2 but removed in Migration 01 v3
-- (Codex audit finding) because they referenced orders.delivery_address before
-- it existed. They are placed here (after ADD COLUMN delivery_address) to guarantee
-- the column is present when the trigger is created.

-- =============================================================================
-- V3 CHANGE SUMMARY
-- =============================================================================
-- WHAT WAS WRONG (v2):
--   trg_route_stops_no_tape_direct was declared BEFORE INSERT only.
--   This left a bypass path: a stop could be inserted legitimately (non-Tape-Direct
--   order), then its order_id could be UPDATE'd to point to a Tape Direct order.
--   The trigger never fired on UPDATE, so the invariant was silently bypassed.
--
-- WHAT CHANGED (v3):
--   Trigger declaration changed from:
--     BEFORE INSERT ON public.route_stops
--   to:
--     BEFORE INSERT OR UPDATE ON public.route_stops
--
--   The function body (check_no_tape_direct_stop()) is UNCHANGED. It already
--   reads NEW.order_id and NEW.tenant_id, which are valid for both INSERT and
--   UPDATE row transitions in PostgreSQL (NEW always reflects the incoming row
--   state regardless of the DML operation).
--
-- WHY:
--   PostgreSQL BEFORE triggers receive NEW for both INSERT and UPDATE.
--   Adding OR UPDATE closes the UPDATE bypass without any function change.
--   The trigger comment and POST-COMMIT VERIFY block are updated accordingly.
-- =============================================================================

-- =============================================================================
-- V4 CHANGE SUMMARY
-- =============================================================================
-- WHAT WAS WRONG (v3):
--   trg_route_stops_no_tape_direct guards route_stops on BEFORE INSERT OR UPDATE —
--   so a stop cannot be inserted or updated to point to a Tape Direct order.
--   However, there is a complementary bypass vector on the ORDERS side:
--
--     1. INSERT a route_stops row referencing a normal order
--        (route_stops trigger passes — order address is not Tape Direct)
--     2. UPDATE public.orders SET delivery_address = '3801 White Plains Rd...'
--        for that same order
--     3. The Tape Direct address is now in the route via an existing stop —
--        the route_stops trigger NEVER fired because orders was mutated, not
--        route_stops. The invariant is bypassed.
--
-- WHAT CHANGED (v4):
--   Added a second trigger on the orders table:
--     check_order_delivery_address_not_tape_direct()
--     trg_orders_delivery_address_not_tape_direct
--
--   This trigger fires BEFORE UPDATE OF delivery_address on public.orders.
--   It is column-specific: it only fires when delivery_address is being changed,
--   not on every UPDATE to an orders row (avoids unnecessary overhead).
--
--   The check logic:
--     IF the new delivery_address matches Tape Direct (case-insensitive, trim)
--       AND at least one route_stops row references this order (by order_id + tenant_id)
--     THEN RAISE EXCEPTION — the address change is blocked.
--
--   If the order is NOT yet referenced by any route_stop, the address can be
--   changed freely (order not in a route — normal dispatcher correction flow).
--   If the new address is NOT Tape Direct, the trigger is a no-op.
--
-- WHY BOTH TRIGGERS ARE NEEDED TOGETHER:
--   trg_route_stops_no_tape_direct (route_stops) guards the STOP side:
--     a stop cannot be inserted or rerouted to a Tape Direct order.
--   trg_orders_delivery_address_not_tape_direct (orders) guards the ADDRESS side:
--     an order already in a route cannot have its address changed to Tape Direct.
--   Together they form a complete, complementary guard:
--     No route stop can ever reach the Tape Direct address, regardless of which
--     side of the relationship is mutated.
-- =============================================================================

-- =============================================================================
-- V5 CHANGE SUMMARY
-- =============================================================================
-- WHAT WAS WRONG (v4):
--   In check_no_tape_direct_stop(), the orders row was read with a plain SELECT:
--
--     SELECT delivery_address
--       INTO v_delivery_address
--       FROM public.orders
--      WHERE id        = NEW.order_id
--        AND tenant_id = NEW.tenant_id;
--
--   This is a plain snapshot read with no row-level lock. Classic write-skew:
--
--   Timeline of the race:
--     T1  Session A (route_stops INSERT trigger):
--           SELECT delivery_address FROM orders ... -- reads '123 Legit St' ✓
--           (check passes — not Tape Direct)
--     T2  Session B (concurrent UPDATE):
--           UPDATE orders SET delivery_address = '3801 White Plains Rd...'
--           WHERE id = <same order>;
--           -- succeeds (orders-side trigger sees 0 stops at this instant)
--           COMMIT;
--     T3  Session A commits route_stops INSERT.
--
--   Result after both commits: a route_stops row referencing an order whose
--   delivery_address is now the Tape Direct warehouse. Invariant violated.
--   Neither trigger prevented it — each saw a consistent-but-outdated snapshot.
--
-- WHAT CHANGED (v5):
--   Added FOR UPDATE to the SELECT inside check_no_tape_direct_stop():
--
--     SELECT delivery_address
--       INTO v_delivery_address
--       FROM public.orders
--      WHERE id        = NEW.order_id
--        AND tenant_id = NEW.tenant_id
--     FOR UPDATE;
--
--   FOR UPDATE acquires a row-level exclusive lock on the orders row at the
--   instant of the SELECT. Any concurrent transaction that attempts to UPDATE
--   that orders row (including changing delivery_address) will BLOCK until
--   Session A either commits or rolls back. This serializes the two operations:
--
--   With FOR UPDATE:
--     T1  Session A: SELECT ... FOR UPDATE → acquires lock on orders row
--     T2  Session B: UPDATE orders SET delivery_address = '3801 White Plains Rd...'
--           → BLOCKS (waits for Session A's lock)
--     T3  Session A: check passes (address still '123 Legit St'), commits INSERT
--     T4  Session B unblocks → UPDATE proceeds
--           → trg_orders_delivery_address_not_tape_direct fires
--           → SELECT COUNT(*) FROM route_stops → count = 1 (Session A committed)
--           → RAISE EXCEPTION — Session B's UPDATE is rejected
--
--   The invariant is preserved. Write-skew is closed.
--
-- WHY THE ORDERS-SIDE TRIGGER DOES NOT NEED FOR UPDATE:
--   check_order_delivery_address_not_tape_direct() fires on BEFORE UPDATE of
--   orders.delivery_address. PostgreSQL BEFORE UPDATE triggers already hold an
--   implicit write lock on the row being updated — the UPDATE statement itself
--   acquired a row-level lock before the trigger fired. There is no need for an
--   additional FOR UPDATE; adding one would be redundant and could cause
--   unnecessary lock contention or deadlocks. The FOR UPDATE is needed ONLY on
--   the route_stops side, where a plain SELECT reads from orders without any
--   implicit lock.
--
-- OBJECTS CHANGED:
--   check_no_tape_direct_stop() — SELECT gains FOR UPDATE (one-line change)
--   check_order_delivery_address_not_tape_direct() — UNCHANGED
--   trg_route_stops_no_tape_direct — UNCHANGED
--   trg_orders_delivery_address_not_tape_direct — UNCHANGED
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Add delivery_address column (idempotent — IF NOT EXISTS guard)
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_address TEXT;

COMMENT ON COLUMN public.orders.delivery_address IS
    'Customer delivery address for route planning. Written by confirm_order_address RPC. '
    'Source of truth for geocoding and route stop display across all surfaces.';


-- ============================================================
-- BACKFILL STRATEGY: Option A — Lazy Population (FINAL DECISION)
-- ============================================================
-- delivery_address is populated on first confirmation per order.
-- Existing orders remain NULL until a dispatcher confirms them in
-- the route builder. Unconfirmed orders are blocked from route
-- assignment regardless of delivery_address value.
--
-- The confirm_order_address RPC must implement all four of:
--
-- 1. THROTTLING
--    Rate-limit Geocoding API calls per tenant per minute.
--    Recommended: max 10 geocode requests/minute/tenant.
--    Excess requests: queue with exponential backoff, do not drop.
--
-- 2. RETRIES
--    On transient Geocoding API error (5xx, timeout):
--    Retry up to 3 times with exponential backoff (1s, 2s, 4s).
--    On persistent failure: surface clear error to dispatcher,
--    do not silently fail or cache an unverified address.
--
-- 3. COST MONITORING
--    Log every Geocoding API call to a geocode_audit table or Edge
--    Function log: tenant_id, order_id, timestamp, result_status.
--    Alert if daily calls exceed configured threshold.
--
-- 4. ADDRESS-HASH CACHING
--    Before calling Geocoding API, hash the raw address string
--    (MD5 or SHA-256). Check a geocode_cache table for a recent
--    hit (TTL: 30 days). On cache hit: use cached lat/lon/formatted
--    address, skip API call. On cache miss: call API, store result.
--    Cache table: geocode_cache(address_hash, lat, lon,
--    formatted_address, cached_at, tenant_id).
--
-- Do not bulk-geocode all historical orders.
-- Option B (bulk backfill) is explicitly rejected.
-- ============================================================


-- ── Tape Direct guard on route_stops (relocated from Migration 01) ────────
-- Prevents route_stops inserts OR updates where the associated order's
-- delivery_address matches the Tape Direct warehouse. Tape Direct is always
-- the route ORIGIN and must never appear as a numbered stop.
-- This function and trigger are placed here (Migration 02) because they
-- reference orders.delivery_address, which is created above.
--
-- V3 NOTE: Trigger now fires on BEFORE INSERT OR UPDATE (v2 was INSERT only).
-- The function body is unchanged — NEW.order_id / NEW.tenant_id are valid
-- for both INSERT and UPDATE row transitions in PostgreSQL.
--
-- V5 NOTE: SELECT now uses FOR UPDATE to acquire a row-level lock on the orders
-- row. This closes the write-skew window where a concurrent UPDATE to
-- orders.delivery_address could race past this trigger's snapshot read.

CREATE OR REPLACE FUNCTION public.check_no_tape_direct_stop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery_address TEXT;
BEGIN
  -- V5 CHANGE: FOR UPDATE added to lock the orders row against concurrent
  -- delivery_address mutations while this trigger transaction is in flight.
  -- Prevents write-skew: without FOR UPDATE, a concurrent UPDATE orders SET
  -- delivery_address = '<Tape Direct>' could race between this SELECT and the
  -- route_stops INSERT commit, allowing the invariant to be silently violated.
  SELECT delivery_address
    INTO v_delivery_address
    FROM public.orders
   WHERE id        = NEW.order_id
     AND tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF v_delivery_address IS NOT NULL
     AND lower(trim(v_delivery_address)) = lower(trim('3801 White Plains Rd, Bronx, NY 10467'))
  THEN
    RAISE EXCEPTION
      'route_stops: order % has delivery_address matching Tape Direct warehouse. '
      'Tape Direct is the route origin and must not appear as a stop.',
      NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;

-- V3 CHANGE: BEFORE INSERT OR UPDATE (was BEFORE INSERT in v2)
-- Closes the UPDATE bypass: a stop whose order_id is later changed to
-- a Tape Direct order will now be blocked at the DB level on UPDATE.
CREATE TRIGGER trg_route_stops_no_tape_direct
  BEFORE INSERT OR UPDATE ON public.route_stops
  FOR EACH ROW EXECUTE FUNCTION public.check_no_tape_direct_stop();


-- ── Tape Direct guard on orders.delivery_address (V4 addition) ───────────
-- Prevents an order's delivery_address from being changed to the Tape Direct
-- warehouse address while that order is already referenced by a route_stops row.
--
-- Attack vector closed (was open in v3):
--   1. Insert a stop referencing a normal order (route_stops trigger passes)
--   2. UPDATE orders SET delivery_address = '3801 White Plains Rd...'
--   3. Without this trigger, Tape Direct address enters the route silently.
--
-- This trigger fires ONLY on UPDATE OF delivery_address (column-specific).
-- It does NOT fire on INSERT or on any other orders column update.
-- If the order is not yet in any route, address changes are allowed freely.
-- If the new address is not Tape Direct, trigger is a no-op (RETURN NEW immediately).
--
-- V5 NOTE: FOR UPDATE is NOT added here. This trigger fires on BEFORE UPDATE of
-- orders.delivery_address — the UPDATE statement already holds a row-level write
-- lock on the orders row before this trigger fires. Adding FOR UPDATE would be
-- redundant and could cause unnecessary deadlocks.

CREATE OR REPLACE FUNCTION public.check_order_delivery_address_not_tape_direct()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stop_count INT;
BEGIN
  -- Only block if the new address matches Tape Direct
  IF lower(trim(NEW.delivery_address)) =
     lower(trim('3801 White Plains Rd, Bronx, NY 10467'))
  THEN
    SELECT COUNT(*) INTO v_stop_count
      FROM public.route_stops
     WHERE order_id  = NEW.id
       AND tenant_id = NEW.tenant_id;

    IF v_stop_count > 0 THEN
      RAISE EXCEPTION
        'orders: cannot set delivery_address to Tape Direct warehouse '
        'while order % is referenced by % route stop(s). '
        'Remove the stop before changing the address.',
        NEW.id, v_stop_count;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- V4 ADDITION: Column-specific trigger — fires ONLY on UPDATE OF delivery_address.
-- Closes the orders-side bypass that was open in v3.
CREATE TRIGGER trg_orders_delivery_address_not_tape_direct
  BEFORE UPDATE OF delivery_address ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.check_order_delivery_address_not_tape_direct();

COMMIT;


-- =============================================================================
-- POST-COMMIT VERIFY
-- =============================================================================

-- 1. Column exists with correct type
--    SELECT column_name, data_type, is_nullable
--    FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'orders'
--      AND column_name = 'delivery_address';
--    EXPECTED: 1 row, data_type = 'text', is_nullable = 'YES'

-- 2. Column comment present
--    SELECT col_description(
--        'public.orders'::regclass,
--        attnum
--    ) AS comment
--    FROM pg_attribute
--    WHERE attrelid = 'public.orders'::regclass
--      AND attname = 'delivery_address';
--    EXPECTED: non-null comment text

-- 3. Read/write smoke test
--    UPDATE public.orders
--    SET delivery_address = '3801 White Plains Rd, Bronx, NY 10467'
--    WHERE id = (SELECT id FROM public.orders LIMIT 1);
--    EXPECTED: UPDATE 1 (or UPDATE 0 if no orders exist)
--    -- Then rollback:
--    -- ROLLBACK; (wrap in a transaction if just testing)

-- 4. Tape Direct function exists (route_stops guard)
--    SELECT routine_name FROM information_schema.routines
--    WHERE routine_schema = 'public' AND routine_name = 'check_no_tape_direct_stop';
--    EXPECTED: 1 row

-- 5. Tape Direct trigger exists on route_stops — covers BOTH INSERT and UPDATE (V3)
--    SELECT trigger_name, event_manipulation
--    FROM information_schema.triggers
--    WHERE event_object_schema = 'public'
--      AND event_object_table = 'route_stops'
--      AND trigger_name = 'trg_route_stops_no_tape_direct'
--    ORDER BY event_manipulation;
--    EXPECTED: 2 rows — one for INSERT and one for UPDATE
--    (information_schema.triggers returns one row per event per trigger)

-- 6. Tape Direct address is blocked on INSERT (behavioral test — run in a transaction, then rollback)
--    BEGIN;
--    UPDATE public.orders SET delivery_address = '3801 White Plains Rd, Bronx, NY 10467'
--    WHERE id = (SELECT id FROM public.orders LIMIT 1);
--    INSERT INTO public.route_stops (route_id, order_id, tenant_id, stop_sequence)
--    VALUES (gen_random_uuid(), '<order_id_from_above>', '<tenant_id>', 1);
--    EXPECTED: ERROR — 'route_stops: order ... has delivery_address matching Tape Direct warehouse'
--    ROLLBACK;

-- 6b. Tape Direct address is blocked on UPDATE to route_stops (V3 — UPDATE smoke test)
--     This test proves the UPDATE bypass that existed in v2 is now closed.
--     BEGIN;
--     -- Insert a stop with a non-Tape-Direct order (should succeed):
--     UPDATE public.orders SET delivery_address = '123 Legit St, Bronx, NY 10001'
--     WHERE id = (SELECT id FROM public.orders LIMIT 1);
--     INSERT INTO public.route_stops (route_id, order_id, tenant_id, stop_sequence)
--     VALUES (gen_random_uuid(), '<order_id_from_above>', '<tenant_id>', 1);
--     -- Now change that stop's order_id to point at a Tape Direct order:
--     UPDATE public.orders SET delivery_address = '3801 White Plains Rd, Bronx, NY 10467'
--     WHERE id = '<order_id_from_above>';
--     UPDATE public.route_stops
--     SET order_id = '<order_id_from_above>'
--     WHERE order_id = '<order_id_from_above>'
--       AND tenant_id = '<tenant_id>';
--     EXPECTED: ERROR — 'route_stops: order ... has delivery_address matching Tape Direct warehouse'
--     (Trigger fires on the UPDATE to route_stops and blocks it)
--     ROLLBACK;

-- 7. orders delivery_address guard function exists (V4 catalog check)
--    SELECT routine_name FROM information_schema.routines
--    WHERE routine_schema = 'public'
--      AND routine_name = 'check_order_delivery_address_not_tape_direct';
--    EXPECTED: 1 row

-- 8. orders delivery_address guard behavioral test (V4 — transactional, ROLLBACK after)
--    This test proves the orders-side bypass that was open in v3 is now closed.
--    BEGIN;
--    -- Step 1: Insert a stop referencing a normal order (should succeed)
--    UPDATE public.orders SET delivery_address = '123 Legit St, Bronx, NY 10001'
--    WHERE id = (SELECT id FROM public.orders LIMIT 1);
--    INSERT INTO public.route_stops (route_id, order_id, tenant_id, stop_sequence)
--    VALUES (gen_random_uuid(), '<order_id_from_above>', '<tenant_id>', 1);
--    -- Step 2: Now attempt to change that order's delivery_address to Tape Direct
--    UPDATE public.orders
--    SET delivery_address = '3801 White Plains Rd, Bronx, NY 10467'
--    WHERE id = '<order_id_from_above>'
--      AND tenant_id = '<tenant_id>';
--    EXPECTED: ERROR — 'orders: cannot set delivery_address to Tape Direct warehouse
--              while order <id> is referenced by 1 route stop(s).
--              Remove the stop before changing the address.'
--    (Trigger fires on the UPDATE to orders.delivery_address and blocks it)
--    ROLLBACK;

-- 9. V5 FOR UPDATE lock verification (catalog check — confirms function body change)
--    SELECT prosrc FROM pg_proc
--    WHERE proname = 'check_no_tape_direct_stop'
--      AND pronamespace = 'public'::regnamespace;
--    EXPECTED: function body contains 'FOR UPDATE' on the orders SELECT
--    (Search for 'for update' case-insensitively in the returned prosrc text)

-- 10. V5 orders-side function NOT changed (catalog check — confirms no FOR UPDATE added there)
--     SELECT prosrc FROM pg_proc
--     WHERE proname = 'check_order_delivery_address_not_tape_direct'
--       AND pronamespace = 'public'::regnamespace;
--     EXPECTED: function body does NOT contain 'FOR UPDATE'
--     (Confirms the orders-side trigger was correctly left unchanged)


-- =============================================================================
-- ROLLBACK (commented — run manually if migration must be reverted)
-- =============================================================================

-- BEGIN;
--
-- -- V4 additions: drop orders-side trigger and function first
-- DROP TRIGGER IF EXISTS trg_orders_delivery_address_not_tape_direct ON public.orders;
-- DROP FUNCTION IF EXISTS public.check_order_delivery_address_not_tape_direct();
--
-- -- route_stops trigger and function (present since V2)
-- DROP TRIGGER IF EXISTS trg_route_stops_no_tape_direct ON public.route_stops;
-- DROP FUNCTION IF EXISTS public.check_no_tape_direct_stop();
--
-- -- Column drop last (triggers and functions reference it)
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS delivery_address;
--
-- COMMIT;
--
-- NOTE: Dropping this column will destroy any persisted delivery_address data.
-- Only run rollback if confirmed no application code is reading this column.
-- Correct drop order: triggers before functions (dependency), both tables' triggers
-- before functions, all triggers/functions before column drop.
