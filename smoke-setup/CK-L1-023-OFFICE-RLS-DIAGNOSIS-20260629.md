# CK-L1-023-RUN10 — Office Order Isolation NOT Enforced (RLS) — Diagnosis + STAGED Fix

**Date:** 2026-06-29 · **Investigator:** FixForge · **Tier:** 3 (RLS/auth) — **DIAGNOSE+STAGE ONLY, no autonomous change**
**Severity:** Critical
**Symptom:** Office worker (Ariana Hernandez, Casabe Xpress NY) sees "All (248)" — the full tenant
order set, identical to HQ. Office-level isolation is not enforced.

## Root cause (confirmed live)
The `orders_hq_office_select` policy treats HQ and office **identically**, with NO office scoping:
```
orders_hq_office_select  SELECT  (is_member(tenant_id) AND (get_user_role()='hq' OR get_user_role()='office'))
```
There is no `office_id` predicate. Any authenticated office member of the tenant sees every order
in the tenant. Same for `orders_hq_office_update` and `orders_hq_office_delete`.

## Building blocks that ALREADY exist (good news)
- **`get_user_office_ids()`** is live (returns `uuid[]`) and is ALREADY used correctly by the
  routes office policy: `office_id = ANY(get_user_office_ids())`. Proven pattern.
- **Office members have `members.office_id` populated** (the `office` and `dispatcher` users both
  carry it). HQ/owner/driver correctly have NULL office_id.
- **`offices` table** has the real office UUID (e.g. Casabe Xpress NY = `9838c5e1-...`).

## The blocker that makes this NOT a clean policy-only fix — DATA INTEGRITY
Orders store the office inconsistently:
- Only **112 / 248** casabe-xpress orders have `data->>'officeId'` set.
- Many orders have an office **name** (`data->>'office'`) but a BLANK `officeId`
  (e.g. "Casabe Xpress NY" with empty officeId; also "Atlantic Travel", "Effecty" which look like
  partner/agency names, not offices).

If we add an office-scoping RLS predicate now, office users would see ONLY the 112 orders with a
matching `officeId` and LOSE visibility of the 136 orders that have no officeId — including ones
that may legitimately belong to their office by name. **That would swing from over-exposure to
under-exposure.** So the policy fix must be paired with an officeId backfill.

## STAGED FIX (Jeffrey sign-off required — Tier 3, touches RLS)

### Step 1 (DATA, Jeffrey-gated): backfill orders.data.officeId from office name
```sql
-- Match orders' office NAME to the offices table to populate missing officeId.
-- PREVIEW first:
SELECT o.id, o.data->>'office' AS office_name, off.id AS resolved_office_id
FROM orders o
JOIN offices off ON off.tenant_id=o.tenant_id AND lower(trim(off.name))=lower(trim(o.data->>'office'))
WHERE o.tenant_id='casabe-xpress' AND COALESCE(o.data->>'officeId','')='';
-- Then backfill only exact name matches; orders whose 'office' is a partner/agency
-- (Atlantic Travel, Effecty) or blank are left for Jeffrey to triage (they may not be office-scoped).
```

### Step 2 (RLS, Jeffrey-gated): split HQ and office SELECT/UPDATE/DELETE policies
Mirror the proven routes pattern. Replace the combined policy with:
```sql
-- HQ: full tenant visibility (unchanged scope, explicit role)
CREATE POLICY orders_hq_select ON public.orders FOR SELECT TO authenticated
  USING (is_member(tenant_id) AND get_user_role()='hq');
-- Office: scoped to their office_id(s)
CREATE POLICY orders_office_select ON public.orders FOR SELECT TO authenticated
  USING (is_member(tenant_id) AND get_user_role()='office'
         AND (data->>'officeId')::uuid = ANY(get_user_office_ids()));
-- (repeat the HQ-full / office-scoped split for UPDATE and DELETE)
-- DROP the old combined orders_hq_office_select / _update / _delete.
```
**OPEN QUESTIONS for Jeffrey before apply:**
1. Orders whose `office` is a partner/agency name (Atlantic Travel, Effecty) or blank — should
   office users see them at all? (They have no office_id to scope by.)
2. Should office UPDATE/DELETE also be office-scoped, or only SELECT? (Recommend all three for
   true isolation.)
3. Confirm every office user's `members.office_id` is correct before enabling — a wrong/missing
   office_id would blind that user to all orders.

## Why this is NOT applied autonomously
Per standing rules, RLS/auth changes require Jeffrey's explicit per-change sign-off. This is the
hard fence. Diagnosis + staged migration provided; no policy or data change made.
ShipmentTester must verify office-isolation with a real office JWT after apply (the AT-style test:
office user sees only own-office orders, count < 248).
