# Casabe Konnect R4 — Status Board
**Last updated: 2026-06-01 20:09 EDT**
**Latest commit: `9f40c6e` — live on Netlify**

---

## 🟢 CLOSED — Phase 6 (All items verified by Codex live smoke)

| Item | Commit | Verified |
|---|---|---|
| Driver identity fix — no Carlos Vargas hardcode | `35b342b` | ✅ Codex |
| Message Queue store scope fix — queue persists across nav | `dddc7b4` | ✅ Codex |
| P4 console errors — coordStatusColor returns hex | `dddc7b4` | ✅ Codex |
| Tape Direct / Box Sale void → Supabase write | `eabc5ef` | ✅ Codex |
| Receipts & Invoices — null guard, print, friendly errors | `a2ba47a` | ✅ Codex |
| Leaflet map upgrade — real OSM tiles, 18/18 loaded | `c6c82f3` | ✅ Codex |
| Spanish UI smoke — all 3 portals (HQ/Office/Driver) | `dddc7b4` | ✅ Delta |
| Dynamic data notranslate — 16 nodes, IDs/names protected | `565d948` | ✅ Codex |
| Product readiness acceptance — 453 tests | `565d948` | ✅ Jefe |
| R4 live Netlify smoke — commit `dddc7b4` confirmed live | — | ✅ Codex |

**Phase 6: CLOSED ✅**

---

## 🟡 IN PROGRESS — Phase 7 (Payments + Accounting)

### Slice 7.1 — Stripe scaffold ✅ CLOSED
- `stripe-checkout` Edge Function scaffold — reads `STRIPE_SECRET_KEY` from Deno.env only
- `stripe-webhook` Edge Function scaffold — signature verification, TODO markers for DB writes
- `GeneratePaymentLink` UI button — HQ-only, all states (loading / success / unconfigured / error)
- 59/59 tests passing (P6 + P7 mocked tests added)
- **Accepted by Jefe 2026-06-01**

### Slice 7.1.5 — UX Polish ✅ SHIPPED (commits `1fe847d`, `9f40c6e`)
- Payment status badge on invoice header (✓ Paid / ✗ Failed / ⏱ Expired / Deposit)
- Empty state + "Go to Orders →" shortcut when no order selected
- Copy Payment Link: amber border, 2s "✓ Copied!" feedback, Stripe share note
- 9 mocked P7 tests — Stripe 503, webhook source scan, Twilio gate scan

### Slice 7.2 — Stripe webhook → mark paid 🔒 ON HOLD
Plan written: `PHASE7-SLICE72-PLAN.md`
Migration drafted: `PHASE7-STRIPE-MIGRATION.md` — **Delta review required before apply**

**Gate conditions (ALL required):**
- [ ] `STRIPE_SECRET_KEY` added to Supabase secrets by Jefe
- [ ] `STRIPE_WEBHOOK_SECRET` added to Supabase secrets by Jefe
- [ ] Delta fixes and approves Stripe migration (see below)
- [ ] Live test Stripe checkout session confirmed end-to-end
- [ ] Jefe explicit go on 7.2

### Slice 7.3 — QuickBooks OAuth 🔒 NOT STARTED
Blocked until Slice 7.2 (Stripe webhook) is stable and working.
Do not touch QuickBooks until Stripe checkout → webhook → paid status is confirmed live.

### Slice 7.4 — QuickBooks invoice/payment sync 🔒 NOT STARTED
Blocked until 7.3.

### Slice 7.5 — End-to-end smoke 🔒 NOT STARTED
Blocked until 7.4.

---

## 🔴 CURRENT BLOCKERS

### 1. Twilio/WhatsApp credentials — EXTERNAL PENDING
**Owner:** Jefe's cousin
**What's needed:** 4 secrets added to Supabase Edge Function secrets:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `TWILIO_WHATSAPP_FROM`
**When ready:** Run Stage 4 smoke — queue → WhatsApp send → SMS → delivery verify → log check
**Code is ready. Zero dev work remaining until keys land.**

### 2. Stripe credentials — PENDING JEFE
**What's needed:**
- Create Stripe account (test mode)
- Add `STRIPE_SECRET_KEY` to Supabase secrets
- Register webhook endpoint in Stripe dashboard
- Add `STRIPE_WEBHOOK_SECRET` to Supabase secrets
**Checklist:** `PHASE7-STRIPE-SETUP-CHECKLIST.md`
**Code is ready. Zero dev work remaining until keys land.**

### 3. Stripe migration — Delta RLS fix required
**File:** `PHASE7-STRIPE-MIGRATION.md`
**Issue:** `stripe_configs` HQ policy uses placeholder `tenant_id = get_user_role()` — incorrect. `get_user_role()` returns a role string, not a tenant_id.
**Delta must fix:** Replace with hardened tenant + HQ role check matching existing pattern from `tape_direct_records` / `box_sale_records` policies.
**Do not apply SQL until Delta approves the corrected migration.**

### 4. QuickBooks — waiting on Stripe stability
Not started. Not blocked on credentials yet — blocked on Stripe working first.

---

## 🟢 SAFE WORK (no credentials needed)

- Beta polish: additional UX improvements to any page
- More mocked tests
- Slice 7.2 plan refinement
- Fix any browser smoke issues immediately

---

## Key References

| Item | Location |
|---|---|
| App (local) | http://localhost:8765/index.html |
| App (Netlify) | Auto-deployed from `origin/main` |
| Supabase project | exayifxbqduhsxmmsnxr.supabase.co |
| Stripe webhook URL | https://exayifxbqduhsxmmsnxr.supabase.co/functions/v1/stripe-webhook |
| Phase 7 roadmap | ~/casabe-v3/PHASE7-ROADMAP.md |
| Slice 7.2 plan | ~/casabe-v3/PHASE7-SLICE72-PLAN.md |
| Stripe migration draft | ~/casabe-v3/PHASE7-STRIPE-MIGRATION.md |
| Stripe setup checklist | ~/casabe-v3/PHASE7-STRIPE-SETUP-CHECKLIST.md |
| Test credentials | test-hq@casabekonnect.test / casabe-smoke-2026 |
| Git remote | https://github.com/ClawdIris/V3.git, branch main |
