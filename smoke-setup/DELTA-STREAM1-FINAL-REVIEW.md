# Delta Stream 1 — Final Re-Review
**Reviewer:** Delta (QA/Debugger)
**Date:** 2026-06-10
**Scope:** R1 RPC + Migration final sign-off

---

## Step 0 — Live DB Column Check (orders-column-check.sql)

Query executed against live Supabase DB (read-only, via Supabase JS client with anon key).

**Live top-level columns on `public.orders`:**
```
id, tenant_id, data, updated_at, office_id, partner_id, pickup_location,
lat, lon, coordinate_status, coordinate_updated_at, coordinate_updated_by,
sms_opted_in, whatsapp_opted_in, consent_recorded_at, consent_recorded_by
```

### Definitive answers:

| Question | Answer |
|---|---|
| Does a top-level `status` column exist? | **NO** |
| Does a top-level `updated_at` column exist? | **YES** |

**Implications:**
- `status` is NOT a top-level column → JSONB path patch (`data->>'status'` / `jsonb_set`) is **required and correctly implemented**.
- `updated_at` IS a top-level column → `SET updated_at = NOW()` in the RPC is **safe and valid**.
- No blocker on `updated_at`.

**Additional observations (per orders-column-check.sql guidance):**
- New routes-rebuild columns (`geocoded_lat`, `geocoded_lng`, `address_confidence`, `route_id`, `route_sequence`) are **NOT yet present** — correct, migrations have not been applied yet.
- `delivery_address` is **NOT present** as a top-level column — flagged for Forge: `confirm_order_address` RPC (Migration 05) writes `delivery_address = p_address`; this column must be added or the RPC will fail at runtime. This is a **routes-rebuild gate item**, not a Stream 1 blocker.

---

## Step 1 — `smoke-setup/update-driver-status-rpc.sql`

| Check | Result | Notes |
|---|---|---|
| Reads status via `data->>'status'` | ✅ PASS | Line: `SELECT data->>'status', tenant_id INTO v_current_status, v_tenant_id` |
| Writes via `jsonb_set(data, '{status}', to_jsonb(p_new_status), false)` | ✅ PASS | `SET data = jsonb_set(data, '{status}', to_jsonb(p_new_status), false)` |
| `false` flag present in jsonb_set | ✅ PASS | Fourth argument is `false` — correctly prevents key creation if absent |
| `updated_at = NOW()` — only acceptable if Step 0 confirms top-level `updated_at` exists | ✅ PASS | Step 0 confirms `updated_at` IS a top-level column. Line is safe. |
| No other JSONB fields touched (payment, customer, assignedDriver untouched) | ✅ PASS | UPDATE only writes `data` (via jsonb_set — status key only) and `updated_at`. All other columns/JSONB fields untouched. |
| SECURITY DEFINER + SET search_path = '' present | ✅ PASS | `SECURITY DEFINER` and `SET search_path = ''` both present in function definition |
| Auth checks in correct order: is_member → get_user_role = 'driver' → can_access_order | ✅ PASS | Order: (1) `is_member(tenant_id)`, (2) `get_user_role() != 'driver'`, (3) `can_access_order(p_order_id)` |
| Transition map is correct (confirmed) | ✅ PASS | `ready_pickup→in_warehouse`, `ready_pickup→attempted`, `need_box→box_dropped_off`, `need_box→attempted`, `attempted→ready_pickup` — matches confirmed index.html driver UI |
| GRANT EXECUTE present | ✅ PASS | `GRANT EXECUTE ON FUNCTION public.update_driver_status(TEXT, TEXT) TO authenticated;` |
| Rollback DROP FUNCTION present | ✅ PASS | `-- DROP FUNCTION IF EXISTS public.update_driver_status(TEXT, TEXT);` (commented block) |
| Returns JSONB with success, order_id, new_status | ✅ PASS | `RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'new_status', p_new_status)` |

**Step 1 verdict: ✅ PASS — all 11 checks pass**

---

## Step 2 — `smoke-setup/forbidden-write-tests.md`

| Check | Result | Notes |
|---|---|---|
| Test F: checks `order.data.status` after RPC (not `order.status`) | ✅ PASS | `order.data.status === 'in_warehouse'` — correct JSONB path |
| Test F: re-fetches from DB to confirm persistence | ✅ PASS | Second `supabase.from('orders').select('data').eq('id', 'SMOKE-001').single()` after RPC call |
| Test G: tests invalid transition from terminal state | ✅ PASS | Attempts `in_warehouse → need_box`; asserts error with `'invalid transition'` in message |
| Test G: note present that catch block must be verified in index.html | ✅ PASS | Note present: "Delta must verify the catch is present at review" |
| Tests A–E still present and unchanged | ✅ PASS | All 5 tests (payment field, assignment field, customer data, Driver B cross-read, cross-tenant) intact and unmodified |

**Step 2 verdict: ✅ PASS — all 5 checks pass**

---

## Step 3 — `index.html` driver RPC call (~lines 25741–25791)

| Check | Result | Notes |
|---|---|---|
| `supabase.rpc('update_driver_status', { p_order_id: id, p_new_status: newStatus })` present | ✅ PASS | Lines 25756–25759 |
| `setOrders` called ONLY on success (inside `.then()` after `if (res.error)` guard) | ✅ PASS | `setOrders` is inside `.then()`, gated behind `if (res.error) { notify(...); return; }`. Not called on error path. |
| `.catch()` block present — calls `notify(...)`, does NOT call `setOrders` | ✅ PASS | `['catch'](function(err) { notify('❌ Status update failed...'); })` — no `setOrders` call inside catch |
| Local state update uses `o.data.status` (not `o.status`) | ✅ PASS | `data: Object.assign({}, o.data, { status: newStatus })` — updates JSONB data path, not top-level |
| HQ/Office path still uses `_db.upsert()` — unchanged | ✅ PASS | `else { setOrders(updatedOrders); _db.upsert("orders", id, updatedOrder); }` at line 25790–25791 |
| No other `_db.upsert` calls in driver-only execution path | ✅ PASS | The `if (roleKey === "driver")` block contains only the RPC try/catch. The `_db.upsert("orders", ...)` calls at lines 25549, 25635, 25888, 28771, 28793, 29417, 29454, 29615 are all in non-driver contexts (HQ/Office order save, void, box status, POS). None are inside a `roleKey === "driver"` gate. |

**⚠️ ADVISORY NOTE (non-blocking):** The optimistic `updatedOrder` object built at lines 25711–25736 uses a top-level `status: newStatus` field (mirror of the in-memory JS object structure). This is used as a local state shadow inside `setOrders(updatedOrders)` in the non-driver branch. In the driver branch, `setOrders` is correctly rewritten to use `o.data.status` — so the driver path is clean. The `updatedOrder.status` field is only ever read by the non-driver `_db.upsert` call. No correctness issue.

**Step 3 verdict: ✅ PASS — all 6 checks pass**

---

## Step 4 — `smoke-setup/orders-driver-rls-migration.sql`

| Check | Result | Notes |
|---|---|---|
| Wrapped in BEGIN/COMMIT transaction | ✅ PASS | `BEGIN;` at top, `COMMIT;` after Step 6 |
| `orders_driver_update` absent (no reference at all) | ✅ PASS | Confirmed via full file review: `orders_driver_update` does not appear anywhere in the file |
| 5 policies only: hq_office_select, driver_select, hq_office_insert, hq_office_update, hq_office_delete | ✅ PASS | Exactly 5 `CREATE POLICY` statements: `orders_hq_office_select`, `orders_driver_select`, `orders_hq_office_insert`, `orders_hq_office_update`, `orders_hq_office_delete` |
| Rollback is a commented transaction block | ✅ PASS | `-- BEGIN; ... COMMIT;` rollback section is a commented block |

**Step 4 verdict: ✅ PASS — all 4 checks pass**

---

## Stream 1 Summary

| Step | File | Verdict |
|---|---|---|
| Step 0 | Live DB query (orders columns) | ✅ PASS |
| Step 1 | `smoke-setup/update-driver-status-rpc.sql` | ✅ PASS |
| Step 2 | `smoke-setup/forbidden-write-tests.md` | ✅ PASS |
| Step 3 | `index.html` driver RPC section | ✅ PASS |
| Step 4 | `smoke-setup/orders-driver-rls-migration.sql` | ✅ PASS |

### Column check results:
- **`updated_at` top-level column exists:** YES ✅
- **`status` top-level column exists:** NO ✅ (JSONB patch correctly required and applied)

### Advisory (not blocking R1):
- `delivery_address` column is absent from `public.orders`. The `confirm_order_address` RPC in Migration 05 writes to this column. Forge must add `delivery_address TEXT` via a migration before deploying that RPC. Routes-rebuild gate item — does not affect Stream 1.

---

## Stream 1 Final Verdict

# ✅ APPROVED FOR JEFE SIGN-OFF

All 26 checks across Steps 0–4 pass. No blockers. No revisions required on Stream 1 files.
`updated_at` top-level column confirmed present — RPC `SET updated_at = NOW()` is safe.
`status` top-level column confirmed absent — JSONB path implementation is correct and required.
