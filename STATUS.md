# Casabe Konnect R4 — Status Board
**Last updated: 2026-06-01 22:31 EDT**
**Latest commit: `ca32870` — live on Netlify**

---

## 🟢 CLOSED

| Sprint | Accepted Commit | Notes |
|---|---|---|
| Phase 6 — All items | `dddc7b4` | Verified by Codex live smoke |
| Phase 7 Slice 7.1 — Stripe scaffold | `e57de82` | Edge Functions, UI button, P6 tests |
| Phase 7 UX polish | `9f40c6e` | Payment badge, empty state, copy link |
| RoadWarrior map sprint | `ca32870` | Accepted after Codex fix (not e4a83c2) |

### RoadWarrior what shipped
- Slice A: Route Options Panel — stop filters, driver selector, Preview Only badge
- Slice B: Optimization output — route summary, ordered stop list with leg distance + Driver, excluded stops section with reasons
- Slice C: Map behavior — numbered divIcon pins, coord-color pins, click popups, polyline, fitBounds
- Slice D: Navigation links — Google Maps, Apple Maps, Copy Stop List
- Slice E: Coordinate cleanup — Needs Coordinates list, inline override form, activity log
- Debug fixtures: DBG-001→004 in `?debug=1` only, never production
- Codex fix: route summary renders Driver field; stop rows use `stop.legDist` for per-leg distance
- Tests: 453/453 Jest PASS + 52/52 route-preview suite PASS
- Known skip: `runtime-full.spec.js` (missing `@playwright/test` — pre-existing infra issue, not a failure)

---

## 🟡 IN PROGRESS — Phase 7

### Slice 7.2 — Stripe webhook → mark paid 🔒 ON HOLD
Plan: `PHASE7-SLICE72-PLAN.md` | Migration draft: `PHASE7-STRIPE-MIGRATION.md`

**Gate conditions (ALL required before a single line of 7.2 code):**
- [ ] `STRIPE_SECRET_KEY` added to Supabase secrets — **Jefe/owner**
- [ ] `STRIPE_WEBHOOK_SECRET` added to Supabase secrets — **Jefe/owner**
- [ ] Delta fixes + approves Stripe migration RLS (see blocker #3 below)
- [ ] Live test Stripe checkout session confirmed end-to-end
- [ ] Jefe explicit go on 7.2

### Slice 7.3 — QuickBooks 🔒 NOT STARTED
Blocked until Slice 7.2 (Stripe webhook) is stable.
Planning doc only allowed while waiting.

---

## 🔴 CURRENT BLOCKERS

### 1. Twilio/WhatsApp credentials — EXTERNAL PENDING
**Owner:** Cousin / Fiverr
**Needed:** 4 secrets → Supabase Edge Function secrets:
`TWILIO_ACCOUNT_SID` · `TWILIO_AUTH_TOKEN` · `TWILIO_FROM_NUMBER` · `TWILIO_WHATSAPP_FROM`
Code is ready. Zero dev work remaining until keys land.

### 2. Stripe credentials — PENDING JEFE/OWNER
**Needed:** Stripe account → test secret key → webhook secret → both in Supabase
**Checklist:** `PHASE7-STRIPE-SETUP-CHECKLIST.md`
Code is ready. Zero dev work remaining until keys land.

### 3. Stripe migration RLS — DELTA FIX REQUIRED
**File:** `PHASE7-STRIPE-MIGRATION.md`
**Bad line:** `tenant_id = get_user_role()` — `get_user_role()` is a role string, not a tenant_id
**Delta must:** Replace with hardened tenant + HQ role pattern from `tape_direct_records` / `box_sale_records`
**Do not apply SQL until Delta signs off.**

### 4. QuickBooks — sequenced after Stripe webhook stable
Not started. Not blocked on QB credentials yet.

---

## 🟢 SAFE WORK (no credentials needed)

- Delta: Stripe migration RLS fix/audit only
- Forge/Bolt: Stripe unconfigured UX polish if needed
- QuickBooks planning doc only (no code)
- Beta onboarding flow / checklist
- Browser smoke scripts
- No real Stripe/Twilio sends
- No production DB writes

---

## Key References

| Item | Location |
|---|---|
| App (local) | http://localhost:8765/index.html |
| Supabase project | exayifxbqduhsxmmsnxr.supabase.co |
| Stripe webhook URL | https://exayifxbqduhsxmmsnxr.supabase.co/functions/v1/stripe-webhook |
| Phase 7 roadmap | `~/casabe-v3/PHASE7-ROADMAP.md` |
| Slice 7.2 plan | `~/casabe-v3/PHASE7-SLICE72-PLAN.md` |
| Stripe migration draft | `~/casabe-v3/PHASE7-STRIPE-MIGRATION.md` |
| Stripe setup checklist | `~/casabe-v3/PHASE7-STRIPE-SETUP-CHECKLIST.md` |
| Test creds | test-hq@casabekonnect.test / casabe-smoke-2026 |
| Git remote | https://github.com/ClawdIris/V3.git, branch main |
