# CK-SMOKE-PREREQ-2 / Tenant-Slug Mismatch — Diagnosis & Staged Remediation

**Date:** 2026-06-29 · **Investigator:** FixForge · **Tier:** 3 (auth / tenant identity) — **DIAGNOSE-ONLY, awaiting Jeffrey**
**Access used:** read-only `psql` via `DATABASE_URL` in `.env.local` (app project `exayifxbqduhsxmmsnxr`). No writes performed.

## Why this is the keystone
~10 of the 12 open T2 bugs (CK-L1-001, 002, 009, 011, 012, 013, 014, 015, 016, 024) all fail with
"Cannot verify: auth times out / 0 orders in system." They are NOT independent code bugs — they
share one root cause below. Fix this and they become testable in one move.

## Root cause: two tenant slugs, one of them empty and used as the fallback
Live app DB (`exayifxbqduhsxmmsnxr`):

| tenant_id | members | orders | notes |
|---|---|---|---|
| **casabe-xpress** (no "e") | 9 (incl. smoke-hq/office/driver-a/driver-b) | **248** | REAL DATA |
| **casabe-express** (with "e") | 1 (`admin@casabexpress.com`, empty) | **0** | straggler |
| test-tenant | 0 | 19 | QA scratch |

- `smoke-hq@casabe-test.internal` (auth id `89e1cd44…`) **DOES** have a members row:
  `tenant_id=casabe-xpress, role=hq, active=true`. The ShipmentTester report's claim
  ("user exists in Auth but not in members") is **stale/incorrect** — the row exists.
- BUT the app's tenant fallback default is the WRONG slug. Three places hardcode
  `"casabe-express"` (with "e") as the default/fallback while ALL real data is under
  `"casabe-xpress"` (no "e"):
  - `index.html:22360` `getActiveTenant`: `return TENANT_DB[tenantId] || TENANT_DB["casabe-express"];`
  - `index.html:25350` `useState(getActiveTenant(session.tenantId || "casabe-express"))`
  - `TENANT_DB` (22268) is keyed ONLY `"casabe-express"` — there is no `"casabe-xpress"` entry,
    so even a correct session.tenantId='casabe-xpress' falls through to the empty default's
    display config (box sizes, destinations, offices).
- Order fetches filter `.eq("tenant_id", _db._tenantId)` (23577+). The production + test login
  paths BOTH set tenantId from the real members row (23990 / 24070) → casabe-xpress → 248 orders.
  So a successful login SHOULD see orders. The "0 orders" symptom appears when tenant resolution
  falls through to the `casabe-express` default (e.g. session.tenantId missing, or ShipmentTester
  asserting against the wrong slug).

## Two distinct problems to decide on (Jeffrey-gated)
1. **App fallback slug is wrong (Tier 1-ish display, but tenant-identity adjacent).**
   The `|| "casabe-express"` fallbacks + the `TENANT_DB` key should be `casabe-xpress` to match data.
   Safe-ish (display config), but it changes tenant identity resolution → routing through you.
2. **Data/identity decision (Tier 3 — yours).** Which slug is canonical, `casabe-xpress` or
   `casabe-express`? Options:
   a. Standardize on `casabe-xpress` (where all data is) — fix the 3 app fallbacks + add a
      `casabe-xpress` key to TENANT_DB. Lowest-risk; no data migration.
   b. Rename data `casabe-xpress` → `casabe-express` (UPDATE orders/members SET tenant_id) — a
      destructive, RLS-sensitive data migration. NOT recommended without backup.
   c. Reconcile the lone `casabe-express` owner (`admin@casabexpress.com`) into `casabe-xpress`.

## Recommended (for your approval) — Option 2a, app-side only, no data migration
Change the 3 hardcoded fallbacks from `"casabe-express"` → `"casabe-xpress"` and add a
`"casabe-xpress"` entry to `TENANT_DB` (alias the existing config). This is an app code change
(deployable via the normal main→prod path) and touches tenant-identity resolution, so per the
standing rules it needs your explicit sign-off before I push. NO database writes proposed.

## ShipmentTester harness note
If ShipmentTester's own harness queries `casabe-express`, it will keep seeing 0 orders even after
an app fix. The harness target slug must be `casabe-xpress` to match live data. Flagging so the
verification side is aligned.

## What I did NOT do
- No DB writes (read-only psql only).
- No app code change pushed (this is staged for your decision — tenant identity = gated).
