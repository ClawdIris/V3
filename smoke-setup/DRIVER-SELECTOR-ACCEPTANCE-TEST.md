# Driver Selector Acceptance Test
**Stream:** 1 — Driver Selector Fix (R1 Blocker)  
**Author:** Forge (Dev Lead)  
**Date:** 2026-06-10 (updated R4 — hard-failure language, debug URL, Driver B isolation)  
**Status:** READY FOR DELTA REVIEW

---

## Background

The New Order form's driver dropdown previously loaded from `tenant_settings` (a static blob), which could contain drivers without real `user_id` UUIDs.  The canonical fix (Decision 2, Jeffrey 2026-06-10) replaces that with a live query to `public.members` where `role = 'driver'` AND `tenant_id = currentTenantId` AND `active = true`.

UUID-less member entries are hidden from the dropdown.  Dual-write on save: `data.assignedDriver` (display name) + `data.assignedDriverUserId` (UUID).

---

## Acceptance Steps

### Step 1 — Log in as Smoke HQ
1. Open [https://casabe-connect.netlify.app/?debug=1](https://casabe-connect.netlify.app/?debug=1)
2. Sign in with the **Smoke HQ** account credentials
3. Confirm the session loads as `roleKey = "hq"` (amber accent, HQ dashboard visible)

---

### Step 2 — Open New Order
1. Click **+ New Order** (top bar or sidebar)
2. The New Order modal opens

---

### Step 3 — Confirm Smoke Driver A appears in Assigned Driver dropdown
1. Locate the **Assigned Driver** `<select>` field
2. Open the dropdown
3. ✅ **PASS:** "Smoke Driver A" appears as a selectable option
4. ❌ **FAIL:** Dropdown is empty (only "— Unassigned —") → members query returned no rows or UUID filter removed all entries. Check `[driver-selector]` console errors.
5. ❌ **FAIL:** "Smoke Driver A" is missing but other names appear → Driver A's `members` row may be inactive or has wrong `role` value

---

### Step 4 — Create a temporary test order assigned to Smoke Driver A
1. Fill in the minimum required fields:
   - **Full Name:** `ACCEPTANCE-TEST-TEMP`
   - **Box Type:** Small
   - **Destination Country:** Dominican Republic
   - **Assigned Driver:** Select `Smoke Driver A`
   - **Status:** Order Placed
2. Click **✓ Save Order**

---

### Step 5 — Verify saved order dual-write
1. Find the saved order in the Orders list (search `ACCEPTANCE-TEST-TEMP`)
2. Open order detail / raw data
3. ✅ **PASS:** `data.assignedDriver = "Smoke Driver A"` ← display string
4. ✅ **PASS:** `data.assignedDriverUserId = <Smoke Driver A UUID>` ← real UUID from `members.user_id`
5. ❌ **FAIL:** `data.assignedDriverUserId` is empty or null → the `onChange` handler failed to resolve the UUID from the membersDrivers list

---

### Step 6 — Verify Driver RLS scoping
1. Log out from Smoke HQ
2. Log in as **Smoke Driver A**
3. Navigate to their route / order list
4. ✅ **PASS:** The `ACCEPTANCE-TEST-TEMP` order is visible to Driver A
5. Log out, log in as **Smoke Driver B**
6. ✅ **PASS:** Driver B sees **0 rows** for `ACCEPTANCE-TEST-TEMP` (UUID mismatch → RLS blocks)
7. ❌ **HARD FAIL:** If Driver B sees **ANY row belonging to Driver A's tenant**, this test **FAILS**. There is no acceptable partial pass here — cross-tenant or cross-driver row visibility is a security regression and must be escalated to Delta immediately before proceeding.

> **Note:** The `orders_driver_select` RLS policy enforces `can_access_order(id)` which checks `data->>'assignedDriverUserId' = auth.uid()::text`. Driver B's UUID will not match any order assigned to Driver A. If Driver B sees Driver A's orders, the RLS policy is broken or was not applied. This is a hard failure — do NOT mark this test as passed under any circumstances if cross-driver visibility occurs.

---

### Step 7 — Clean up temp order
1. Log back in as Smoke HQ
2. Find `ACCEPTANCE-TEST-TEMP` order
3. Archive or delete it (set status to `cancelled` or delete via admin)

---

### Step 8 — Create SMOKE-001 and SMOKE-002
Create two permanent smoke orders assigned to **Smoke Driver A**:

**SMOKE-001:**
- Full Name: `Smoke Customer 001`
- Box Type: Small
- Destination Country: Dominican Republic
- Status: **Need a Box**
- Assigned Driver: Smoke Driver A

**SMOKE-002:**
- Full Name: `Smoke Customer 002`
- Box Type: Large
- Destination Country: Dominican Republic
- Status: **Ready for Pickup**
- Assigned Driver: Smoke Driver A

After saving, confirm both orders show:
- `assignedDriver`: "Smoke Driver A"
- `assignedDriverUserId`: `<Smoke Driver A UUID>` (non-empty)

---

## Pass/Fail Summary

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 3 | Driver A in dropdown | ✅ Visible | |
| 5a | `assignedDriver` field | `"Smoke Driver A"` | |
| 5b | `assignedDriverUserId` field | `<UUID>` (non-empty) | |
| 6a | Driver A reads order | ✅ Visible | |
| 6b | Driver B reads order | 0 rows (**HARD FAIL if any rows appear**) | |
| 8a | SMOKE-001 saved with UUID | ✅ | |
| 8b | SMOKE-002 saved with UUID | ✅ | |

---

## Notes for Delta

- The `membersDrivers` state is loaded via `useEffect` keyed on `session.tenantId` — it fires at login and populates before the New Order modal is typically opened.
- If the dropdown still shows no drivers: open the browser console and check for `[driver-selector] members query failed:` errors (RLS, wrong tenant_id, or network issue).
- `assignedDriverUserId` is written only if a UUID was found in `membersDrivers`; a null UUID means the selected driver had no `user_id` in `members` (UUID-less entries are now hidden, so this should not occur post-fix).
- The `can_access_order()` function reads `app_role`, not `role`. Ensure Smoke Driver A has BOTH `role = 'driver'` AND `app_role = 'driver'` in `public.members` (see DELTA-PREFLIGHT-RESULTS.md Check 3 critical note).
- **Driver B visibility is a hard failure.** If Driver B can see any row that belongs to Driver A's tenant (regardless of whether that specific row was assigned to Driver A), it means the orders RLS policies are not correctly scoped and the deployment must be halted. Debug using `?debug=1` URL parameter to expose session/role info in the UI.
- Debug URL: `https://casabe-connect.netlify.app/?debug=1`
