-- ============================================================================
-- CK-L1-003 — lookup_tracking must return the CURRENT effective order status
-- ============================================================================
-- STATUS: STAGED — NOT APPLIED. Requires Delta review + Jeffrey apply.
-- PROJECT: app/orders project (exayifxbqduhsxmmsnxr) — NOT the backlog project.
-- TIER: 2 (data-read / server-side). Human-gated per FORGE-HOLD-STATUS freeze.
--
-- BUG: Public tracking page (/?public=track) shows 'Order Placed' as the status
--      header for order CC20260628C5D3, while HQ shows 'Ready for Pickup'. The
--      frontend renders statusLabel(order.status) correctly — so the RPC
--      lookup_tracking is returning a STALE status (the creation-time status,
--      not the current effective one).
--
-- ROOT CAUSE HYPOTHESIS (confirm against live function before apply):
--   lookup_tracking selects orders.status, but the live/current status is
--   tracked either (a) on the order row but updated via a path the RPC's
--   cached/materialized source misses, or (b) at the per-box level
--   (boxes[].orderStatus / boxes[].status) which supersedes the order-level
--   status, or (c) in the data JSONB (data->>'status').
--
-- DELTA: Before apply, run the following against the LIVE app DB to confirm
--   which field holds the truth for CC20260628C5D3:
--     SELECT id, status, data->>'status' AS data_status,
--            (SELECT jsonb_agg(b->>'orderStatus') FROM jsonb_array_elements(
--               COALESCE(data->'boxes','[]'::jsonb)) b) AS box_statuses
--       FROM orders WHERE id = 'CC20260628C5D3';
--   Then confirm the COALESCE order below matches the app's resolution rule
--   (per-box latest status wins over order-level, which wins over data JSONB).
--
-- This migration is a TEMPLATE: the SELECT list / column names MUST be
-- reconciled with the actual lookup_tracking definition (pull it first with
--   SELECT pg_get_functiondef('public.lookup_tracking(text)'::regprocedure);
-- ) — do not apply blind. Replace the column projection only; keep the
-- existing security model (SECURITY DEFINER, search_path, row filtering).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- STEP 0 (Delta, read-only): capture the current definition for the rollback.
--   SELECT pg_get_functiondef('public.lookup_tracking(text)'::regprocedure);
-- Paste the output into ck-l1-003-lookup-tracking.ROLLBACK.sql before applying.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- STEP 1: redefine lookup_tracking so the returned `status` is the current
-- effective status. Only the status projection changes; all other returned
-- columns, the WHERE/row-restriction, and the security attributes are
-- preserved EXACTLY as in the live definition.
--
-- The effective-status expression below mirrors the app's own resolution
-- (see resolveBoxTypeLabel sibling logic): a single canonical status per
-- order, preferring the most-advanced per-box orderStatus when boxes exist,
-- else the order-level status, else the data JSONB fallback.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lookup_tracking(p_query text)
RETURNS TABLE (
  -- NOTE: this column list MUST match the live function's RETURNS signature.
  -- Reconcile before apply. Shown here as the known-read fields.
  id            text,
  status        text,
  destination   text,
  box_type      text,
  updated_at    timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    o.id,
    -- CK-L1-003: current effective status (was: bare o.status which could be stale)
    COALESCE(
      -- (a) latest per-box status if boxes are present
      (
        SELECT b.value ->> 'orderStatus'
        FROM jsonb_array_elements(COALESCE(o.data -> 'boxes', '[]'::jsonb)) b
        WHERE b.value ->> 'orderStatus' IS NOT NULL
        ORDER BY b.value ->> 'orderStatus'   -- replace with pipeline-rank if needed
        LIMIT 1
      ),
      -- (b) order-level status
      o.status,
      -- (c) data JSONB fallback
      o.data ->> 'status'
    ) AS status,
    o.destination,
    o.box_type,
    o.updated_at
  FROM public.orders o
  WHERE upper(o.id) = upper(p_query)
     OR upper(COALESCE(o.tracking_number, '')) = upper(p_query)
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- STEP 2: preserve the public grant (lookup_tracking is the anon tracking
-- endpoint and is deliberately NOT revoked — see stripe-security-migration.sql).
-- Re-grant only if the live function had EXECUTE for anon; otherwise omit.
-- ---------------------------------------------------------------------------
-- GRANT EXECUTE ON FUNCTION public.lookup_tracking(text) TO anon, authenticated;

-- ============================================================================
-- ACCEPTANCE (Delta + ShipmentTester, post-apply on a staging clone):
--   lookup_tracking('CC20260628C5D3') returns status='ready_pickup'
--   (so the tracking header renders 'Ready for Pickup'), matching HQ.
-- ============================================================================
