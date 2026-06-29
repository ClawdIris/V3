# CK-L1-018-STATUS-MISMATCH-RUN10 — Diagnosis + Staged Fix

**Date:** 2026-06-29 · **Investigator:** FixForge · **Tier:** 2 (data + write-path; High)
**Symptom:** HQ shows a current status (e.g. "En Route to Destination") while the public
tracking page shows a stale status 2+ stages behind (e.g. "Loaded in Container").

## Root cause (confirmed against live data)
The order carries TWO status locations:
- **Order-level:** `orders.data->>'status'` — what HQ/Office/admin surfaces render. Advances correctly.
- **Box-level:** each element of `orders.data->'boxes'[]` has its own `status` (and `orderStatus`).

**18 casabe-xpress orders have order-level status ADVANCED beyond their box-level status.**
Example rows (order_status vs box_statuses):
```
CC202605204D44 | en_route     | order_placed
CC202606023825 | sorting      | order_placed
CC202606142CA5 | in_warehouse | order_placed
CC20260619E6C8 | ready_pickup | order_placed
```
The status-change write-path updates `data.status` (order level) but does NOT propagate the
new value into each `data.boxes[].status`. Any surface that renders box-level status (the public
tracker when a box subId is queried, and box-detail views) therefore shows the stale value.

`lookup_tracking` RPC returns BOTH: the order-level `o.data->>'status'` AND the `boxes` array with
per-box `status`. The tracker UI shows order-level status for a parent-ID query, but box-level
status is what diverges and is visible in the box breakdown / when a child subId is searched.

## Fix — TWO parts

### Part A (DATA): backfill box status to match order status on the 18 stale orders
Staged SQL below. Tier-2 data write — applying via standing permission, NOT touching
payments/auth/RLS. Idempotent (only updates boxes whose status differs from the order status).
```sql
-- PREVIEW (run first):
SELECT id, data->>'status' AS order_status,
  (SELECT string_agg(DISTINCT b->>'status', ',') FROM jsonb_array_elements(data->'boxes') b) AS box_statuses
FROM orders
WHERE tenant_id='casabe-xpress'
  AND jsonb_array_length(COALESCE(data->'boxes','[]'::jsonb)) > 0
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(data->'boxes') b WHERE b->>'status' IS DISTINCT FROM data->>'status');
-- EXPECT: 18 rows

-- BACKFILL: set every box's status (and orderStatus) to the order-level status.
UPDATE orders o
SET data = jsonb_set(
  o.data,
  '{boxes}',
  (SELECT jsonb_agg(
     b || jsonb_build_object('status', o.data->>'status', 'orderStatus', o.data->>'status')
   ) FROM jsonb_array_elements(o.data->'boxes') b)
),
updated_at = now()
WHERE o.tenant_id='casabe-xpress'
  AND jsonb_array_length(COALESCE(o.data->'boxes','[]'::jsonb)) > 0
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(o.data->'boxes') b WHERE b->>'status' IS DISTINCT FROM o.data->>'status');
-- EXPECT: UPDATE 18

-- VERIFY: re-run the PREVIEW query → EXPECT 0 rows.
```
**ROLLBACK:** there is no clean rollback for the prior per-box values (they were stale anyway).
If needed, the box `history[]` array retains the timeline. Capture the 18 ids + box arrays before
applying if a rollback snapshot is required.

### Part B (WRITE-PATH, app code): propagate order status → boxes on every status change
The status-change handler(s) that set `data.status` must also map over `data.boxes` and set each
box's `status`/`orderStatus`. This prevents NEW divergence after the backfill. This is the durable
fix; Part A only cleans existing rows.
- Locate the order status mutation (HQ/Office "Apply Status Change", batch lock, driver actions).
- Where it writes `{status: newStatus}` to order data, also write boxes[].status = newStatus.
- NOTE: boxes that have been SPLIT to a different shipment may legitimately have independent
  status — confirm with Jeffrey whether ALL boxes follow the order status, or only unsplit boxes.
  Current data shows the 18 stale orders are simple (1 box each), so the safe scope is: propagate
  to boxes that share the order's shipment / have no independent shipmentId.

## Recommendation
- Part A: apply now (Tier-2 data cleanup, standing permission, no fence touched). Verifiable.
- Part B: stage the code change; needs the split-box question answered by Jeffrey before the
  propagation rule is finalized (could over-write a legitimately-independent split box status).
- ShipmentTester re-run after Part A to confirm tracker == HQ within T=5s.
