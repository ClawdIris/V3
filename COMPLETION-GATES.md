# Casabe Konnect Completion Plan — Hard Pass/Fail Gates for All Phases

> Last updated: 2026-05-27
> Source: Jefe directive. This document is law. No phase is complete without all gates passing.

## Definition of Complete

A real user can log into production as HQ, Office, and Driver; create/manage an order; route boxes through office/driver workflows; generate/print/send invoices or receipts; manage partners/boxes/destinations safely; and Supabase Security Advisor has no unresolved launch-blocking warnings.

No phase is complete from marker/string tests alone. Every phase needs:
- Static tests passing.
- Live Supabase checks passing where DB is involved.
- Browser smoke passing in production.
- No role regression: HQ, Office, Driver still route correctly.
- RLS enabled on every new public table.
- No full-file overwrite that removes earlier phases.

---

## Phase Gates

### Phase 0 — Stable Shell, Invoice Print, Commission Fix
Pass: `node test-phase0-s4.js` 29/29 + production manual smoke (invoice print, partner commissions, notifications no crash).

### Phase 1 — Supabase Data Foundation
Pass: `test-phase1-live.js` 4/4 + `test-phase1-rls.js` 55/55 + RLS confirmed live on box_orders, activity_log.

### Phase 2 — Office Portal
Pass: `test-office-portal.js` 25/25 + `test-unified-shell-smoke.js` + Office portal reachable in live UI (not marker code).

### Phase 3 — Driver Portal
Pass: `test-phase3-driver-portal.js` 30/30 + Driver portal reachable in live UI + role switching works.

### Phase 4 — HQ Unified Operations
Pass: `test-phase4-hq-ops.js` 39/39 + HQ Operations visible/clickable in sidebar + all tabs + filters render.

### Phase 5 — Receipts, Invoices, Payment Links
Pass: `test-phase5-receipts.js` 71/71 + all 5 tables live in Supabase + RLS enabled + browser smoke (generate, print, copy link, WhatsApp text) + no USING(TRUE) policies + no user_profiles references.

### Phase 6 — Production Hardening
Does NOT start until Phases 0–5 pass browser smoke. Includes maps, route optimization, Tape Direct, SMS/WhatsApp production, stub/placeholder cleanup, GPS, margin tracking.

---

## Removal / Deactivation Rules

Every user-created entity must have safe remove/deactivate/archive behavior:

| Entity | Required Behavior |
|--------|------------------|
| Partners | Deactivate (hides from new orders), Reactivate |
| Box types | Archive/hide, delete only if unused |
| Destinations | Delete/deactivate; block if referenced by orders |
| Offices | Deactivate only (no hard delete if referenced) |
| Drivers | Deactivate/suspend (no hard delete if referenced) |
| Campaigns | Pause/archive |
| Notification templates | Reset to default; no hard delete required |
| Receipts/invoices | Void/archive/cancel, not hard delete |
| Payment links | Remove/clear URL; historical invoices retain sent link |

No delete action may orphan historical orders, boxes, receipts, or audit rows.

---

## Supabase Completion SQL Checks

```sql
-- 1. RLS enabled on all launch tables
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
and tablename in ('orders','box_orders','activity_log','partners','offices','payments','payment_receipts','invoices','invoice_items','box_order_invoices')
order by tablename;

-- 2. No permissive TRUE policies
select schemaname, tablename, policyname, qual, with_check from pg_policies
where schemaname = 'public'
and (qual ilike '%true%' or with_check ilike '%true%')
and tablename in ('box_orders','activity_log','payments','payment_receipts','invoices','invoice_items','box_order_invoices');

-- 3. No user_profiles references
select schemaname, tablename, policyname, qual, with_check from pg_policies
where schemaname = 'public'
and (qual ilike '%user_profiles%' or with_check ilike '%user_profiles%');

-- 4. Phase 5 tables exist
select table_name from information_schema.tables
where table_schema = 'public'
and table_name in ('payments','payment_receipts','invoices','invoice_items','box_order_invoices')
order by table_name;
```

---

## Full Regression Command Set

```bash
cd /Users/joshua/casabe-v3
git status --short
node test-phase0-s4.js
node test-office-portal.js
node test-phase1-live.js
node test-phase1-rls.js
node test-phase3-driver-portal.js
node test-phase4-hq-ops.js
node test-phase5-receipts.js
node test-unified-shell-smoke.js

node - <<'NODE'
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const scripts=[...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
fs.writeFileSync('/tmp/casabe-inline.js', scripts.join('\n;\n'));
console.log('inline scripts', scripts.length, 'bytes', fs.statSync('/tmp/casabe-inline.js').size);
NODE
node --check /tmp/casabe-inline.js
git diff --check
```

---

## Launch Readiness Checklist

- [ ] Phases 0–5 command gates pass
- [ ] Production browser smoke passes: HQ, Office, Driver
- [ ] Phase 1 + Phase 5 Supabase tables exist live
- [ ] RLS enabled on every launch table
- [ ] Security Advisor: no unresolved launch-blocking issues
- [ ] Partner deactivate/reactivate verified
- [ ] Box type archive/delete verified
- [ ] Destination delete/deactivate verified
- [ ] Receipts/invoices print and copy payment links in production
- [ ] Stripe path: Payment Links / stripe_payment_url field only — no fake generated checkout URLs
- [ ] No marker-only/stub-only code counted as feature complete
- [ ] No accidental HQ-only production bundle
- [ ] main branch = verified release bundle

---

## Team Standing Order

> Do not start new Phase 6 feature work until Phase 5 live smoke and the removal/deactivation audit pass. Every phase must be proven by tests plus production browser smoke. Marker-only tests do not count. Every new Supabase table must ship with RLS enabled and scoped policies. The job is complete only when HQ, Office, and Driver workflows work live, receipts/invoices work live, Security Advisor is clean, and every user-created config has safe deactivate/archive/delete behavior.
