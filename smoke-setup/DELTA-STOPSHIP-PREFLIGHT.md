# DELTA STOP-SHIP PREFLIGHT RESULTS

**Run:** 2026-06-10 23:27 EDT  
**Analyst:** Delta (QA/Debugger, Casabe Konnect)  
**Purpose:** Pre-migration safety check before revoking `is_hq`, `is_admin`, `current_tenant_id`, `get_user_tenant_id` from PUBLIC/anon/authenticated

---

## Query 1 — P0-3 RLS Policy Check

### ⛔ RESULT: BLOCKER — 42 rows returned

The migration **CANNOT SAFELY PROCEED** as written. All four target functions/symbols appear in live, active RLS policies. Revoking execute privileges from PUBLIC/anon/authenticated on these functions would **immediately break row-level security enforcement** across 13 tables.

---

### Breakdown by Function

#### `is_hq()` — 18 policies across 8 tables

| Table | Policy |
|-------|--------|
| activity_log | hq_can_view_all_activities |
| box_orders | hq_can_create_boxes |
| box_orders | hq_can_update_all_boxes |
| box_orders | hq_can_view_all_boxes |
| box_sale_records | bsr_hq_insert |
| box_sale_records | bsr_hq_select |
| box_sale_records | bsr_hq_update |
| box_status_log | box_status_log_hq_office_read |
| campaigns | campaigns_hq_office_insert |
| campaigns | campaigns_hq_office_select |
| campaigns | campaigns_hq_office_update |
| offices | offices_hq_write |
| partners | partners_hq_write |
| qb_sync_log | qb_sync_log_hq_read |
| send_log | send_log_hq_office_read |
| tape_direct_records | td_hq_insert |
| tape_direct_records | td_hq_select |
| tape_direct_records | td_hq_update |

#### `is_admin()` — 2 policies across 1 table

| Table | Policy |
|-------|--------|
| members | members_admin_read |
| members | members_admin_write |

#### `current_tenant_id()` — 40 policies across 13 tables

This is the most widely used function. Nearly every RLS policy in the system calls `current_tenant_id()` for tenant isolation. Tables affected:

- `activity_log` (4 policies)
- `box_order_invoices` (1)
- `box_orders` (7)
- `box_sale_records` (6)
- `box_status_log` (1)
- `campaigns` (3)
- `invoice_items` (1)
- `invoices` (2)
- `messages` (1)
- `offices` (1)
- `partners` (1)
- `payment_receipts` (1)
- `payments` (2)
- `qb_sync_log` (1)
- `send_log` (1)
- `tape_direct_records` (6)

#### `get_user_tenant_id()` — 0 policies ✅

No live RLS policies reference `get_user_tenant_id()`. This function is safe to revoke.

---

### Summary Table

| Function | Live RLS Policies Using It | Safe to Revoke? |
|----------|---------------------------|-----------------|
| `is_hq()` | 18 | ❌ BLOCKER |
| `is_admin()` | 2 | ❌ BLOCKER |
| `current_tenant_id()` | 40 | ❌ BLOCKER |
| `get_user_tenant_id()` | 0 | ✅ SAFE |

---

### Required Action Before Migration Can Proceed

The migration as written must be split or sequenced. Options:

1. **Replace-before-revoke:** Rewrite all affected RLS policies to use replacement functions/logic before revoking old ones in the same transaction or a subsequent migration.
2. **SECURITY DEFINER wrapper:** If the intent is to restrict direct caller access, convert these to `SECURITY DEFINER` functions owned by a privileged role rather than revoking from PUBLIC.
3. **Staged migration:** Apply revoke only after all 42+ policy definitions are updated to reference the new function signatures.

**Do not apply the revoke migration until all 42 dependent policies are updated.**

---

## Query 2 — Ticket 5 Auth Account Population

### Full Email Lists

#### `@casabekonnect.test` accounts (3 accounts — older, May 2026)

| Email | Created At (UTC) |
|-------|-----------------|
| test-driver@casabekonnect.test | 2026-05-15 02:23:54 |
| test-hq@casabekonnect.test | 2026-05-15 02:23:53 |
| test-office@casabekonnect.test | 2026-05-15 02:23:54 |

#### `@casabe-test.internal` accounts (4 accounts — newer, June 2026)

| Email | Created At (UTC) |
|-------|-----------------|
| smoke-driver-a@casabe-test.internal | 2026-06-11 02:14:04 |
| smoke-driver-b@casabe-test.internal | 2026-06-11 02:14:05 |
| smoke-hq@casabe-test.internal | 2026-06-11 02:14:01 |
| smoke-office@casabe-test.internal | 2026-06-11 02:14:03 |

---

### Are They Different Populations?

**YES** — confirmed distinct populations:

- `@casabekonnect.test`: 3 original test accounts, created ~May 15 2026. These are the **older test tier** — likely the leaked-credential accounts based on age and domain pattern.
- `@casabe-test.internal`: 4 smoke accounts, created ~June 11 2026 (today). These are the **fresh smoke accounts** provisioned for the current test run — safe, just created.

---

### Rotation Recommendation

**Rotate only the `@casabekonnect.test` accounts (3 accounts):**

1. `test-driver@casabekonnect.test`
2. `test-hq@casabekonnect.test`
3. `test-office@casabekonnect.test`

These are the older accounts with exposed/leaked credentials. The `@casabe-test.internal` smoke accounts were just created today and have never been exposed — **do not rotate them**.

---

## Overall Stop-Ship Verdict

| Check | Status | Action Required |
|-------|--------|-----------------|
| Query 1 – RLS policy safety | ❌ **BLOCKER** | Migration cannot proceed — 42 policies depend on functions marked for revoke |
| Query 2 – Auth account audit | ✅ INFO COMPLETE | Rotate 3 `@casabekonnect.test` accounts only |

**Bottom line: The revoke migration is a stop-ship blocker. The 3 legacy test accounts need password rotation. The 4 new smoke accounts are clean.**
