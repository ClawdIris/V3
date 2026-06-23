# Casabe Konnect Master Handoff

**Prepared:** June 11, 2026  
**Project:** Casabe Konnect / `casabe-v3`  
**Repository:** `/Users/joshua/casabe-v3`  
**Primary decision-maker:** Jeffrey / Jefe

This document is intentionally self-contained. Assume the next chat cannot read any prior conversation. Read this entire document before proposing work, changing files, applying migrations, deploying, or asking Jeffrey to repeat information.

---

## 1. Operating Rules

1. **Trust the repository and live evidence, not team summaries alone.** Forge implements, Delta performs QA/database review, and Codex independently reviews exact source, diffs, tests, and live behavior where possible.
2. **Do not merge, push, deploy, apply migrations, rotate accounts, or touch production without Jeffrey's explicit approval.**
3. **Show Jeffrey the exact diff before deployment.**
4. **Do not put passwords, Supabase service-role keys, Stripe secrets, Google server keys, or one-time credentials in chat, commits, reports, or documentation.**
5. **Do not revert unrelated dirty-worktree changes.** The repository contains active work from Forge and Delta.
6. **Keep source/static verification separate from live authenticated verification.** A source check is not a completed smoke test.
7. **Stripe and payment changes are STOP-SHIP work.** They require second-person review and Stripe test-mode verification before deployment.
8. **Database/RLS changes require Delta review and Jeffrey's approval before apply.**
9. **The existing team lanes already exist.** Do not recreate Forge, Delta, or Iris Force. Use their reports as leads, then independently verify them.
10. **Driver identity must use UUIDs.** New writes must never depend only on a driver's display name.

---

## 2. Executive Summary

Casabe Konnect currently has several parallel workstreams:

| Priority | Workstream | Current State | Immediate Gate |
|---|---|---|---|
| P0 | Stripe/security R4 | **STOP-SHIP. Files changed but not deployed/applied. Five findings remain.** | Forge fixes exact findings, Codex reviews, Delta reviews/tests, Jeffrey approves |
| P0 | R1 driver visibility smoke test | Source and DB protections are largely ready; authenticated UI smoke test is incomplete | Create `SMOKE-001` and `SMOKE-002` through HQ UI and prove Office/Driver visibility |
| P1 | Spanish localization cleanup | Forge changed 41 strings; dirty source is not deployed | Fresh syntax check plus full English/Spanish UI acceptance |
| P1 | Routes & Optimization rebuild | Plan, mockups, and migrations drafted; implementation has not started | Google Cloud keys/APIs, migration cleanup, Jeffrey approval |
| R2 | Address Book + campaign targeting | Requested by owner, but **not implemented** on debug or live site | Detailed technical plan, schema/RLS review, then implementation |
| Deferred | Twilio/WhatsApp route messaging | Provider/API approval was denied and is being retried | Keep messaging disabled until approved and compliant |

The most important instruction for the next chat is:

> **Do not deploy or apply anything yet. Continue the Stripe/security STOP-SHIP review and fixes first, while preserving the completed R1 database protections.**

---

## 3. Team Roles and Decision Flow

### Jeffrey / Jefe

- Final approval for migrations, merges, pushes, deployments, production changes, and release sign-off.
- Chooses product scope and accepts owner requirements.
- Must not be asked to paste secrets into chat.

### Forge

- Primary implementation lane.
- Produces code, migration drafts, plans, mockups, and revisions.
- Forge claims are not final until source and tests are reviewed.

### Delta

- QA, database, RLS, migration, and acceptance-test lane.
- Performs live DB preflights and post-apply verification.
- Delta approval is necessary for DB/security work but does not replace Codex independent review or Jeffrey approval.

### Codex / Next Chat

- Independently inspect the actual repo and exact diff.
- Identify regressions, security gaps, missing tests, stale reports, and conflicts.
- Help Jeffrey sequence the work and explain what he needs to do.
- Do not silently implement major product work that Jeffrey assigned to Forge unless explicitly instructed.

### Required Release Flow

1. Forge delivers actual code/files.
2. Codex independently reviews exact source/diff.
3. Forge fixes findings.
4. Delta reviews exact revised diff and runs required preflights/tests.
5. Jeffrey reviews and explicitly approves.
6. Apply/deploy in a coordinated release.
7. Run live authenticated and regression tests.
8. Mark release complete only after evidence passes.

---

## 4. Important URLs and Identifiers

### Current Smoke/Debug URL

Use the URL Jeffrey explicitly corrected:

`https://casabe-connect.netlify.app/?debug=1`

An older report used:

`https://casabekonnect-app.netlify.app/`

Treat the older URL as historical unless Jeffrey confirms otherwise. Do not accidentally smoke-test the wrong deployment.

### Supabase / Tenant

- Supabase project ref seen in project files/reports: `exayifxbqduhsxmmsnxr`
- Production tenant: `casabe-xpress`
- Casabe Xpress NY office UUID: `9838c5e1-42cd-4b42-b517-0de237e99712`

### Security Rule

These identifiers are safe to document. Passwords, API keys, service-role keys, Stripe secrets, and generated smoke credentials are not.

---

## 5. Current Repository and Worktree State

Repository:

`/Users/joshua/casabe-v3`

Recent important commit:

`fc0e9f3` - R1 driver view filtering, UUID-first/name-fallback across all eight driver surfaces.

The worktree is dirty and contains work from several streams. At the time of this handoff, tracked modified files include:

- `/Users/joshua/casabe-v3/index.html`
- `/Users/joshua/casabe-v3/supabase/functions/stripe-checkout/index.ts`
- `/Users/joshua/casabe-v3/supabase/functions/stripe-webhook/index.ts`

There are also many untracked plans, reports, migrations, mockups, and test documents.

Important:

- Nothing in the current Stripe/security R4 work has been applied or deployed.
- Do not discard, reset, or overwrite dirty changes.
- `git diff --check` passed during the latest Codex inspection.
- No local Deno runtime was available during the latest Codex review.
- Supabase CLI version `2.102.0` was available.

First commands for a new chat:

```bash
cd /Users/joshua/casabe-v3
git status --short
git diff --check
git diff -- index.html supabase/functions/stripe-checkout/index.ts supabase/functions/stripe-webhook/index.ts
```

---

## 6. Master Product and Release Plan

### Immediate Release 1 Goals

Release 1 must:

1. Secure driver access at the database level.
2. Use canonical driver UUIDs for assignments.
3. Ensure Driver A sees only Driver A's assigned orders.
4. Ensure Driver B sees zero Driver A orders.
5. Ensure HQ and Office see the correct orders.
6. Let drivers update only allowed status fields through the narrow RPC.
7. Complete the authenticated production/debug smoke test.
8. Clear the Stripe/security STOP-SHIP work before a broader release.

### Major Routes Rebuild

After R1 security is stable, rebuild Routes & Optimization using Google Maps and a persisted Supabase route source of truth. This is a separate phased project and must not be rushed into R1.

### Release 2 Address Book

After the Routes foundation, add a tenant-scoped Address Book and campaign segmentation by ZIP/area. Address Book is not currently on debug or live.

### Messaging

Twilio/WhatsApp messaging remains disabled until provider approval, proper consent, and A2P compliance are confirmed.

---

## 7. Production Changes Already Applied

These items were reported as applied and verified. Do not reapply them blindly.

### R1 Driver Status RPC

File:

`/Users/joshua/casabe-v3/smoke-setup/update-driver-status-rpc.sql`

Correct driver transition map:

| From | Allowed Driver Transition |
|---|---|
| `ready_pickup` | `in_warehouse` or `attempted` |
| `need_box` | `box_dropped_off` or `attempted` |
| `attempted` | `ready_pickup` |
| `in_warehouse` | Terminal; no driver exit |
| `box_dropped_off` | Terminal; no driver exit |

Drivers must use the narrow `update_driver_status` SECURITY DEFINER RPC. They must not receive broad direct UPDATE access to orders.

### Orders RLS Migration

File:

`/Users/joshua/casabe-v3/smoke-setup/orders-driver-rls-migration.sql`

Applied behavior:

- Removed broad `orders_member_all`.
- HQ/Office receive scoped SELECT, INSERT, UPDATE, and DELETE access.
- Drivers receive SELECT only through `can_access_order(id)`.
- No `orders_driver_update` policy.
- Driver writes occur through the narrow RPC only.

Reported database simulations passed:

- HQ can see required orders.
- Office can see required orders.
- Driver A can see assigned orders.
- Driver B sees zero Driver A orders.
- Forbidden driver writes were blocked.

### Anonymous Test-Tenant Policy Cleanup

The following policies were dropped from `public.orders`:

- `test_tenant_anon_read`
- `test_tenant_anon_insert`
- `test_tenant_anon_update`

No anonymous order policies remained after verification.

Apply report:

`/Users/joshua/casabe-v3/smoke-setup/DELTA-TEST-TENANT-CLEANUP-APPLY.md`

### Members Index / Routes Migration 03

Applied June 10, 2026 at approximately 21:52 EDT:

- `idx_members_user_id`

It was created concurrently, verified valid, and member row count remained unchanged.

Apply report:

`/Users/joshua/casabe-v3/routes-rebuild/DELTA-MIGRATION-03-APPLY.md`

---

## 8. R1 Driver Selector and Authenticated Smoke Test

### Current Source Design

The canonical driver selector is implemented in `index.html`:

- Queries `public.members`.
- Filters by the active tenant.
- Filters `role = driver`.
- Filters `active = true`.
- Maps member `user_id` to the driver selector.
- Filters out UUID-less entries.
- Prefers canonical members over the legacy static drivers list.
- Dual-writes:
  - `assignedDriver` as display name.
  - `assignedDriverUserId` as UUID.
- Hard-blocks saving an assignment without a UUID.

The older legacy tenant-settings driver list may remain only as a fallback. New production assignments must not rely on a name-only driver record.

### Driver View Rules

- `need_box` belongs in **My Drop-Offs**.
- `ready_pickup` belongs in **My Pickups**.
- Driver A must see only Driver A's assigned orders.
- Driver B seeing any Driver A order is a **hard failure**.
- Badge counts and list contents must agree.
- HQ and Office must see the expected orders.

### Smoke Accounts

Fresh smoke accounts were reported created on June 11, 2026:

- `smoke-hq@casabe-test.internal`
- `smoke-office@casabe-test.internal`
- `smoke-driver-a@casabe-test.internal`
- `smoke-driver-b@casabe-test.internal`

Credentials were generated once and should be stored only in Jeffrey's password manager. Do not request or reveal them in chat.

An earlier report that said no accounts existed is stale. A later Delta live preflight confirmed these four accounts exist.

### Smoke Orders That Still Need Runtime Verification

The orders must be created through the HQ production/debug UI, not SQL. This tests the actual New Order workflow and UUID dual-write behavior.

#### SMOKE-001

- Starting stage: **Need a Box** / `need_box`
- Assigned to: Smoke Driver A
- Expected:
  - HQ sees it.
  - Office sees it.
  - Driver A sees it in **My Drop-Offs**.
  - Driver B sees zero rows for it.
  - Stored order contains both driver display name and Driver A UUID.

#### SMOKE-002

- Starting stage: **Ready for Pickup** / `ready_pickup`
- Assigned to: Smoke Driver A
- Expected:
  - HQ sees it.
  - Office sees it.
  - Driver A sees it in **My Pickups**.
  - Driver B sees zero rows for it.
  - Stored order contains both driver display name and Driver A UUID.

### Smoke Test Documents

- `/Users/joshua/casabe-v3/smoke-setup/DRIVER-SELECTOR-ACCEPTANCE-TEST.md`
- `/Users/joshua/casabe-v3/smoke-setup/HQ-ORDER-CREATION.md`

The acceptance document was updated to use:

`https://casabe-connect.netlify.app/?debug=1`

It also treats Driver B visibility as a hard failure.

### Remaining R1 Sequence

1. Clear the current source/security STOP-SHIP findings.
2. Deploy only after Jeffrey's approval.
3. Log in through the corrected debug URL as HQ.
4. Create `SMOKE-001` and `SMOKE-002` through the UI.
5. Verify the database dual-write.
6. Log in as Office, Driver A, and Driver B.
7. Prove the full visibility matrix.
8. Run forbidden-write tests.
9. Capture evidence and mark R1 complete only if all checks pass.

---

## 9. Stripe and Security R4: Current STOP-SHIP

### Status

Forge delivered an R4 revision, but Codex found remaining issues. Nothing should merge, deploy, or touch production until these are fixed and reviewed.

Important files:

- `/Users/joshua/casabe-v3/migrations/r1-security-revised.sql`
- `/Users/joshua/casabe-v3/smoke-setup/FORGE-REVISION-NOTES.md`
- `/Users/joshua/casabe-v3/supabase/functions/stripe-checkout/index.ts`
- `/Users/joshua/casabe-v3/supabase/functions/stripe-webhook/index.ts`
- `/Users/joshua/casabe-v3/CODEX-SECOND-PERSON-STRIPE-REVIEW.md`

Read the latest **Forge R4 Review** section in the Codex review report before changing anything.

### Confirmed R4 Improvements

R4 correctly added or improved:

- `claim_stripe_event()` primary claim uses `INSERT ... RETURNING`.
- Concurrent losers do not incorrectly own the event.
- Failed/stale reclaim is a separate path.
- Full Edge Function code exists, not just notes/snippets.
- Checkout authorization is enforced server-side.
- Checkout currency is hardcoded to `usd`.
- PaymentIntent metadata includes order and tenant IDs.
- `checkout.session.completed` checks paid state.
- Async payment success and failure handlers exist.
- Driver selector documentation uses the correct debug URL and hard-failure language.

### Remaining Blocking Findings

#### P0: Webhook Finalization and Failure Updates Can Fail Silently

The webhook's `failEvent()`, `succeedEvent()`, skip branches, and default branches await updates to `stripe_events`, but they do not reliably inspect:

- Supabase returned errors.
- Whether a row was actually affected.
- Whether the final event state was persisted.

Why this matters:

1. Stripe event processing fails.
2. The webhook tries to mark the event failed.
3. That database update silently fails.
4. The row remains recent and `processing`.
5. Stripe retries.
6. Claim logic treats it as a duplicate/in-progress event.
7. The webhook may return `200`.
8. The payment update can be permanently lost.

Required fix:

- Use a reliable event-finalization/failure RPC, or explicitly check every update error and affected-row outcome.
- Never return `200` for a processing result unless the event state has been safely finalized or it is a deliberately safe skip.
- Add retry/reclaim tests that prove a failed state can be retried.

#### P1: Existing `claimed_at` Upgrade Is Incomplete

The migration adds and backfills `claimed_at`, but existing production tables also need the column contract enforced.

Required SQL:

```sql
ALTER TABLE public.stripe_events
  ALTER COLUMN claimed_at SET DEFAULT now(),
  ALTER COLUMN claimed_at SET NOT NULL;
```

Coordinate the migration and webhook deployment so code does not depend on a column contract that is not live yet.

#### P1: PUBLIC ACL Fail-Loud Assertion Is Incomplete

The migration's ACL assertion checks some restricted RPCs but omits:

- `get_checkout_authorized_member()`
- Retained `get_user_tenant_id()` when it exists

Required fix:

- Include every function whose PUBLIC/anon/authenticated EXECUTE access is expected to be revoked.
- The post-commit check must fail loudly if any forbidden PUBLIC EXECUTE survives.
- Handle function existence safely so a nonexistent `get_user_tenant_id()` does not make verification fail for the wrong reason.

#### P1: Async Failure Uses a Different Payment Status

One path writes `payment_failed`; another writes `failed`.

Required fix:

- Use the canonical existing status `failed`, unless a new status is intentionally introduced, documented, rendered everywhere, and tested.
- Do not create hidden status drift in JSONB.

#### P1: Successful Stripe Payment Does Not Reliably Update `payment.paid`

The paid completion flow changes payment status but can preserve an old `payment.paid` value, creating records such as:

- `status = paid`
- `paid = 0`

Required fix:

- Atomically set the paid amount from a server-trusted Stripe/order amount.
- Verify resulting balance/payment summary is correct.
- Add a test proving a completed payment cannot have contradictory status and paid amount.

### Revocation Rules: Do Not Regress

Do **not** revoke the following functions in this release:

- `current_tenant_id()`
- `is_hq()`
- `is_admin()`
- `get_user_office_ids()`
- `is_member()`
- `get_user_role()`
- `can_access_order()`

Delta's live audit found 42 RLS policy dependency rows:

- `current_tenant_id()` used by 40 policies.
- `is_hq()` used by 18 policies.
- `is_admin()` used by 2 policies.

Revoking those would silently break live RLS.

Only `get_user_tenant_id()` may be revoked after confirming:

1. It exists live.
2. No frontend, Edge Function, or policy directly depends on it.
3. Verification handles its possible absence safely.

Do not rewrite 42 working RLS policies during this security release.

### Old Test Account Rotation

Rotate only these older potentially leaked accounts:

- `test-hq@casabekonnect.test`
- `test-office@casabekonnect.test`
- `test-driver@casabekonnect.test`

Do not rotate the fresh `@casabe-test.internal` smoke accounts.

Account rotation is separate from migration work and must happen only with Jeffrey's approval.

### Required Stripe/Security Sequence

1. Forge fixes the five remaining R4 findings in actual code and SQL.
2. Codex reviews the exact new diff.
3. Delta reviews the exact revised diff.
4. Delta runs live RLS/function dependency preflights.
5. Run syntax, type, SQL, and static security checks.
6. Jeffrey explicitly approves the coordinated apply/deploy.
7. Apply migration and deploy both Edge Functions together.
8. Run Stripe test-mode and RLS regression tests.
9. Only after all evidence passes, merge/deploy the broader release.

### Required Stripe Test Matrix

- Two concurrent deliveries of the same Stripe event.
- Failed event update followed by Stripe retry and safe reclaim.
- `checkout.session.completed` with paid payment.
- `checkout.session.completed` with unpaid payment.
- `checkout.session.async_payment_succeeded`.
- `checkout.session.async_payment_failed`.
- `payment_intent.payment_failed`.
- Refund event.
- Missing or invalid metadata.
- Unauthorized driver checkout returns `403`.
- HQ/Office allowed checkout.
- Client amount tampering ignored.
- Client currency tampering ignored.
- Tenant mismatch blocked.
- PUBLIC, anon, and authenticated EXECUTE checks for restricted RPCs.
- RLS regression checks for all helper functions left callable.
- Completed payment has correct status, paid amount, and balance.

---

## 10. Spanish Localization Cleanup

### Goal

When Spanish is selected, all user-facing interface text should be Spanish except approved brand names, acronyms, and user-entered/database values. English behavior must remain unchanged.

### Current State

Forge audited and wrapped approximately 41 user-facing strings in `index.html`, including:

- Shipment filters.
- Duplicate-address banner.
- New Order modal.
- Payment section.
- Quick Scan.
- Sidebar role switcher.
- Live role labels.
- Shipment counters.
- Recipient/Sender section headers.
- Cancel buttons.
- Log Payment.
- Notes placeholder.

Plan and inventory:

- `/Users/joshua/casabe-v3/SPANISH-LOCALIZATION-CLEANUP-PLAN.md`
- `/Users/joshua/casabe-v3/SPANISH-AUDIT-INVENTORY.md`

Review reports:

- `/Users/joshua/casabe-v3/DELTA-I18N-REVIEW.md`
- `/Users/joshua/casabe-v3/smoke-setup/DELTA-DRIVER-SELECTOR-REVIEW.md`

Some Delta reports contain a stale reference to a previous syntax error. The current source appears to contain the corrected closing parentheses, but this must be freshly verified.

### Locked Role Translations

| English | Spanish |
|---|---|
| Head Office | Oficina Central |
| Owner | Propietario |
| Office | Oficina |
| Driver | Conductor |
| HQ | Keep as the brand acronym `HQ` |

Do not translate enum keys or stored database values. Translation is display-only.

### Remaining Localization Acceptance

1. Extract the JavaScript from `index.html`.
2. Run `node --check` on the extracted JavaScript.
3. Test Spanish and English in:
   - HQ view.
   - Office view.
   - Driver view.
   - Customer portal.
   - New Order modal.
   - Validation and error messages.
   - Desktop and mobile layouts.
4. Confirm no visible English remains in Spanish mode except approved brands/acronyms/user data.
5. Confirm English mode is unchanged.
6. Confirm no stored enum or DB contract was translated.
7. Do not deploy until Jeffrey reviews the diff and acceptance evidence.

---

## 11. Routes & Optimization Rebuild

### Owner Requirement

The owner wants the existing Map Preview and Route Optimization Preview fully replaced with a Google Maps-based Routes & Optimization page matching the supplied desktop/mobile direction.

Primary specification:

`/Users/joshua/casabe-v3/routes-optimization-rebuild.md`

Technical plan:

`/Users/joshua/casabe-v3/ROUTES-REBUILD-PLAN.md`

### Reference Material

Owner desktop references:

- `/Users/joshua/casabe-v3/routes-rebuild/reference-images/owner-desktop-routes-endpoint-entry.jpg`
- `/Users/joshua/casabe-v3/routes-rebuild/reference-images/owner-desktop-routes-overview.jpg`

Mobile mockups:

- `/Users/joshua/casabe-v3/routes-rebuild/mockups/mobile-route-list.html`
- `/Users/joshua/casabe-v3/routes-rebuild/mockups/mobile-map-view.html`
- `/Users/joshua/casabe-v3/routes-rebuild/mockups/mobile-driver-status.html`

### Locked Product Decisions

1. Remove Leaflet, OpenStreetMap, and Nominatim from this feature.
2. Use Google Maps JavaScript API, Geocoding API, Places API, and Routes API.
3. All route state must come from one persisted Supabase source of truth.
4. No component keeps an independent route copy.
5. Route candidates are only orders in:
   - `ready_pickup`
   - `need_box`
6. New route assignment/filtering is UUID-only, with no name fallback.
7. Every address must pass the hard confirmation gate before optimization/dispatch.
8. Tape Direct is the fixed default origin:
   - `3801 White Plains Rd, Bronx, NY 10467`
9. Tracking number is the displayed identifier throughout the feature.
10. Map, stop list, stats, orders queue, assignments, and driver portal must stay synchronized.
11. If Google Routes API fails, hard-block and require retry. Do not silently use a nearest-neighbor fallback.
12. HQ can manage tenant routes.
13. Office can manage its own-office routes.
14. Drivers can select/read their own assigned route but cannot directly write broad route/order fields.
15. Driver status writes remain narrow-RPC-only.
16. Messaging remains disabled and should show an unavailable/pending banner until Twilio/WhatsApp approval.

### Planned Implementation Slices

#### Slice 1: Foundations

- Schema and RLS.
- Routes and route_stops source of truth.
- Edge Function foundations.
- Google key delivery.
- Required indexes and migrations.

#### Slice 2: Address Verification Gate

- Google geocoding preflight.
- High/low/unresolvable confidence classification.
- Full-screen address confirmation modal.
- Places Autocomplete correction flow.
- Persist corrected address and geocode data.

#### Slice 3: Page Rebuild

- Two-column desktop layout.
- Full-screen mobile map plus bottom drawer.
- Live orders stop pool.
- Driver filter.
- Endpoint selectors.
- Map pins, route line, list, tabs, and stats.

#### Slice 4: Optimization and Assignment

- Google Routes optimization.
- Persist optimized stop sequence.
- Assign route to driver.
- Driver portal synchronization.
- Google Maps waypoint URL.
- Hard dispatch gate.

#### Slice 5: Cleanup and Verification

- Remove legacy Leaflet/OSM/Nominatim code.
- Remove low-confidence legacy coordinate flow.
- Regression tests.
- Mobile/desktop acceptance.
- Security and RLS tests.

### Google Cloud Gates

No Routes implementation should begin until these are completed and verified:

1. Enable billing.
2. Enable:
   - Maps JavaScript API.
   - Places API.
   - Geocoding API.
   - Routes API.
3. Create a browser key:
   - Maps JavaScript + Places only.
   - HTTP-referrer/domain restricted.
   - Delivered through Netlify environment variable `GOOGLE_MAPS_API_KEY`.
4. Create server keys:
   - API-restricted to Geocoding and Routes.
   - Stored as Supabase Edge Function secrets:
     - `GOOGLE_GEOCODING_KEY`
     - `GOOGLE_ROUTES_KEY`
5. Verify the browser key on the production domain.
6. Verify server-side API health without exposing server keys.

### Migration State

#### Migration 01: Routes Schema

- Delta V3 approved.
- Not applied.
- Held for Google Cloud gate and Jeffrey sign-off.

#### Migration 02: Delivery Address

- Not applied.
- Lazy population strategy selected.
- Current draft is incomplete for the full owner requirement.

It must be expanded or followed by ordered migrations covering required persisted route/geocode fields such as:

- `geocoded_lat`
- `geocoded_lng`
- `address_confidence`
- `address_confirmed_at`
- Route assignment/sequence fields as designed

The current lazy backfill, caching, audit, throttling, and retry controls are partly plan comments. They need concrete schema/process design before implementation.

#### Migration 03: Members Index

- Applied and verified.
- Do not reapply.

### Netlify Key Substitution Warning

The current `netlify.toml` approach requires correction before use:

- The single-quoted `sed` command may prevent environment-variable expansion.
- The current `index.html` may not contain the expected placeholder.
- A `.bak` file must not be published.
- Build must fail fast if the placeholder is missing or replacement count is not exactly one.
- A dummy-key substitution test must prove the browser key is inserted correctly.
- Server keys must never be injected into browser output.

### Routes Definition of Done

The Routes rebuild is not complete until:

- All Google APIs and restrictions are verified.
- Approved schema/RLS is applied and tested.
- Live order stop pool uses only `ready_pickup` and `need_box`.
- Driver filter is UUID-only.
- Address confirmation blocks optimization and assignment.
- Corrected addresses persist and appear in HQ/Office views.
- Route optimization, stats, deep link, and persisted sequence work.
- Driver portal reflects the same persisted route.
- Driver completion removes stops through the existing sync behavior.
- Mobile and desktop match approved references.
- Legacy map/geocoding code is removed.
- Security, RLS, failure, and live acceptance tests pass.

---

## 12. Address Book and Campaign Targeting: Release 2

### Owner Request

The owner wants an Address Book tab that can also support campaigns targeted by geographic area or ZIP code.

### Current Truth

**Address Book is not currently implemented on the debug site or live site.**

Do not tell Jeffrey or the owner that it exists. It was intentionally deferred from the Routes rebuild's first release to avoid expanding the security and schema scope before R1/Routes foundations are stable.

### Planned Release 2 Scope

The Address Book should eventually include:

- Tenant-scoped contacts/addresses.
- Contact name, phone, email, label, and notes.
- Full address.
- ZIP code and geographic area.
- Geocoded latitude/longitude.
- Address confidence and confirmation timestamp.
- Reuse of Google Places and address-confirmation flow.
- Search and filters.
- Import.
- Deduplication.
- HQ/Office permissions.
- Campaign segmentation by ZIP/area.
- Campaign recipient preview/count.
- Opt-out/consent handling before messaging.
- Audit trail.

### Address Book Required Plan Before Coding

1. Create a detailed technical plan.
2. Define schema and ownership.
3. Define RLS for HQ, Office, and other roles.
4. Decide whether addresses link to orders/customers or are copied snapshots.
5. Define deduplication rules.
6. Define import format and validation.
7. Define geocoding and cost controls.
8. Define campaign segment queries.
9. Define consent/opt-out behavior.
10. Delta reviews schema/RLS.
11. Jeffrey approves.
12. Forge implements.
13. Run security, campaign-targeting, and localization acceptance tests.

### Address Book Definition of Done

- Address Book tab is visible in authorized debug/live roles.
- Contacts are tenant-isolated.
- ZIP/area targeting returns correct contacts only.
- No cross-tenant or unauthorized access.
- Geocoding is cached and confirmed.
- Duplicate/import behavior is predictable.
- Campaign audience can be previewed before sending.
- Messaging respects provider approval, consent, and opt-out rules.

---

## 13. Twilio / WhatsApp Messaging

The Twilio/WhatsApp API request was denied and the team is trying again.

Until approval:

- Do not send route assignment messages.
- Do not enable campaign sending.
- Keep messaging disabled in product flows.
- It is acceptable to build a disabled/pending UI state.
- Do not claim messaging is functional.

Before enabling:

- Provider/API approval.
- A2P/compliance approval as applicable.
- Consent and opt-out storage.
- `"Reply STOP to opt out"` behavior where required.
- Secure server-side credentials.
- Delivery/failure/retry handling.
- End-to-end tests.

---

## 14. Known Stale or Conflicting Reports

The next chat must actively reconcile these:

1. **Smoke accounts:** An older report says no test credentials/accounts existed. Later live Delta evidence confirms four `@casabe-test.internal` smoke accounts exist. Treat the later live result as current.
2. **Live URL:** Older testing used `casabekonnect-app.netlify.app`. Jeffrey explicitly corrected the debug workflow to `https://casabe-connect.netlify.app/?debug=1`.
3. **Spanish syntax error:** Some Delta reports mention an earlier syntax error. Current source appears fixed. Run a fresh extracted-JS syntax check instead of trusting either claim.
4. **Routes reference images:** An older report says owner desktop images were missing. They now exist in `routes-rebuild/reference-images/`.
5. **Migration 03:** Earlier reports call it pending. It was later applied and verified. Do not reapply.
6. **Anonymous test policies:** Earlier reports call cleanup pending. It was later applied and verified.
7. **Stripe R4:** Forge reports all P0/P1 fixes delivered, but the latest Codex independent review found five remaining issues. Treat Stripe R4 as STOP-SHIP until those are fixed and re-reviewed.

---

## 15. Exact Next Actions

### First: Stripe/Security STOP-SHIP

Owner: Forge implementation, then Codex and Delta review.

1. Inspect the latest exact diff.
2. Fix webhook finalization/failure error handling.
3. Enforce `claimed_at` default and NOT NULL.
4. Expand PUBLIC ACL fail-loud assertions.
5. Normalize async failure to canonical `failed`.
6. Atomically update `payment.paid` on successful Stripe payment.
7. Run static checks.
8. Codex re-reviews exact diff.
9. Delta runs preflight and RLS regression tests.
10. Jeffrey approves before apply/deploy.

### Second: Complete R1 Smoke Test

Owner: Jeffrey provides authenticated access if needed; Delta executes/records; Codex can help inspect browser/source.

1. Deploy the approved source.
2. Use `https://casabe-connect.netlify.app/?debug=1`.
3. Create `SMOKE-001` through HQ UI.
4. Create `SMOKE-002` through HQ UI.
5. Verify UUID dual-write in DB.
6. Verify HQ and Office views.
7. Verify Driver A correct lists.
8. Verify Driver B zero visibility.
9. Run forbidden-write tests.
10. Record evidence and sign off R1.

### Third: Spanish Acceptance

1. Fresh extracted-JS `node --check`.
2. Full Spanish/English UI sweep.
3. Fix remaining visible English.
4. Verify mobile and desktop.
5. Jeffrey approves diff.

### Fourth: Routes Preconditions

Jeffrey action is required for Google Cloud:

1. Enable billing and four APIs.
2. Create/restrict browser key.
3. Create/restrict server keys.
4. Add Netlify/Supabase secrets without exposing them.
5. Fix and prove Netlify substitution.
6. Expand/sequence Migration 02.
7. Re-review routes migrations.
8. Jeffrey approves implementation start.

### Fifth: Address Book Release 2

After Routes foundation:

1. Write detailed technical plan.
2. Draft schema/RLS.
3. Delta review.
4. Jeffrey approval.
5. Forge implementation.
6. Campaign targeting/security/consent tests.

---

## 16. What Jeffrey Needs to Do

Jeffrey should not need to repeat the project history. Ask him only for actions that require his authority or private access.

Current likely Jeffrey actions:

1. Approve only after receiving revised Stripe/security review evidence.
2. Keep secrets private and enter them only in trusted dashboards/terminals.
3. Help with authenticated smoke-test login if the testing agent cannot access saved credentials.
4. Complete Google Cloud billing/API/key setup when ready to unblock Routes.
5. Approve mobile/desktop Routes direction and final migration/application timing.
6. Approve the separate Address Book Release 2 plan when prepared.

Do not ask Jeffrey to:

- Paste service-role keys or passwords into chat.
- Re-explain the owner specification already captured here.
- Approve a deployment without exact diff and test evidence.
- Reapply already completed migrations.

---

## 17. Do-Not-Do List

- Do not deploy the current dirty worktree.
- Do not apply `r1-security-revised.sql` yet.
- Do not deploy Stripe Edge Functions yet.
- Do not revoke RLS helper functions used by live policies.
- Do not reintroduce broad driver UPDATE policies.
- Do not allow name-only driver assignment for new writes.
- Do not use SQL-created orders as a substitute for the HQ UI smoke test.
- Do not mark Driver B visibility as a warning; it is a hard failure.
- Do not reapply Migration 03 or anonymous-policy cleanup.
- Do not expose keys or credentials.
- Do not claim Address Book is live.
- Do not enable Twilio/WhatsApp messaging.
- Do not begin Routes implementation before Google and schema gates.
- Do not trust stale reports over current source/live evidence.

---

## 18. Key File Index

### Master Plans and Reviews

- `/Users/joshua/casabe-v3/MASTER-HANDOFF-2026-06-11.md`
- `/Users/joshua/casabe-v3/CODEX-SECOND-PERSON-STRIPE-REVIEW.md`
- `/Users/joshua/casabe-v3/ROUTES-REBUILD-PLAN.md`
- `/Users/joshua/casabe-v3/routes-optimization-rebuild.md`
- `/Users/joshua/casabe-v3/SPANISH-LOCALIZATION-CLEANUP-PLAN.md`
- `/Users/joshua/casabe-v3/SPANISH-AUDIT-INVENTORY.md`

### Current Source

- `/Users/joshua/casabe-v3/index.html`
- `/Users/joshua/casabe-v3/supabase/functions/stripe-checkout/index.ts`
- `/Users/joshua/casabe-v3/supabase/functions/stripe-webhook/index.ts`

### Current Security Drafts

- `/Users/joshua/casabe-v3/migrations/r1-security-revised.sql`
- `/Users/joshua/casabe-v3/smoke-setup/FORGE-REVISION-NOTES.md`

### R1 Smoke and Applied Security

- `/Users/joshua/casabe-v3/smoke-setup/DRIVER-SELECTOR-ACCEPTANCE-TEST.md`
- `/Users/joshua/casabe-v3/smoke-setup/HQ-ORDER-CREATION.md`
- `/Users/joshua/casabe-v3/smoke-setup/create-smoke-accounts.js`
- `/Users/joshua/casabe-v3/smoke-setup/update-driver-status-rpc.sql`
- `/Users/joshua/casabe-v3/smoke-setup/orders-driver-rls-migration.sql`
- `/Users/joshua/casabe-v3/smoke-setup/DELTA-TEST-TENANT-CLEANUP-APPLY.md`

### Routes

- `/Users/joshua/casabe-v3/routes-rebuild/migrations/01-routes-schema.sql`
- `/Users/joshua/casabe-v3/routes-rebuild/migrations/02-orders-delivery-address.sql`
- `/Users/joshua/casabe-v3/routes-rebuild/migrations/03-members-index.sql`
- `/Users/joshua/casabe-v3/routes-rebuild/ROUTES-RLS-TEST-SUITE.md`
- `/Users/joshua/casabe-v3/routes-rebuild/NETLIFY-KEY-SETUP.md`
- `/Users/joshua/casabe-v3/routes-rebuild/DELTA-MIGRATION-03-APPLY.md`

---

## 19. Definition of Current Success

The next chat has succeeded if it:

1. Understands that Stripe/security is the active STOP-SHIP.
2. Does not deploy or apply anything prematurely.
3. Continues from the five remaining Stripe R4 findings.
4. Preserves the already-applied R1 RLS/RPC/index/anon-cleanup work.
5. Completes the authenticated UI smoke test only after approved deployment.
6. Treats Spanish cleanup as pending acceptance, not released.
7. Treats Routes as approved planning with unresolved gates, not implemented.
8. Treats Address Book as Release 2 and not live.
9. Keeps messaging disabled.
10. Gives Jeffrey concise, evidence-based updates and asks him only for actions requiring his authority or private access.

---

## 20. Recommended First Message From the Next Chat

Use a message similar to:

> I have the full handoff. I am treating the Stripe/security R4 work as STOP-SHIP, preserving the already-applied R1 database protections, and not deploying or applying anything. I will first inspect the exact current Stripe migration and Edge Function diff against the five remaining Codex findings, then report the verified fix list before Delta is queued.

