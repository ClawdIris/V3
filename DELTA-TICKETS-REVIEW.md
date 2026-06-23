# DELTA QA REVIEW — Casabe Konnect Security Sprint
**Reviewer:** Delta (QA/Debugger)  
**Date:** 2026-06-10  
**Scope:** Tickets 1, 2, 3, 4, and 6 — Files only, no deployment, no Supabase writes  
**Status:** See per-ticket verdicts below

---

> ⚠️ **SECOND-PERSON REVIEW REQUIRED** — T1, T2, and T3 touch the real-money payment path.  
> Jeffrey requires a second-person review on T1/T2/T3 before merge. **Do not deploy without a second reviewer sign-off.**

---

## TICKET 1 — stripe-checkout/index.ts (C1 STOP-SHIP)

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | `amount_cents` from request body completely ignored (not used in any calculation) | ✅ PASS | Destructured out of body at line 116; only `order_id`, `invoice_id`, `currency`, `description` extracted. Logged as warning if present (line 118–122). Never touches computation path. |
| 2 | JWT validated via `supabase.auth.getUser()` — `user_id` from JWT, never from body | ✅ PASS | Lines 68–76: caller-scoped Supabase client built from JWT header; `callerClient.auth.getUser()` called; `userId = user.id` from auth response. |
| 3 | `tenant_id` derived server-side from `public.members` using `user_id` — never from request body | ✅ PASS | Lines 80–93: service-role client queries `members` table `.eq('user_id', userId).eq('active', true)`; `jwtTenantId = memberRow.tenant_id`. |
| 4 | Order lookup: `WHERE id = order_id AND tenant_id = jwtTenantId` — both conditions present | ✅ PASS | Lines 134–138: `.eq('id', order_id).eq('tenant_id', jwtTenantId)`. Both conditions enforced. |
| 5 | Returns 403 if order not found OR tenant mismatch | ✅ PASS | Lines 140–148: logs error, returns `{ error: 'forbidden' }` with status 403. |
| 6 | Amount computed from `order.data.payment.amount` or invoice total — server-derived only | ✅ PASS | Lines 158–173: primary path reads `paymentBlock.amount` (dollars → cents); fallback reads `orderData.invoiceTotal` / `orderData.totalAmount`. Both server-stored fields. |
| 7 | `unit_amount` passed to Stripe = derived cents, not anything from request | ✅ PASS | Line 205: `unit_amount: derivedAmountCents`. Variable set only from order data. `amount_cents` from request is never referenced in the assignment chain. |
| 8 | `metadata.tenant_id` = JWT-derived tenant, not client-supplied | ✅ PASS | Line 217: `tenant_id: jwtTenantId`. The comment confirms: "Always JWT-derived, never client-supplied." |
| 9 | Acceptance test comment present (C1) | ✅ PASS | Lines 235–239: ACCEPTANCE TEST (C1) block present with correct smoke test description. |
| 10 | No `amount_cents` reference in computation path | ✅ PASS | Confirmed: `amount_cents` appears only in type declaration (line 101), the guard check (line 118), and the warning log (line 121). Never feeds into `derivedAmountCents` or `unit_amount`. |

**T1 Verdict: ✅ APPROVED**

---

## TICKET 2 — stripe-webhook/index.ts, checkout.session.completed (C2 STOP-SHIP)

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | No `.update({ stripe_session_id: ..., payment: ... })` to top-level columns | ✅ PASS | No direct `.update()` on orders in the completed branch. All writes go through RPC. |
| 2 | Uses `merge_stripe_payment_completed` RPC | ✅ PASS | Line 144: `supabase.rpc('merge_stripe_payment_completed', {...})`. |
| 3 | RPC call passes: `order_id`, `tenant_id`, `stripe_session_id`, `payment_status`, `payment_method` | ✅ PASS | Lines 145–149: `p_order_id`, `p_tenant_id`, `p_session_id`, `p_payment_status: 'paid'`, `p_payment_method: 'stripe'`. All 5 params present. |
| 4 | Tenant isolation: `tenant_id` sourced from Stripe session metadata (`metaTenantId`) | ✅ PASS | Line 106: `metaTenantId = session.metadata?.tenant_id`. Used in order verification (line 115) and passed to RPC (line 146). |
| 5 | If `metaTenantId` missing or mismatched: rejected, no write | ✅ PASS | Lines 108–113: if `!orderId \|\| !metaTenantId` → 400 error. Lines 115–127: if order lookup fails (mismatched tenant) → writes a rejected event record and returns 400. No data written to order. |
| 6 | Acceptance test comment (C2) with SQL verify query | ✅ PASS | Lines 319–330: full ACCEPTANCE TEST (C2) block with SQL verify query checking `data->'payment'->>'status'` and top-level `stripe_session_id` must be NULL. |
| **Cross-check** | `merge_stripe_payment_completed` defined in migration | ✅ PASS | Defined in H3 section of migration. |
| **Cross-check** | Function signature matches webhook call | ✅ PASS | SQL params: `p_order_id TEXT, p_tenant_id TEXT, p_session_id TEXT, p_payment_status TEXT, p_payment_method TEXT` — exactly matches the 5 keys in the webhook RPC call object. |
| **Cross-check** | Function writes to `data` JSONB, not top-level columns | ✅ PASS | SQL body uses `data = data \|\| jsonb_build_object('stripe_session_id', ...) \|\| jsonb_build_object('payment', COALESCE(data->'payment', ...) \|\| ...)`. No top-level column writes. |
| **Cross-check** | Function is `SECURITY DEFINER SET search_path = ''` | ✅ PASS | Migration confirms both attributes on `merge_stripe_payment_completed`. |
| **Cross-check** | Function immediately `REVOKE EXECUTE FROM anon, authenticated` | ✅ PASS | Migration: `REVOKE EXECUTE ON FUNCTION public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT) FROM anon, authenticated` immediately follows the function definition. |

**T2 Verdict: ✅ APPROVED**

---

## TICKET 3 — stripe-webhook/index.ts, refund + failure branches (H2/H3)

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | `charge.refunded` branch calls `merge_stripe_payment_status` with `'refunded'` | ✅ PASS | Lines 274–277: `p_payment_status: 'refunded'`. |
| 2 | `payment_intent.payment_failed` branch calls `merge_stripe_payment_status` with `'failed'` | ✅ PASS | Lines 211–214: `p_payment_status: 'failed'`. |
| 3 | Both verify tenant before writing | ✅ PASS | Both branches: order lookup with `.eq('id', ...).eq('tenant_id', ...)` at lines 263–268 (refund) and 200–205 (failed); no write if mismatch. |
| 4 | Both handle missing metadata gracefully (no crash if `order_id` absent) | ✅ PASS | Both branches gate the RPC call with `if (refundOrderId && refundTenantId)` / `if (failOrderId && failTenantId)`. Missing metadata logs a message (lines 223, 286) and skips to event-processed update — no crash. |
| 5 | `merge_stripe_payment_status` defined in migration — signature matches calls | ✅ PASS | SQL: `p_order_id TEXT, p_tenant_id TEXT, p_payment_status TEXT`. Webhook calls pass exactly `p_order_id`, `p_tenant_id`, `p_payment_status`. Perfect match. |
| 6 | Function writes `data.payment.status = status` (inside JSONB, not top-level) | ✅ PASS | SQL body: `data = data \|\| jsonb_build_object('payment', COALESCE(data->'payment', ...) \|\| jsonb_build_object('status', p_payment_status))`. Confirmed JSONB-only write. |

**T3 Verdict: ✅ APPROVED**

---

## TICKET 4 — stripe-security-migration.sql

### Overall Structure

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | Entire migration wrapped in `BEGIN; ... COMMIT;` | ✅ PASS | Lines 76/396 (main migration). The rollback block has its own BEGIN/COMMIT inside the `/* ... */` comment — not executed. |
| 2 | All 4 changes in correct order: N2 → N1 → H3 → M2 | ✅ PASS | Migration proceeds: N2 (lines 78–135) → N1 (lines 145–160) → H3 (lines 162–299) → M2 (lines 301–394). |
| 3 | Rollback block present (commented transaction) | ✅ PASS | Lines 15–71: full rollback block inside `/* ... */`. |
| 4 | POST-COMMIT VERIFY block present | ✅ PASS | Lines 399–445: V1 through V7 verification queries present. |

---

### Change 1 — N2: Driver UPDATE Policy

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | `orders_driver_update` policy: USING + WITH CHECK both present | ✅ PASS | Lines 88–100: both `USING (...)` and `WITH CHECK (...)` clauses present. |
| 2 | Both clauses use `is_member(tenant_id) AND get_user_role() = 'driver' AND can_access_order(id)` | ✅ PASS | Both clauses are identical, all three conditions present. |
| 3 | `restrict_driver_order_update()` trigger function: `SECURITY DEFINER SET search_path = ''` | ✅ PASS | Lines 104–107 confirm both attributes. |
| 4 | Trigger blocks: payment changes, customer changes, assignedDriver + assignedDriverUserId | ✅ PASS | Lines 112–123: three distinct blocks for payment, customer, and assignment fields. |
| 5 | Trigger created: `BEFORE UPDATE ON public.orders FOR EACH ROW` | ✅ PASS | Lines 129–132: `BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.restrict_driver_order_update()`. |
| 6 | No conflict with `orders_hq_office_update` / `orders_driver_select` | ✅ PASS | Neither existing policy name appears in the migration. The new policy is scoped to `driver` role only and is idempotent via `DROP POLICY IF EXISTS` on line 85. |

**⚠️ FLAG — N2: SECURITY DEFINER assumption unverified for RLS helpers**

The new `orders_driver_update` policy calls `is_member(tenant_id)`, `get_user_role()`, and `can_access_order(id)` directly in its `USING`/`WITH CHECK` expressions. Simultaneously, H3 **revokes** `EXECUTE` on all three functions from `anon, authenticated`.

Under standard PostgreSQL rules, if a function referenced in an RLS `USING` expression is **not** `SECURITY DEFINER`, the querying user must hold `EXECUTE` privilege on that function. After the REVOKE, `authenticated` users would no longer hold it, which would **break the RLS policy** for all driver `UPDATE` queries.

The migration's comment (line 167–178) asserts these are all `SECURITY DEFINER`, which would make REVOKE safe. **However, the migration does not define these pre-existing functions, so their `SECURITY DEFINER` status cannot be verified from the file alone.** This must be confirmed as a **pre-flight check** against the live schema before applying.

**Pre-flight SQL required before applying:**
```sql
SELECT proname, prosecdef
FROM pg_proc
WHERE proname IN ('is_member', 'get_user_role', 'can_access_order')
  AND pronamespace = 'public'::regnamespace;
-- All three must have prosecdef = true
```

If any returns `prosecdef = false`, either:  
(a) Add a SECURITY DEFINER wrapper for that function before applying, or  
(b) Remove REVOKE for that specific function from H3.

**This is a CONDITIONAL BLOCK — safe to proceed only after pre-flight confirms all three are `SECURITY DEFINER`.**

---

### Change 2 — N1: Backfill assignedDriverUserId

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | Uses `members.display_name` (confirmed correct column) | ✅ PASS | Line 156 uses `m.display_name`. Note in lines 141–145 confirms column was validated against frontend query `.select('user_id, display_name')` and login handler. |
| 2 | `WHERE (o.data->>'assignedDriverUserId') IS NULL` — only updates unset UUIDs | ✅ PASS | Line 158: `(o.data->>'assignedDriverUserId') IS NULL` condition present. |
| 3 | `AND m.role = 'driver' AND m.user_id IS NOT NULL` — only real driver members | ✅ PASS | Lines 159–160: both conditions present. |
| 4 | `jsonb_set(..., true)` — `true` = create key if absent | ✅ PASS | Line 151: `jsonb_set(o.data, '{assignedDriverUserId}', to_jsonb(m.user_id::text), true)`. |
| 5 | No risk of overwriting already-set UUIDs | ✅ PASS | Protected by `IS NULL` guard on line 158. Idempotent; re-running is safe. |

**N1 Verdict: ✅ APPROVED**

---

### Change 3 — H3: REVOKE on Internal Functions + Stripe RPCs

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | `DO $$` block to skip missing functions gracefully | ✅ PASS | Lines 192–239: `DO $$` block with `IF EXISTS` guards for each conditional REVOKE. |
| 2 | REVOKE covers: `get_user_role`, `get_user_office_ids`, `is_hq`, `is_admin`, `is_member`, `current_tenant_id` — and others | ✅ PASS | Direct REVOKE on lines 185–186; DO $$ block covers `is_hq`, `is_admin`, `is_member`, `current_tenant_id`, `get_user_tenant_id`, `can_access_order`, `log_commission_change`, `restrict_driver_order_update`. |
| 3 | `lookup_tracking` explicitly NOT revoked — rate limiting TODO noted | ✅ PASS | Lines 241–245: explicit note that `lookup_tracking` is intentionally kept public; TODO for rate limiter documented. |
| 4 | `merge_stripe_payment_completed` and `merge_stripe_payment_status` defined AND immediately revoked | ✅ PASS | Both functions defined and immediately followed by `REVOKE EXECUTE ... FROM anon, authenticated`. |
| 5 | No REVOKE on functions in RLS USING without SECURITY DEFINER wrapper — per migration's own rule | ⚠️ CONDITIONAL | See FLAG above under N2. The migration revokes `is_member`, `get_user_role`, and `can_access_order` which are used in the new N2 RLS policy. Safe ONLY if all three are `SECURITY DEFINER` in the live schema. |

**H3 Verdict: ⚠️ CONDITIONAL — requires pre-flight SECURITY DEFINER confirmation**

---

### Change 4 — M2: Pin search_path

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | All 4 functions get `SET search_path = ''` | ✅ PASS | `generate_receipt_number` (line 322), `generate_invoice_number` (line 345), `calculate_invoice_total` (line 363), `update_invoice_timestamp` (line 382): all have `SET search_path = ''`. |
| 2 | All table references schema-qualified (`public.` prefix) | ✅ PASS | `FROM public.payment_receipts` (line 336), `FROM public.invoices` (line 356). No bare table refs in M2 function bodies. |
| 3 | Full function bodies preserved — no logic changed, only `search_path` added | ✅ PASS | Bodies match pre-M2 rollback block originals. Logic untouched: receipt counter, invoice counter, sum formula, trigger body. |
| 4 | All 4 functions present: `generate_receipt_number`, `generate_invoice_number`, `calculate_invoice_total`, `update_invoice_timestamp` | ✅ PASS | All four confirmed present. |

**M2 Verdict: ✅ APPROVED**

---

**T4 Overall Verdict: ⚠️ CONDITIONAL BLOCK**  
- N2: ⚠️ CONDITIONAL (safe pending pre-flight SECURITY DEFINER check)  
- N1: ✅ APPROVED  
- H3: ⚠️ CONDITIONAL (same dependency as N2)  
- M2: ✅ APPROVED  

**Blocker:** Pre-flight SQL must confirm `is_member`, `get_user_role`, `can_access_order` are all `SECURITY DEFINER` before applying. Once confirmed, all checks pass.

---

## TICKET 6 — index.html catch() fixes

| # | Fix | Line | Result | Notes |
|---|-----|------|--------|-------|
| 1 | Void order sync | 25678 | ✅ PASS | `_db.upsert("orders", order.id, voided).catch(function(e){ console.error("[void order]", e); notify("⚠ Order voided locally but failed to sync — check connection"); })` — user-facing `notify()` present. |
| 2 | Batch lock sync | 28868 | ✅ PASS | `_db.upsert("orders", ord.id, updatedOrd).catch(function(e){ console.error("[lock batch box sync]", e); notify("⚠ Batch lock saved locally but failed to sync — check connection"); })` — user-facing `notify()` present. |
| 3 | Box change sync | 29460 | ✅ PASS | `_db.upsert("orders", updatedOrder.id, updatedOrder).catch(function(e){ console.error("[box change sync]", e); notify("⚠ Box change saved locally but failed to sync — check connection"); })` — user-facing `notify()` present. |
| 4 | Payment save | 17444 | ✅ PASS | `.catch(function(e){ console.error("[payment save]", e); setSavingPay(false); setPayLoadErr("Save failed — payment not recorded. Please retry."); })` — user-facing `setPayLoadErr()` present; UI renders at line 17484. |

### Remaining console-only catches (not T6 scope)

The following non-T6 console-only catches were inspected and confirmed as background/secondary paths — not primary user-action feedback paths:

| Line | Tag | Classification |
|------|-----|----------------|
| 2243 | `[logBoxStatus]` | Background telemetry POST — intentionally fire-and-forget |
| 17440 | `[audit log]` | Secondary audit trail write — payment itself already succeeded |
| 18114/18124/18138/18150 | `[audit log]` | Same — secondary audit trail |
| 25583/25696 | `[shipment save]` | Background shipment metrics recalculation — secondary sync |
| 29473 | `[shipment sync]` | Secondary shipment membership update — background |
| 16637 | `[async op]` | Background send_log load in settings panel |
| 17195 | `[async op]` | Secondary background data load |

**Note on pauseCampaign/endCampaign (lines 8958, 8968):** These ARE user-action paths (initiated by confirmation dialog), but they already call `notify(...)` after the optimistic state update — the `console.warn` catch is only for the **background persist**. The user receives the action confirmation regardless. These are pre-existing and outside T6 scope; recommend a future ticket to add notify-on-persist-failure here.

### Syntax check

- `node --check` on `.html` fails (Node.js rejects `.html` extension as ESM)
- Extracted all `<script>` blocks to `/tmp/casabe_extracted.js` (7 blocks, ~1.83M chars) and ran `node --check /tmp/casabe_extracted.js`
- **Result: Exit code 0 — PASS**

**T6 Verdict: ✅ APPROVED**

---

## Summary

| Ticket | Verdict | Blocker |
|--------|---------|---------|
| T1 — stripe-checkout/index.ts | ✅ APPROVED | — |
| T2 — stripe-webhook (checkout.session.completed) | ✅ APPROVED | — |
| T3 — stripe-webhook (refund + failure) | ✅ APPROVED | — |
| T4 — stripe-security-migration.sql | ⚠️ CONDITIONAL | Pre-flight: confirm `is_member`, `get_user_role`, `can_access_order` are `SECURITY DEFINER` |
| T6 — index.html catch() fixes | ✅ APPROVED | — |

---

## Overall: CONDITIONAL — READY FOR JEFE SIGN-OFF PENDING T4 PRE-FLIGHT

T1/T2/T3/T6 are clean and ready. T4 has one conditional item that requires a 2-minute pre-flight query against the live Supabase schema before applying the migration.

### T4 Pre-Flight Required (before applying migration)

```sql
-- Run this BEFORE applying stripe-security-migration.sql
SELECT proname, prosecdef
FROM pg_proc
WHERE proname IN ('is_member', 'get_user_role', 'can_access_order')
  AND pronamespace = 'public'::regnamespace;
-- ALL THREE must return prosecdef = true
-- If any returns false → escalate to Forge before applying
```

If all three return `prosecdef = true` → migration is **APPROVED TO APPLY** with Jefe sign-off.

---

## ⚠️ Second-Person Review Required

**Jeffrey requires a second-person review on T1, T2, and T3 before merge.** These tickets touch the live Stripe payment path (real money). No deployment of `stripe-checkout` or `stripe-webhook` Edge Functions until a second reviewer has signed off on this report and the code.

---

*Report written by Delta (QA/Debugger) — 2026-06-10*
