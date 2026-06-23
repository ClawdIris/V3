# Casabe Konnect Current-State Technical Export

Generated: 2026-06-16  
Scope: `/Users/joshua/casabe-v3` plus the adjacent FixForge skill at `/Users/joshua/.hermes/skills/casabe-konnect/fixforge/SKILL.md` because the request included that bot output.  

Important method note: this document is based on files read directly from the local codebase. I did not query the live Supabase database, Netlify deploy, Honcho, or production traffic. Where a statement is inferred from file structure, comments, or scripts rather than live execution, it is labeled `Inferred`. Where I could not determine something from the files, it is labeled `Could not determine`.

Secret-handling note: this export references credential names only. It intentionally does not print API keys, passwords, tokens, webhook secrets, database URLs, or other secret values. The repo contains at least one public Supabase runtime key in frontend source; it is not reproduced here.

## 1. SYSTEM OVERVIEW

### What The Application Is

Directly read: Casabe Konnect is a parcel/shipping operations platform for coordinating customer orders, pickup/drop-off flows, driver work, payment collection, tracking, office/partner operations, route planning, campaigns, messaging, and internal admin views.

In plain language: it is an operations dashboard for a shipping/logistics business. HQ and office users create and manage orders. Drivers see assigned work and update shipment status. Customers can be tracked by profile/order data. Payments, receipts, invoices, campaign messaging, and operational reporting are layered around that core order flow.

### Tech Stack

Directly read from `/Users/joshua/casabe-v3/package.json`, `/Users/joshua/casabe-v3/index.html`, `/Users/joshua/casabe-v3/backend/server.js`, and `/Users/joshua/casabe-v3/supabase/functions/*`:

- Frontend: single-file React app in `/Users/joshua/casabe-v3/index.html`.
- Frontend delivery: static root publish via Netlify config in `/Users/joshua/casabe-v3/netlify.toml`.
- Frontend libraries loaded by CDN:
  - React UMD.
  - ReactDOM UMD.
  - Supabase JS UMD.
  - Leaflet CSS/JS.
  - Google Fonts.
- Backend API: Node.js + Express in `/Users/joshua/casabe-v3/backend/server.js`.
- Backend libraries:
  - `express`
  - `cors`
  - `helmet`
  - `express-rate-limit`
  - `jsonwebtoken`
  - `@supabase/supabase-js`
  - `pg`
  - `dotenv`
- Database/Auth: Supabase/Postgres/Auth/RLS.
- Serverless functions: Supabase Edge Functions written for Deno:
  - `/Users/joshua/casabe-v3/supabase/functions/sms-send/index.ts`
  - `/Users/joshua/casabe-v3/supabase/functions/sms-status/index.ts`
  - `/Users/joshua/casabe-v3/supabase/functions/stripe-checkout/index.ts`
  - `/Users/joshua/casabe-v3/supabase/functions/stripe-webhook/index.ts`
- Tests: Jest + Supertest, with one Playwright-based runtime test file currently blocked by a missing package.
- Deployment/config:
  - Netlify for the static frontend.
  - Supabase CLI/project config for database and Edge Functions.

### Architecture Overview

Directly read:

- `/Users/joshua/casabe-v3/index.html` contains the main application UI, React components, routing, Supabase client initialization, data adapter functions, debug mode, and inline test harnesses.
- `/Users/joshua/casabe-v3/backend/server.js` contains a separate Express API with JWT auth, order endpoints, payment endpoint, and health endpoint.
- `/Users/joshua/casabe-v3/supabase/functions/*` contains Edge Functions for Stripe and Twilio/SMS.
- `/Users/joshua/casabe-v3/migrations`, `/Users/joshua/casabe-v3/supabase/migrations`, and root SQL files contain the database schema/RLS/function history and in-progress migrations.

Inferred:

- The browser app appears to be the main product surface and talks directly to Supabase for most data operations.
- The Express backend appears to be an older or parallel API surface. I did not find evidence that the current frontend imports or calls `backend/server.js` directly.
- Netlify likely serves the static frontend, while Supabase hosts database/Auth/Edge Functions.
- RLS and database functions are treated as the primary security boundary for driver/office/HQ isolation.

Could not determine from files alone:

- Which exact commit is deployed to production.
- Whether the Express backend is deployed anywhere.
- Which migrations are actually applied in the live Supabase project, beyond what local status/runbook documents claim.

## 2. REPOSITORY MAP

### Major Directories And Files

Directly read from the filesystem:

- `/Users/joshua/casabe-v3/index.html`  
  Main single-page React application. Contains the majority of product UI, client-side routing, Supabase data adapter code, debug tools, and inline/static test scaffolding.

- `/Users/joshua/casabe-v3/backend/`  
  Express API server. Main entry point is `/Users/joshua/casabe-v3/backend/server.js`.

- `/Users/joshua/casabe-v3/src/api/`  
  Additional API modules. Currently includes `/Users/joshua/casabe-v3/src/api/admin-commissions.js`.

- `/Users/joshua/casabe-v3/src/middleware/`  
  Server-side middleware/helper modules for safety acknowledgements and zone validation:
  - `/Users/joshua/casabe-v3/src/middleware/safety-validation.js`
  - `/Users/joshua/casabe-v3/src/middleware/zone-validation.js`

- `/Users/joshua/casabe-v3/supabase/functions/`  
  Supabase Edge Functions for Twilio/SMS and Stripe checkout/webhook handling.

- `/Users/joshua/casabe-v3/supabase/migrations/`  
  Supabase migration files, especially messaging consent, Stripe idempotency, Stripe RLS guards, and message template schema.

- `/Users/joshua/casabe-v3/migrations/`  
  Current staged/draft migration files for R1/R2 work, including security revisions, driver RLS fixes, and Address Book drafts.

- `/Users/joshua/casabe-v3/routes-rebuild/`  
  Route optimizer rebuild planning, mockups, migration drafts, Delta review docs, slice prep notes, and reference screenshots.

- `/Users/joshua/casabe-v3/smoke-setup/`  
  Smoke account scripts, driver isolation SQL/runbooks, RLS preflight docs, and final gate materials.

- `/Users/joshua/casabe-v3/tests/`  
  Jest tests and static/runtime test files. Current suite is mostly source-scan and behavior checks for the single-file frontend and SQL artifacts.

- `/Users/joshua/casabe-v3/scripts/`  
  Present but currently empty from the directory listing I inspected.

- `/Users/joshua/casabe-v3/netlify.toml`  
  Netlify build/publish config. It is currently untracked in git.

- `/Users/joshua/casabe-v3/STATUS.md`  
  Older status document. It is stale relative to current git history and newer handoff docs.

- `/Users/joshua/casabe-v3/MASTER-HANDOFF-2026-06-11.md`  
  Operational handoff with current release gates and do-not-do constraints.

- `/Users/joshua/.hermes/skills/casabe-konnect/fixforge/SKILL.md`  
  Adjacent Hermes skill spec for a future FixForge automation loop. This is not part of the app runtime.

### Entry Points

Directly read:

- Frontend entry point:
  - `/Users/joshua/casabe-v3/index.html`
  - React component `App()` starts around the main app section.
  - `AppShell` contains most application state/routing.

- Backend entry point:
  - `/Users/joshua/casabe-v3/backend/server.js`
  - `package.json` points `main` to `backend/server.js`.

- Supabase Edge Function entry points:
  - `/Users/joshua/casabe-v3/supabase/functions/sms-send/index.ts`
  - `/Users/joshua/casabe-v3/supabase/functions/sms-status/index.ts`
  - `/Users/joshua/casabe-v3/supabase/functions/stripe-checkout/index.ts`
  - `/Users/joshua/casabe-v3/supabase/functions/stripe-webhook/index.ts`

### Build, Run, And Deploy Commands

Directly read from `/Users/joshua/casabe-v3/package.json`:

- Install dependencies:
  - `npm install`
- Start backend:
  - `npm start`
- Start backend in development mode:
  - `npm run dev`
- Run tests:
  - `npm test`
- Watch tests:
  - `npm run test:watch`
- Coverage:
  - `npm run test:coverage`

Directly read from `/Users/joshua/casabe-v3/netlify.toml`:

- Netlify publish directory:
  - `.`
- Netlify build command:
  - copies `GOOGLE_MAPS_API_KEY` into the `%%GOOGLE_MAPS_KEY%%` placeholder in `index.html`.
- Netlify Node version:
  - `18`

Directly read from `/Users/joshua/casabe-v3/apply-migration.js`:

- Migration helper:
  - `node apply-migration.js <sqlfile>`
  - Requires `DATABASE_URL`.

Inferred from smoke scripts and static frontend shape:

- Local static serving for the frontend is likely done from the repo root, often with a simple static server on port `8765`, because smoke materials reference `http://localhost:8765/index.html?debug=1`.

Could not determine:

- A formal frontend build command beyond Netlify's placeholder replacement.
- A committed Supabase Edge Function deploy command.
- A committed Netlify CLI deploy command.

## 3. FEATURE INVENTORY

Status labels below mean:

- `Working by tests/source`: implementation exists and relevant tests/source checks pass locally.
- `Implemented, not live-verified`: code exists, but I did not verify against live services.
- `Partial/draft`: code or SQL exists but docs indicate it is not applied or not implemented.
- `Fragile/needs review`: code exists but I found a likely integration or runtime risk.
- `Stub/test scaffold`: code exists for tests or placeholders, not full product behavior.

### Authentication And Role-Based App Shell

Status: Implemented, not live-verified.

Directly read:

- Frontend:
  - `/Users/joshua/casabe-v3/index.html`
  - Supabase session restoration.
  - Login/logout flows.
  - Membership lookup from `members`.
  - Role mapping for HQ, office, and driver.
- Backend:
  - `/Users/joshua/casabe-v3/backend/server.js`
  - JWT middleware `authenticateToken`.
  - Login and validation endpoints.

Dependencies:

- Supabase Auth.
- `members` table.
- Supabase client in frontend.
- JWT secret for backend.

Fragile/unknown:

- I did not live-test auth.
- Backend login uses Supabase admin auth from server code; I did not verify that path is currently valid against installed Supabase SDK behavior.

### Order Creation And Order Management

Status: Implemented, not live-verified.

Directly read:

- Frontend:
  - `/Users/joshua/casabe-v3/index.html`
  - `OrdersPage`
  - `PickupListPage`
  - `DropOffListPage`
  - `_db.orders` adapter.
- Backend:
  - `/Users/joshua/casabe-v3/backend/server.js`
  - `POST /api/orders`
  - `GET /api/orders/:id`
  - `PUT /api/orders/:id`
- Database:
  - local SQL migrations and RLS docs describe the `orders` table as the core entity.

What it does:

- Creates and updates order records.
- Stores most order detail in `orders.data` JSONB.
- Stores top-level relational fields such as `tenant_id`, `office_id`, and `partner_id`.
- Supports pickup/drop-off workflow views.

Dependencies:

- Supabase `orders`.
- Tenant/member role context.
- Driver RLS helper functions for scoped access.

### Driver Portal And Driver Status Updates

Status: Implemented with known fragile area.

Directly read:

- Frontend:
  - `/Users/joshua/casabe-v3/index.html`
  - `DriverRoutePage`
  - status update logic around `update_driver_status`.
- Database/RLS:
  - `/Users/joshua/casabe-v3/smoke-setup/update-driver-status-rpc.sql`
  - `/Users/joshua/casabe-v3/migrations/r1-rls-driver-fix.sql`
  - `/Users/joshua/casabe-v3/smoke-setup/DELTA-DRIVER-ISOLATION-READY.md`

What it does:

- Drivers see scoped assigned orders.
- Drivers update status through an RPC rather than direct table updates.
- RLS is designed to prevent Driver B/cross-tenant visibility.

Fragile/needs review:

- In the frontend status update path, I read a call to `supabase.rpc(...)` rather than the initialized `_supabase.rpc(...)`. I infer this may be a bug unless another global client named `supabase` exists at runtime.
- Driver A/B isolation is documented but still depends on creating `SMOKE-001` and `SMOKE-002` through the HQ UI and running the authenticated suite.

### Shipment Management

Status: Implemented, not live-verified.

Directly read:

- `/Users/joshua/casabe-v3/index.html`
  - `ShipmentsPage`
  - status/filter/search UI.

What it does:

- Provides shipment list/detail management over order-like records.
- Supports shipment status flows and filtering.

Dependencies:

- Supabase order/shipment data.
- Tenant/member role context.

Could not determine:

- Whether `shipments` is a separate live table or a UI concept layered over `orders`; the frontend data adapter heavily centers on `orders`.

### Payments, Receipts, Invoices, And Stripe

Status: Partial/draft for security release; implementation exists but release is blocked.

Directly read:

- Frontend:
  - `/Users/joshua/casabe-v3/index.html`
  - `PaymentsPage`
  - payment link / receipt-related test scaffolding near the end of the file.
- Backend:
  - `/Users/joshua/casabe-v3/backend/server.js`
  - `POST /api/payments`
- Edge Functions:
  - `/Users/joshua/casabe-v3/supabase/functions/stripe-checkout/index.ts`
  - `/Users/joshua/casabe-v3/supabase/functions/stripe-webhook/index.ts`
- SQL:
  - `/Users/joshua/casabe-v3/phase5-receipts-schema.sql`
  - `/Users/joshua/casabe-v3/supabase/migrations/r6-stripe-idempotency.sql`
  - `/Users/joshua/casabe-v3/supabase/migrations/r6-stripe-rls-guard.sql`
  - `/Users/joshua/casabe-v3/supabase/migrations/r6-stripe-rls-guard-v2.sql`
  - `/Users/joshua/casabe-v3/migrations/r1-security-revised.sql`

What it does:

- Builds Stripe checkout sessions server-side.
- Handles Stripe webhook idempotency and payment merge behavior through database RPCs.
- Tracks payments, receipts, invoices, invoice items, and Stripe events.

Current status from docs:

- `/Users/joshua/casabe-v3/MASTER-HANDOFF-2026-06-11.md` marks Stripe/security as a P0 STOP-SHIP area.
- `/Users/joshua/casabe-v3/smoke-setup/FORGE-STRIPE-R1-REVISED.md` says the revised work was delivered and awaits Delta review/Jefe sign-off.

Could not determine:

- Whether `/Users/joshua/casabe-v3/migrations/r1-security-revised.sql` is applied live.
- Whether Stripe Edge Functions are deployed.

### Public Tracking

Status: Implemented, not live-verified.

Directly read:

- `/Users/joshua/casabe-v3/index.html`
  - `TrackingPage`

What it does:

- Provides tracking UI around shipment/order state.

Dependencies:

- Supabase order/shipment data.

### Campaigns And Audience Messaging

Status: Campaign UI implemented; R2 audience/address-book migration is draft.

Directly read:

- Frontend:
  - `/Users/joshua/casabe-v3/index.html`
  - `CampaignsPage`
  - campaign data adapter using `campaigns`.
- R2 draft:
  - `/Users/joshua/casabe-v3/migrations/r2-address-book-schema-v4.sql`
  - `/Users/joshua/casabe-v3/RELEASE2-ADDRESS-BOOK-PLAN.md`

What it does:

- Existing campaign UI/data exists.
- R2 draft adds `address_book`, `campaign_audiences`, audience targeting, geocoding fields, tags, consent, and import from orders.

Current status:

- Address Book is not implemented in app UI.
- Migration file is staged/draft and should not be assumed applied.

### SMS, WhatsApp, Message Templates, And Queue

Status: Implemented in parts; provider live status not verified.

Directly read:

- Frontend:
  - `/Users/joshua/casabe-v3/index.html`
  - `MessageTemplatesPage`
  - `MessageTemplatesCRUDPage`
  - `ProviderConfigPage`
  - `MessageQueuePage`
  - `IntegrationStatusPage`
- Edge Functions:
  - `/Users/joshua/casabe-v3/supabase/functions/sms-send/index.ts`
  - `/Users/joshua/casabe-v3/supabase/functions/sms-status/index.ts`
- SQL:
  - `/Users/joshua/casabe-v3/phase6-slice5-stage3-schema.sql`
  - `/Users/joshua/casabe-v3/phase6-slice5-stage5-templates-schema.sql`
  - `/Users/joshua/casabe-v3/supabase/migrations/r6-messaging-consent.sql`
  - `/Users/joshua/casabe-v3/supabase/migrations/r6-message-templates.sql`

What it does:

- Queues messages.
- Sends SMS/WhatsApp-like messages through Twilio.
- Tracks consent fields on orders.
- Manages message templates.

Current status from docs:

- Twilio/WhatsApp remains disabled or deferred in status/handoff documents.

### Routes And Optimization

Status: UI exists; persistent route schema/rebuild is draft/not applied.

Directly read:

- Frontend:
  - `/Users/joshua/casabe-v3/index.html`
  - `RoutesPage`
  - route/geocode helper functions.
- Route rebuild:
  - `/Users/joshua/casabe-v3/routes-rebuild/ROUTES-REBUILD-PLAN.md`
  - `/Users/joshua/casabe-v3/routes-rebuild/migrations/01-routes-schema-v3.sql`
  - `/Users/joshua/casabe-v3/routes-rebuild/migrations/02-orders-delivery-address-v5.sql`
  - `/Users/joshua/casabe-v3/routes-rebuild/migrations/03-members-index.sql`

What it does:

- UI supports route planning/optimization concepts.
- Draft migrations introduce `routes`, `route_stops`, `delivery_address`, and Tape Direct guard triggers.

Current status:

- Route migrations are drafted and reviewed in local docs.
- Migration 02 v5 includes a write-skew fix using row locking before checking Tape Direct constraints.
- Docs indicate Google-dependent work is blocked on Google Cloud/API key setup.

Could not determine:

- Whether any route migrations are applied live.

### Map View, Geocoding, And Google/Leaflet

Status: Implemented in frontend; external key/live behavior not verified.

Directly read:

- `/Users/joshua/casabe-v3/index.html`
  - `MapViewPage`
  - Leaflet usage.
  - Nominatim geocoding helper.
  - Google Maps placeholder handling.
- `/Users/joshua/casabe-v3/netlify.toml`
  - `GOOGLE_MAPS_API_KEY` placeholder replacement.

What it does:

- Renders maps using Leaflet/OpenStreetMap tiles.
- Uses geocoding cache/local helpers.
- Prepares Google Maps integration through Netlify build-time key replacement.

Dependencies:

- Leaflet CDN.
- OpenStreetMap/Nominatim.
- Google Maps/browser key for Google-dependent features.

### Tape Direct Tracking

Status: Implemented in current UI/schema; route guard migration draft exists.

Directly read:

- `/Users/joshua/casabe-v3/index.html`
  - `TapeDirectPage`
- `/Users/joshua/casabe-v3/phase6-slice4-schema.sql`
  - `tape_direct_records`
- `/Users/joshua/casabe-v3/routes-rebuild/migrations/02-orders-delivery-address-v5.sql`
  - Tape Direct route-stop guard triggers.

What it does:

- Tracks Tape Direct records.
- Draft route migrations prevent Tape Direct delivery addresses from being routed.

### Box Sale Tracking

Status: Implemented in current UI/schema.

Directly read:

- `/Users/joshua/casabe-v3/index.html`
  - `BoxSaleTrackingPage`
- `/Users/joshua/casabe-v3/phase6-slice4-schema.sql`
  - `box_sale_records`

What it does:

- Tracks box sale records.

### Margin Summary

Status: Implemented in current UI.

Directly read:

- `/Users/joshua/casabe-v3/index.html`
  - `MarginSummaryPage`

What it does:

- Summarizes margin-related operational data.

Dependencies:

- Order/payment/expense data.

### Customer Profiles

Status: Implemented in frontend; Address Book R2 is separate draft.

Directly read:

- `/Users/joshua/casabe-v3/index.html`
  - `CustomerProfilePage`

What it does:

- Shows customer-specific profile/order context from existing order/customer data.

### Office, Partner, Commission, And Admin Reporting

Status: Implemented in parts; some backend modules not wired.

Directly read:

- Frontend:
  - `/Users/joshua/casabe-v3/index.html`
  - office/partner/payment/commission data adapter methods.
- Backend module:
  - `/Users/joshua/casabe-v3/src/api/admin-commissions.js`
- SQL:
  - `/Users/joshua/casabe-v3/supabase-rls-policies.sql`

What it does:

- Tracks office payments, shipment expenses, commissions, and audit logs.

Fragile/needs review:

- I did not find `src/api/admin-commissions.js` registered by `backend/server.js`. That means it may be unused unless wired elsewhere.

### Safety Acknowledgements And Zone Validation

Status: Built as modules; wiring not found.

Directly read:

- `/Users/joshua/casabe-v3/src/middleware/safety-validation.js`
- `/Users/joshua/casabe-v3/src/middleware/zone-validation.js`

What it does:

- Creates/verifies signed safety acknowledgement tokens.
- Validates destination zone tokens.
- Exposes registration helpers for related API routes.

Fragile/needs review:

- I did not find these modules imported or registered in `/Users/joshua/casabe-v3/backend/server.js`.

### FixForge Automation

Status: Spec exists; cron/deployment not implemented in this repo.

Directly read:

- `/Users/joshua/.hermes/skills/casabe-konnect/fixforge/SKILL.md`

What it does:

- Defines a future autonomous bug-fix loop downstream of ShipmentTester.
- Requires debug-branch isolation, machine-readable test results, review gates, daily budget caps, Honcho backlog/ledger integration, and daily reports.

Current gaps from the provided bot note and direct skill read:

- Dedicated debug deploy target is not defined in this repo.
- ShipmentTester producer is not present in this repo.
- Honcho access and ledger schema are not defined in this repo.
- Reviewer independence and cron runtime are not wired here.

## 4. INTEGRATIONS & EXTERNAL SERVICES

### Supabase

Directly read:

- Used by frontend, backend, Edge Functions, migrations, and smoke tooling.
- Project metadata exists in `/Users/joshua/casabe-v3/supabase/.temp/linked-project.json`.
- Frontend initializes Supabase from hardcoded runtime config in `index.html`.
- Backend/Edge Functions expect Supabase env vars.

Used for:

- Auth.
- Postgres database.
- RLS.
- RPC functions.
- Edge Functions.

Credential/config names:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Status:

- Wired in code.
- Live applied schema not verified in this export.

### Netlify

Directly read:

- `/Users/joshua/casabe-v3/netlify.toml`

Used for:

- Static frontend hosting.
- Build-time replacement of Google Maps key placeholder.

Credential/config names:

- `GOOGLE_MAPS_API_KEY`

Status:

- Config exists locally but is untracked.
- Deploy status not verified.

### Stripe

Directly read:

- `/Users/joshua/casabe-v3/supabase/functions/stripe-checkout/index.ts`
- `/Users/joshua/casabe-v3/supabase/functions/stripe-webhook/index.ts`
- `/Users/joshua/casabe-v3/migrations/r1-security-revised.sql`

Used for:

- Checkout sessions.
- Webhook processing.
- Payment status merge.
- Event idempotency.

Credential/config names:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Status:

- Wired in Edge Functions and SQL drafts.
- Current docs still treat Stripe/security as release-gating and not fully cleared.

### Twilio

Directly read:

- `/Users/joshua/casabe-v3/supabase/functions/sms-send/index.ts`
- `/Users/joshua/casabe-v3/supabase/functions/sms-status/index.ts`

Used for:

- SMS/WhatsApp-style outbound messages.
- Provider status checks.

Credential/config names:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `TWILIO_WHATSAPP_FROM`

Status:

- Wired in Edge Functions.
- Status docs indicate Twilio/WhatsApp is disabled/deferred.

### Meta/WhatsApp Business

Directly read from environment references:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_API_VERSION`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`

Used for:

- WhatsApp provider configuration/status surfaces.

Status:

- Placeholder/deferred per local status docs.

### Google Maps / Google Routes / Geocoding

Directly read:

- `/Users/joshua/casabe-v3/netlify.toml`
- `/Users/joshua/casabe-v3/index.html`
- route rebuild docs.

Credential/config names:

- `GOOGLE_MAPS_API_KEY`
- `GOOGLE_MAPS_BROWSER_KEY`
- `GOOGLE_GEOCODING_KEY`
- `GOOGLE_ROUTES_KEY`

Used for:

- Maps and route optimization/geocoding features.

Status:

- Placeholder/build-time config exists.
- Route optimization implementation is blocked on Google Cloud/API key setup per local docs.

### Leaflet / OpenStreetMap / Nominatim

Directly read:

- `/Users/joshua/casabe-v3/index.html`

Used for:

- Map rendering and geocoding support.

Status:

- Wired in frontend through public CDN/service usage.

### QuickBooks

Directly read:

- `/Users/joshua/casabe-v3/index.html`
  - `QuickBooksPage`
  - integration status UI.

Used for:

- Accounting integration surface.

Status:

- UI/status placeholder appears present.
- Could not determine whether live QuickBooks API integration exists.

### Honcho / Hermes / ShipmentTester

Directly read:

- `/Users/joshua/.hermes/skills/casabe-konnect/fixforge/SKILL.md`

Used for:

- Planned autonomous FixForge loop and backlog/ledger coordination.

Status:

- Spec exists.
- Integration was not found implemented in `/Users/joshua/casabe-v3`.

## 5. DATA LAYER

### Database

Directly read:

- Primary database is Supabase/Postgres.
- RLS is central to tenant/role isolation.
- Most order payload fields are stored in `orders.data` JSONB, while some fields are top-level columns.

### Core Tables And Entities

Directly read from SQL files and frontend data adapter references:

- `orders`  
  Core order/shipment/customer operational record. Single source of truth for most order fields. Most mutable business payload lives in `data` JSONB. Top-level fields include at least `tenant_id`, and local code/migrations reference `office_id`, `partner_id`, driver-related fields, consent columns, and `delivery_address` in drafts.

- `members`  
  Auth/member/role mapping used by frontend session boot and RLS helpers.

- `offices`  
  Office-level operational unit used in frontend adapter.

- `partners`  
  Partner-level operational unit used in frontend adapter.

- `tenant_settings`  
  Tenant configuration used in frontend adapter.

- `campaigns`  
  Existing campaign records.

- `office_payments`  
  Office payment tracking.

- `shipment_expenses`  
  Expense tracking for margin/commission workflows.

- `office_commission_audit`  
  Commission audit data consumed by frontend adapter.

- `box_orders`  
  Created in `/Users/joshua/casabe-v3/phase1-data-schema.sql`.

- `activity_log`  
  Created in `/Users/joshua/casabe-v3/phase1-data-schema.sql`.

- `payments`  
  Created in `/Users/joshua/casabe-v3/phase5-receipts-schema.sql`.

- `payment_receipts`  
  Created in `/Users/joshua/casabe-v3/phase5-receipts-schema.sql`.

- `invoices`  
  Created in `/Users/joshua/casabe-v3/phase5-receipts-schema.sql`.

- `invoice_items`  
  Created in `/Users/joshua/casabe-v3/phase5-receipts-schema.sql`.

- `box_order_invoices`  
  Created in `/Users/joshua/casabe-v3/phase5-receipts-schema.sql`.

- `idempotency_keys`  
  Created in `/Users/joshua/casabe-v3/supabase-rls-policies.sql`.

- `commissions`  
  Created in `/Users/joshua/casabe-v3/supabase-rls-policies.sql`.

- `commission_audit_log`  
  Created in `/Users/joshua/casabe-v3/supabase-rls-policies.sql`.

- `drivers`  
  Created in `/Users/joshua/casabe-v3/phase2-rls-security.sql`.

- `tape_direct_records`  
  Created in `/Users/joshua/casabe-v3/phase6-slice4-schema.sql`.

- `box_sale_records`  
  Created in `/Users/joshua/casabe-v3/phase6-slice4-schema.sql`.

- `messages`  
  Created in `/Users/joshua/casabe-v3/phase6-slice5-stage3-schema.sql`.

- `message_templates`  
  Created in `/Users/joshua/casabe-v3/phase6-slice5-stage5-templates-schema.sql` and `/Users/joshua/casabe-v3/supabase/migrations/r6-message-templates.sql`.

- `stripe_events`  
  Created in `/Users/joshua/casabe-v3/supabase/migrations/r6-stripe-idempotency.sql`.

- `routes`  
  Drafted in `/Users/joshua/casabe-v3/routes-rebuild/migrations/01-routes-schema-v3.sql`.

- `route_stops`  
  Drafted in `/Users/joshua/casabe-v3/routes-rebuild/migrations/01-routes-schema-v3.sql`.

- `address_book`  
  Drafted in `/Users/joshua/casabe-v3/migrations/r2-address-book-schema-v4.sql`.

- `campaign_audiences`  
  Drafted in `/Users/joshua/casabe-v3/migrations/r2-address-book-schema-v4.sql`.

### Key Relationships

Directly read/inferred from schema and code:

- `orders.tenant_id` scopes all order data to a tenant.
- `members.tenant_id` and member role/app_role are used to authorize HQ/office/driver access.
- Driver access is mediated by helper functions such as `can_access_order(order_id)` and RPC `update_driver_status`.
- `payments`, `payment_receipts`, `invoices`, and invoice items relate to order/payment workflows.
- `messages` relates outbound messaging to tenant/order/recipient state.
- `routes` and `route_stops` draft route plans around orders.
- `address_book` draft imports customer/contact data from historical orders.
- `campaign_audiences` draft connects campaigns to address book targeting.

### Single Source Of Truth For Key Entities

Directly read:

- Orders: `orders` table.
- Most order details: `orders.data` JSONB.
- Tenant and role membership: Supabase Auth plus `members`.
- Driver order write permissions: database RPC/RLS, not direct frontend trust.
- Message templates: `message_templates`.
- Message queue: `messages`.
- Stripe event idempotency: `stripe_events`.

Inferred:

- The frontend adapter `_db` is the primary application data-access layer for the static app.
- Top-level `orders.office_id` and `orders.partner_id` are treated as relational routing/filtering fields, while many customer/shipment details remain in JSONB.

### Migrations And Seed Data

Directly read:

- `apply-migration.js` can apply SQL using `DATABASE_URL`.
- `smoke-setup/create-smoke-accounts.js` and `smoke-setup/create-driver-b.js` create test/smoke accounts.
- `smoke-setup` contains migration and verification SQL for driver RLS/RPC.
- Multiple migration generations exist for the same workstreams. The latest local drafts are not always the applied live truth.

Important latest draft files:

- `/Users/joshua/casabe-v3/migrations/r1-security-revised.sql`
- `/Users/joshua/casabe-v3/migrations/r2-address-book-schema-v4.sql`
- `/Users/joshua/casabe-v3/routes-rebuild/migrations/01-routes-schema-v3.sql`
- `/Users/joshua/casabe-v3/routes-rebuild/migrations/02-orders-delivery-address-v5.sql`
- `/Users/joshua/casabe-v3/routes-rebuild/migrations/03-members-index.sql`

Could not determine:

- Live migration state from the database.
- Whether route/address-book migrations have been applied anywhere.

## 6. ENVIRONMENT & CONFIG

### Required/Referenced Environment Variables

Directly read from `.env.example`, `.env.local`, server code, Edge Functions, Netlify config, and SQL/app tooling references:

- `VITE_SUPABASE_URL`  
  Frontend Supabase URL.

- `VITE_SUPABASE_ANON_KEY`  
  Frontend Supabase anon/publishable key.

- `VITE_API_BASE_URL`  
  Frontend API base URL.

- `VITE_ENABLE_RLS`  
  Feature/security flag for RLS.

- `VITE_ENABLE_AUTH_CHECKS`  
  Feature/security flag for auth checks.

- `VITE_ENABLE_INPUT_VALIDATION`  
  Feature/security flag for input validation.

- `VITE_LOG_LEVEL`  
  Frontend logging level.

- `VITE_DEBUG_MODE`  
  Frontend debug flag.

- `SUPABASE_URL`  
  Backend/Edge Function Supabase URL.

- `SUPABASE_ANON_KEY`  
  Edge Function caller-scoped Supabase client key.

- `SUPABASE_SERVICE_ROLE_KEY`  
  Server/Edge Function service-role key.

- `DATABASE_URL`  
  Direct Postgres connection string used by migration scripts.

- `JWT_SECRET`  
  Backend JWT signing/verification secret.

- `JWT_EXPIRY`  
  Backend JWT expiration.

- `PORT`  
  Express server port.

- `ALLOWED_ORIGINS`  
  Backend CORS allowlist.

- `STRIPE_SECRET_KEY`  
  Stripe API secret key.

- `STRIPE_WEBHOOK_SECRET`  
  Stripe webhook signature secret.

- `TWILIO_ACCOUNT_SID`  
  Twilio account identifier.

- `TWILIO_AUTH_TOKEN`  
  Twilio API auth token.

- `TWILIO_FROM_NUMBER`  
  SMS sender.

- `TWILIO_WHATSAPP_FROM`  
  WhatsApp sender.

- `WHATSAPP_ACCESS_TOKEN`  
  WhatsApp provider access token.

- `WHATSAPP_PHONE_NUMBER_ID`  
  WhatsApp phone number identifier.

- `WHATSAPP_API_VERSION`  
  WhatsApp API version.

- `WHATSAPP_BUSINESS_ACCOUNT_ID`  
  WhatsApp business account identifier.

- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`  
  WhatsApp webhook verification token.

- `GOOGLE_MAPS_API_KEY`  
  Netlify build-time Google Maps key.

- `GOOGLE_MAPS_BROWSER_KEY`  
  Browser Google Maps key referenced by docs/code.

- `GOOGLE_GEOCODING_KEY`  
  Google geocoding key referenced by route work.

- `GOOGLE_ROUTES_KEY`  
  Google routes key referenced by route work.

### Config Files

Directly read:

- `/Users/joshua/casabe-v3/package.json`  
  Node dependencies and scripts.

- `/Users/joshua/casabe-v3/jest.config.js`  
  Jest config with `jsdom` environment and test file patterns.

- `/Users/joshua/casabe-v3/babel.config.js`  
  Babel/Jest transform config.

- `/Users/joshua/casabe-v3/netlify.toml`  
  Static publish and Google Maps placeholder replacement.

- `/Users/joshua/casabe-v3/.env.example`  
  Frontend environment template.

- `/Users/joshua/casabe-v3/.env.local`  
  Local environment file containing `DATABASE_URL`; value not printed.

- `/Users/joshua/casabe-v3/supabase/.temp/linked-project.json`  
  Local Supabase linked project metadata.

- `/Users/joshua/casabe-v3/supabase/.temp/cli-latest`  
  Local Supabase CLI latest-version marker.

### Stand-Up From Scratch

Directly supported by repo:

1. Install Node dependencies:
   - `npm install`
2. Configure env vars using `.env.example` and backend/Edge Function requirements above.
3. Run backend locally:
   - `npm run dev`
4. Serve frontend statically from the repo root.
5. Link/configure Supabase project and apply only approved migrations.
6. Deploy Edge Functions manually through Supabase CLI.
7. Deploy static frontend through Netlify.

Could not determine:

- A complete one-command setup path.
- A single authoritative migration apply order across all historical files.
- A committed script for deploying all Edge Functions.

## 7. INCOMPLETE / IN-PROGRESS WORK

### Dirty / Untracked Worktree

Directly read from git:

- Current branch: `main`.
- Last commit read: `5004f34 fix(routes): Migration 02 v5 — FOR UPDATE closes write-skew in check_no_tape_direct_stop`.
- Worktree is dirty.
- Modified:
  - `/Users/joshua/casabe-v3/supabase/.temp/cli-latest`
- Many untracked docs, migrations, review files, smoke setup files, Netlify config, screenshots, and backups are present.

Why it matters:

- A new developer should not assume `main` is clean.
- Some important current-state files are untracked, including `netlify.toml` and multiple migration/review artifacts.

### R1 Release Gates

Directly read from local handoff docs:

- Stripe/security is a P0 STOP-SHIP workstream until Delta review and approval.
- Driver A/B isolation requires UI-created `SMOKE-001` and `SMOKE-002`, then authenticated Supabase verification.
- R1 release requires both gates green.

Could not determine:

- Whether those smoke orders now exist.
- Whether Delta has run the authenticated isolation suite after the latest documents.

### Spanish Localization Cleanup

Directly read from handoff docs:

- Spanish localization cleanup is marked P1, dirty/not deployed, requiring syntax and EN/ES browser acceptance.

Could not determine:

- Exact files changed for localization from the current inspection alone.

### Routes Rebuild

Directly read:

- Route migrations 01/02/03 exist.
- Migration 02 v5 addresses a concurrency issue with `SELECT ... FOR UPDATE` in the route-stop Tape Direct guard.
- Route optimizer implementation is not started or not fully wired according to handoff docs.

Current state:

- Drafted, reviewed locally, not confirmed applied.

### Address Book R2

Directly read:

- `/Users/joshua/casabe-v3/migrations/r2-address-book-schema-v4.sql` exists.
- Rollback and planning docs exist.

Current state:

- Drafted locally.
- Not implemented in frontend UI.
- Not confirmed applied.

### Twilio / WhatsApp

Directly read:

- Edge Functions and UI surfaces exist.
- Handoff/status docs say Twilio/WhatsApp remains disabled/deferred.

### FixForge

Directly read:

- Skill spec exists.
- Cron job and runtime wiring were not found in this repo.

Open questions from the provided bot note are still valid based on local files:

- Where does the debug branch deploy?
- What is the exact machine-readable daily suite?
- Does ShipmentTester exist and write to Honcho?
- How are Honcho writes locked/coordinated?
- Which independent reviewer is callable?
- Which env var name holds Casabe auth for FixForge?

### Missing Or Fragile Runtime Files

Directly read:

- `index.html` references `phase5-receipts-components.js`.
- I did not see that file in the root directory listing I inspected.

Could not determine:

- Whether the script is intentionally absent, generated elsewhere, or present outside the inspected location.

### Test Infrastructure Gap

Directly verified by running tests:

- Command run: `npm test -- --runInBand`
- Result:
  - 13 test suites passed.
  - 453 tests passed.
  - 1 test suite failed: `/Users/joshua/casabe-v3/tests/runtime-full.spec.js`
  - Failure reason: missing module `@playwright/test`.

Meaning:

- The Jest/source-scan suite is mostly green.
- Full runtime/browser coverage is blocked by a missing dev dependency or missing test setup.

### Test Scaffolding Inside Production HTML

Directly read:

- The end of `index.html` contains test-only stubs and a static R4 test harness, including stubbed versions of services/components for test purposes.

Risk:

- This is useful for inline validation but makes it easier to confuse product code with test scaffolding in a single-file app.

### CDN / Single-File Architecture Risk

Directly read:

- `index.html` comments acknowledge CDN dependencies as launch-risk-accepted and mention bundling before v1.0 GA.

Risk:

- A large single HTML file makes code ownership, bundling, tree-shaking, dependency pinning, source maps, and focused patching harder.

### Stale Status Documentation

Directly read:

- `/Users/joshua/casabe-v3/STATUS.md` says it was last updated 2026-06-01 and references an older commit.

Risk:

- Newer handoff docs and git history should supersede this file unless it is refreshed.

## 8. WHAT I'D NEED TO CONTINUE BUILDING SOLO

### Critical Knowledge Gaps

To continue safely, a new developer would need:

1. Live Supabase migration state  
   The repo has many historical and draft SQL files. The live DB must be queried before applying anything.

2. Production deploy source of truth  
   Need to know whether production Netlify deploys from `main`, a preview branch, manual deploys, or another repo/folder.

3. Current R1 gate status  
   Need confirmed results for:
   - Stripe/security Delta review.
   - UI-created `SMOKE-001` and `SMOKE-002`.
   - Driver A/B authenticated isolation run.

4. Edge Function deployment status  
   Need to know which Supabase functions are deployed and which versions they run.

5. Whether Express backend is in active use  
   The frontend appears Supabase-first. The backend exists but may be legacy/parallel.

6. Secret/config ownership  
   Need the names, owners, and deployment locations for Supabase, Stripe, Twilio, WhatsApp, Google, JWT, Netlify, and database credentials. Values should stay in the secret manager, not docs.

7. Migration ownership rules  
   Need a clear rule for which migration directories are canonical:
   - root SQL files,
   - `/migrations`,
   - `/supabase/migrations`,
   - `/routes-rebuild/migrations`,
   - `/smoke-setup`.

8. Debug/test automation target  
   FixForge requires a real non-production verification target. The repo does not define one clearly.

### Undocumented Or Tribal-Knowledge Decisions Implied By Code

Inferred from code/docs:

- `orders.data` JSONB is the product's flexibility layer, but some security and reporting logic depends on top-level columns. That split must be respected.
- Drivers should not get direct broad `orders` write access. Use RPC and RLS.
- Draft migrations are not automatically safe to apply. Many files encode “do not apply until approved” gates.
- Address Book is intentionally R2 and should not be mixed into R1 release.
- Route rebuild is intentionally separated and Google-dependent work is blocked until API/billing setup.
- Tape Direct orders must be excluded from route stops at the database layer, not just UI.
- Consent fields are security/compliance-sensitive and need latest-event semantics.
- Public/publishable frontend keys may exist in source, but service-role and webhook secrets must never be exposed to the browser.

### Recommended Next Steps

1. Freeze deploys until R1 gates are proven current.

2. Query live Supabase before any migration decision:
   - current tables/columns,
   - applied functions,
   - policies,
   - triggers,
   - Edge Function deployment versions if available.

3. Create or verify `SMOKE-001` and `SMOKE-002` through the HQ UI, then run `/Users/joshua/casabe-v3/smoke-setup/DELTA-DRIVER-ISOLATION-READY.md`.

4. Complete Stripe/security Delta review before production release.

5. Install/configure Playwright test dependency or remove/skip the runtime test intentionally:
   - current blocker is `@playwright/test` missing.

6. Decide whether the Express backend is active:
   - If active, wire/register `src/api/admin-commissions.js`, `src/middleware/safety-validation.js`, and `src/middleware/zone-validation.js` or document why they are dormant.
   - If legacy, mark it clearly to prevent future confusion.

7. Split the frontend from one giant `index.html` into a bundled app before deeper feature work.

8. Promote current untracked operational files intentionally:
   - keep, commit, or archive each current review/migration/runbook artifact.

9. For FixForge, answer the four operational blockers before enabling cron:
   - Honcho access method and credential env var name.
   - Debug branch/deploy target.
   - Independent reviewer command/tool.
   - Casabe auth credential env var name.

10. Establish canonical status:
   - Update or replace stale `/Users/joshua/casabe-v3/STATUS.md`.
   - Keep one current release board that names exactly what is applied, drafted, blocked, and approved.

## Final Verification Note

I was able to verify directly from local files:

- Main app shape and major feature surfaces in `/Users/joshua/casabe-v3/index.html`.
- Backend Express API shape in `/Users/joshua/casabe-v3/backend/server.js`.
- Supabase Edge Functions for Stripe and Twilio.
- Migration/draft SQL artifacts for R1 security, R2 Address Book, and route rebuild.
- Netlify/static frontend config.
- Environment variable names.
- Current git branch, last commit, and dirty/untracked worktree state.
- Local test result: 453 passing tests, 1 failing suite due to missing `@playwright/test`.
- FixForge skill spec exists outside the repo.

Still unclear without additional access or live checks:

- Exact live Supabase schema and applied migration state.
- Exact production Netlify deploy commit/config.
- Whether Edge Functions are deployed and current.
- Whether Express backend is used in production.
- Whether driver smoke orders exist and isolation suite has run.
- Whether Stripe/security R1 has cleared Delta and approval.
- Whether FixForge/Honcho/ShipmentTester exist as runnable services outside this repo.

To fill those gaps, I would need:

- Read-only Supabase inspection or a dumped schema/policy/function report.
- Netlify deployment metadata.
- Edge Function deployment status.
- Current smoke test output after UI-created `SMOKE-001` and `SMOKE-002`.
- Honcho/ShipmentTester/FixForge runtime access details, names only for env vars and secret locations.
