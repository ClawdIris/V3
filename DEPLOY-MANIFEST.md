# DEPLOY MANIFEST — Casabe Konnect R4
**Generated:** 2026-05-28  
**Architect:** Forge (Architecture Reviewer)  
**Branch:** codex/rebuild-unified-shell  
**Purpose:** Pre-Slice-5 deploy gate verification

---

## SECTION A — Netlify Runtime Files

> Files that Netlify must serve at deploy time.
> Scanned: `<script src>`, `<link href>` local refs, `fetch()` local calls, and `import` statements in `index.html` and `phase5-receipts-components.js`.

| File | Referenced In | Status |
|------|---------------|--------|
| `index.html` | Root entry point | ✅ EXISTS (git-tracked) |
| `phase5-receipts-components.js` | `index.html` line 42: `<script src="phase5-receipts-components.js">` | ✅ EXISTS (git-tracked) |

### Phase 6 Prep Assets (git-tracked, not yet wired into `index.html`)

| File | Status | Notes |
|------|--------|-------|
| `qrcode-generator.js` | ✅ EXISTS in git | NOT yet referenced in `index.html` or `phase5-receipts-components.js`; Phase 6 prep file; no deploy risk |

### External CDN Dependencies (not served by Netlify — informational)

| Asset | Source |
|-------|--------|
| React 18.2.0 | cdnjs.cloudflare.com |
| ReactDOM 18.2.0 | cdnjs.cloudflare.com |
| Supabase JS v2 | cdn.jsdelivr.net |
| IBM Plex Sans / Syne / IBM Plex Mono | fonts.googleapis.com |

**No local CSS files** are referenced in `index.html` — all styles are inline via the `CSS` variable.

---

## SECTION B — SQL / Migration Files (Supabase — NOT served by Netlify)

| File | Status | Notes |
|------|--------|-------|
| `phase1-data-schema.sql` | ✅ APPLIED LIVE | Confirmed: `test-phase1-live.js` 4/4 pass; `test-phase1-rls.js` 55/55 pass |
| `phase5-receipts-schema.sql` | 🚫 DO NOT RE-RUN | Applied — receipts/invoices tables live; re-run would duplicate |
| `phase6-slice2-schema.sql` | 🚫 DO NOT RE-RUN | Applied — geocoding/coordinate_overrides tables live |
| `phase6-slice4-schema.sql` | ⏳ PENDING | Awaiting Jefe manual apply to production Supabase |
| `supabase-rls-policies.sql` | ✅ APPLIED LIVE | Confirmed: RLS tests pass 55/55; anon/auth access verified via HTTP 200/206 |
| `SECURITY-FIX-PATCH.sql` | ⏳ PENDING | SECURITY-FIX-STATUS.md states: "Deployment: ⏳ Ready for manual Supabase execution"; committed to git but not yet applied |
| `PHASE6-SUPABASE-EXTENSIONS.sql` | 🚫 DO NOT APPLY | Superseded by per-slice SQL files; applying would conflict |

### ⚠️ Outstanding SQL Actions Before Slice 5 Ships

1. **`phase6-slice4-schema.sql`** — Jefe must apply this to production Supabase before Slice 5 ships
2. **`SECURITY-FIX-PATCH.sql`** — Security hardening patch must be applied to production Supabase ASAP

---

## SECTION C — Test Files

All tests run from `~/casabe-v3/`. Jest-based tests use `npx jest`; others run via `node`.

| Test File | Runner | Result | Pass / Fail |
|-----------|--------|--------|-------------|
| `test-phase0-s4.js` | node | ✅ PASS | 29 / 0 |
| `test-office-portal.js` | node | ✅ PASS | 25 / 0 |
| `test-phase1-live.js` | node | ✅ PASS | 4 / 0 |
| `test-phase1-rls.js` | node | ✅ PASS | 55 / 0 |
| `test-phase3-driver-portal.js` | node | ✅ PASS | 30 / 0 |
| `test-phase4-hq-ops.js` | node | ✅ PASS | 39 / 0 |
| `test-phase5-receipts.js` | node | ✅ PASS | 71 / 0 |
| `test-unified-shell-smoke.js` | node | ✅ PASS | 29 / 0 |
| `test-deactivation-audit.js` | node | ✅ PASS | 52 / 0 |
| `tests/phase6-slice2-geocoding.test.js` | jest | ✅ PASS | 46 / 0 |
| `tests/phase6-slice3-route-preview.test.js` | jest | ✅ PASS | 52 / 0 |
| `tests/phase6-slice4.test.js` | jest | ✅ PASS | 97 / 0 |
| `tests/runtime-full.spec.js` | jest | ❌ FAIL (pre-existing) | 0 / 0 (suite error) |
| `tests/T2-001-insurance-fraud.test.js` | jest | ✅ PASS | 31 / 0 |
| `tests/T2-002-payment-idempotency.test.js` | jest | ✅ PASS | 14 / 0 |
| `tests/T2-003-zone-spoofing.test.js` | jest | ✅ PASS | 32 / 0 |
| `tests/T2-004-commission-audit.test.js` | jest | ✅ PASS | 19 / 0 |

**Totals (excluding pre-existing failure):** 625 passed / 0 failed

### `tests/runtime-full.spec.js` — Known Pre-Existing Failure
```
Cannot find module '@playwright/test' from 'tests/runtime-full.spec.js'
```
`@playwright/test` is not installed in this environment. This failure is **pre-existing and expected** — Playwright E2E tests require a separate install step. Not a Slice 5 regression.

---

## SECTION D — Docs / Screenshots

### Markdown Files

| File |
|------|
| `BOLT.md` |
| `COMPLETION-GATES.md` |
| `PHASE1-EXECUTION-GUIDE.md` |
| `PHASE5-FINAL-DELIVERY.md` |
| `PHASE6-ARCHITECTURE.md` |
| `PHASE6-COMPLETION-MANIFEST.md` |
| `PHASE6-DELIVERABLES.md` |
| `PHASE6-IMPLEMENTATION-GUIDE.md` |
| `PHASE6-INDEX.md` |
| `PHASE6-QUICK-REFERENCE.md` |
| `SECURITY-FIX-STATUS.md` |
| `SECURITY.md` |
| `SMOKE-TEST-REPORT-FINAL.md` |

### Screenshot PNG Files

| File |
|------|
| `phase6-slice1-mapview-screenshot.png` |
| `phase6-slice1-screenshot.png` |
| `phase6-slice2-screenshot.png` |
| `phase6-slice3-screenshot.png` |
| `phase6-slice4-screenshot.png` |

---

## Netlify 404 Check

**Command run:** `cd ~/casabe-v3 && git ls-files | grep -E '\.(js|css|html)$'`

**Git-tracked JS/CSS/HTML files:**
```
apply-migration.js           ← build utility, not runtime
backend/server.js            ← Node.js backend, not Netlify-served
index.html                   ← ✅ RUNTIME
phase5-receipts-components.js ← ✅ RUNTIME (referenced in index.html)
phase6-slice3-preview.html   ← standalone preview, not main app
qrcode-generator.js          ← Phase 6 prep, not yet referenced
src/api/admin-commissions.js ← backend API, not Netlify-served
src/middleware/safety-validation.js ← backend middleware
src/middleware/zone-validation.js   ← backend middleware
test-*.js / tests/*.js       ← test files, not deployed
```

**Cross-reference check:**

| Runtime file referenced in `index.html` | In git? | 404 Risk? |
|------------------------------------------|---------|-----------|
| `phase5-receipts-components.js` | ✅ YES | ❌ NONE |
| `index.html` | ✅ YES (root) | ❌ NONE |

**No runtime file referenced in `index.html` is missing from git.**

---

## Verdict

**PENDING SQL:** `phase6-slice4-schema.sql` and `SECURITY-FIX-PATCH.sql` are not yet applied to production Supabase. However, these are **Supabase-side operations, not Netlify deploy blockers**. All Netlify-served runtime files are present and git-tracked.

**Test suite:** 625/625 pass across 16 test files. The one failure (`runtime-full.spec.js`) is a pre-existing missing-dependency issue unrelated to Slice 5 changes.

---

## ✅ FORGE_MANIFEST_APPROVED

All runtime files required by Netlify are present and git-tracked.  
No 404 risk on deploy.  
SQL pending items are Supabase-side (not deploy blockers) but must be actioned by Jefe before Slice 5 features dependent on `phase6-slice4-schema.sql` go live.
