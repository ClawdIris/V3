# DELTA QA REVIEW — test-tenant-policy-fix.sql
**Reviewer:** Delta (QA/Debugger, Casabe Konnect)  
**File:** `~/casabe-v3/smoke-setup/test-tenant-policy-fix.sql`  
**Review type:** Read-only static analysis  
**Date:** 2026-06-10

---

## Structure Checks

- ✅ **PASS** — Wrapped in `BEGIN; ... COMMIT;` (lines 9 & 15)
- ✅ **PASS** — Three `DROP POLICY IF EXISTS` statements present:
  - `test_tenant_anon_read   ON public.orders` (line 11)
  - `test_tenant_anon_insert ON public.orders` (line 12)
  - `test_tenant_anon_update ON public.orders` (line 13)
- ✅ **PASS** — `IF EXISTS` guard on all three statements; safe to run even if a policy is already absent

---

## Verification Queries

- ✅ **PASS** — First verify query (lines 19–26): `SELECT` from `pg_policies` filtering by the three named policies; expects 0 rows post-commit. Comment "Expected: 0 rows" present.
- ✅ **PASS** — Second verify query (lines 28–32): `SELECT` from `pg_policies` WHERE `'anon' = ANY(roles)` on `orders`; confirms no anon policies remain at all. Comment "Expected: 0 rows" present.
- ✅ **PASS** — Both queries are `SELECT` only — no side effects.

---

## Rollback Block

- ✅ **PASS** — Rollback block present as commented transaction (lines 34–42), wrapped in `-- BEGIN; ... -- COMMIT;`
- ✅ **PASS** — Rollback recreates all three policies correctly:
  - `test_tenant_anon_read` — `FOR SELECT TO anon USING (tenant_id = 'test-tenant')` ✓
  - `test_tenant_anon_insert` — `FOR INSERT TO anon WITH CHECK (tenant_id = 'test-tenant')` ✓
  - `test_tenant_anon_update` — `FOR UPDATE TO anon USING (tenant_id = 'test-tenant') WITH CHECK (tenant_id = 'test-tenant')` ✓

---

## Impact Check

- ✅ **PASS** — Only `DROP POLICY` statements in the transaction body — no `ALTER TABLE`, no DDL, no schema changes beyond the three named policies.
- ✅ **PASS** — Production casabe-xpress tenant: **unaffected**. All three dropped policies are scoped to `tenant_id = 'test-tenant'` (confirmed in rollback recreations). No casabe-xpress policies referenced or altered.
- ✅ **PASS** — Authenticated smoke accounts (HQ / Office / Driver A / Driver B): **unaffected**. These accounts use `auth.uid()`-based RLS policies, not anon role policies. Dropping `anon` policies has zero effect on authenticated sessions.
- ✅ **PASS** — `?debug=1` flow confirmed uses authenticated accounts only.  
  Evidence from `index.html` (line ~24308–24379):  
  > *"Real Supabase Auth · test-tenant only"* — the debug buttons call `promptTestLogin()` which triggers Supabase email/password sign-in. Access token is used for all `supaFetch` calls (line 16620: `s.data.session.access_token || SUPABASE_ANON_KEY`). No anon order access needed.

### `index.html` anon/test-tenant reference audit

Searched `~/casabe-v3/index.html` for all `anon` and `test-tenant` strings. Findings:

| Line | Reference | Safe? |
|------|-----------|-------|
| 50 | `SUPABASE_ANON_KEY` init (Supabase JS client setup — the `apikey` header, not an auth role) | ✅ Safe — standard Supabase pattern; not an anon-role orders query |
| 16612–16615 | `supaFetch`: uses authenticated JWT for Authorization; falls back to anon key only if no session (pre-login state, no orders data accessible) | ✅ Safe — pre-auth fallback; no authenticated order data is returned to an unauthenticated user |
| 17161–17169 | Same pattern in a second `supaFetch` context | ✅ Safe — same reasoning |
| 24326 | UI label: `"🔬 SMOKE TEST LOGIN · test-tenant"` — display string only | ✅ Safe — no query |
| 24377 | UI label: `"Real Supabase Auth · test-tenant only"` — display string only | ✅ Safe — no query |
| 27889 | Comment: `"RLS: HQ all, Office own tenant, Driver read-only, anon blocked."` | ✅ Safe — documentation comment |
| 29937 | `lookup_tracking` RPC call uses anon-callable SECURITY DEFINER function — returns **non-PII tracking status only**, not order data | ✅ Safe — this is the public package tracker; not affected by the three dropped policies |
| 30314–30316 | Smoke test assertion: `"P1: anon blocked policy present in schema"` | ✅ Safe — this asserts anon *is* blocked, which is consistent with dropping these policies |

**No code paths rely on anon access to `orders` table data.** The `lookup_tracking` RPC is the only anon-callable DB path and it is SECURITY DEFINER (bypasses RLS on its own terms). All order queries go through authenticated `supaFetch`.

---

## Summary

| Category | Result |
|----------|--------|
| Structure | ✅ PASS |
| Verification queries | ✅ PASS |
| Rollback block | ✅ PASS |
| Schema-only changes | ✅ PASS |
| casabe-xpress unaffected | ✅ PASS |
| Smoke accounts unaffected | ✅ PASS |
| `?debug=1` auth-only confirmed | ✅ PASS |
| anon/test-tenant code audit | ✅ PASS — no risky references found |

**Impact:** SAFE  
**Regression risk:** None

---

## Final Verdict

# ✅ APPROVED FOR JEFE SIGN-OFF

Migration is clean, complete, and safe. All three test-tenant anon policies are dropped with IF EXISTS guards. Rollback is correctly specified. No production tenants or authenticated users are affected. No code paths in `index.html` rely on anon order access.
