# STATUS_LABELS — Intentional Customer/Admin Divergence (CK-L1-017-REGRESSION, Path 2)

**Decision (Jeffrey, 2026-06-29):** The customer-facing tracking labels are
**intentionally friendlier** than the internal admin labels. Do **NOT** unify
the customer-facing copy to the internal labels. ShipmentTester's
single-source-of-truth assertion is **narrowed** to flag only *unintended*
label defects (typos, raw-key leaks), not these deliberate UX differences.

## Why there are two label sets (by design)

| Surface | Object | Audience | Tone |
|---|---|---|---|
| HQ / Office / Driver | `STATUS_LABELS` (admin, multiple copies) | internal ops | precise, operational |
| Customer tracking page | `STATUS_MODEL.tracker.labels` (index.html ~1196) + customer-track `STATUS_LABELS` (~11061) | end customers | friendly, reassuring |

The friendly set dates to commit **`ce4f02a` (2026-05-27)** — "hotfix: restore
full app shell on production". It predates the CK-L1-017 typo fix (`15e709e`,
2026-06-28) by a month. The typo fix touched **none** of these blocks; the
"regression" was ShipmentTester's *new, stricter* cross-portal consistency
check surfacing a long-standing intentional design, not my fix breaking.

## The 13 intentional divergences (customer label ≠ admin label, BY DESIGN)

| status key | admin (internal) | customer (friendly) |
|---|---|---|
| order_placed | Order Placed | Order Confirmed |
| need_box | Need a Box | Box Being Prepared |
| box_dropped_off | Box Dropped Off | Box Delivered to You |
| ready_pickup | Ready for Pickup | Driver Picking Up Today |
| picked_up | Picked Up | Picked Up — At Warehouse |
| in_warehouse | In Warehouse | At Warehouse |
| loaded_container | Loaded in Container | Loaded for Shipment |
| en_route | En Route | In Transit to &lt;dest&gt; |
| in_customs | In Customs | At Customs |
| customs_released | Released from Customs | Customs Cleared |
| sorting | Sorting / Preparing | Sorting at Local Facility |
| in_transit | In Transit | In Transit to &lt;dest&gt; |
| delivered | Delivered | Delivered ✅ |

## What ShipmentTester SHOULD still flag (unintended defects)

- **Typos** in any label (e.g. "Wareouse" → the original CK-L1-017).
- **Raw status keys leaking** to any UI (e.g. "ready_for_pickup", "need_a_box"
  rendered instead of a human label — see CK-L1-017-RAWKEYS).
- **A key present in one set but MISSING in the other** (renders the raw key).
- **Same-surface inconsistency** (the same status rendered two different ways
  within the admin set, or within the customer set).

## What ShipmentTester must NOT flag (intentional)

- Any customer-label value differing from the admin-label value for the SAME
  key, where both pairs appear in `references/status-label-suppressions.json`.

The machine-readable allow-list lives at:
`docs/status-labels-intentional-divergence/status-label-suppressions.json`
ShipmentTester loads it and skips those (key, adminLabel, customerLabel) triples.
