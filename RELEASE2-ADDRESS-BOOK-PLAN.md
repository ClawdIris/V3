# RELEASE 2 — Address Book Plan
**Casabe Konnect · Forge (Dev Lead) + Delta (QA Lead)**
**Date:** 2026-06-14
**Status:** PENDING JEFFREY APPROVAL — Schema and plan drafted; no SQL applied

---

## 1. What Is the Address Book?

A tenant-scoped contact directory living in Supabase (`address_book` table).
It stores every customer Casabe has shipped for — with consent flags, tags,
geolocation, and language preference — so that campaigns can target real
audiences instead of static named segments.

**R2 makes campaigns real.** Phase 1 campaigns ship to a named segment ("all",
"vip", etc.) as a placeholder. R2 connects campaigns to actual contacts with
consent gates, geography filters, and tag-based segments.

---

## 2. Navigation — Where It Lives

Address Book appears as a **new tab inside the existing Customers section**,
which is already a top-level nav section in the HQ portal.

### Current Customers section layout (before R2):
```
Customers
  └── [single view — customer list from orders]
```

### Proposed Customers section layout (after R2):
```
Customers
  ├── Customers (tab) — existing order-history customer view (unchanged)
  └── Address Book (tab) — new R2 contact directory
```

**Why inside Customers?**
- Customers is the logical home for "people we ship for."
- Avoids adding a new top-level nav item for R2 scope.
- Address Book is the persistent version of what Customers shows ephemerally.

**Driver view:** Drivers do not see the Address Book tab. Their RLS policy
limits them to contacts on their assigned orders only, accessed only through
order detail views (not the directory).

---

## 3. Connection to Existing Customers Page

### Today (pre-R2):
The Customers page builds its list dynamically from `orders` — a live query
that groups orders by customer name/phone. It is read-only and disappears
if orders are deleted or deduped differently.

### After R2:
| Customers page | Address Book |
|---|---|
| Derived from orders on each page load | Persistent, editable, tenant-owned |
| Name + phone only | Full contact card (address, tags, consent, language, geo) |
| No consent tracking | sms_consent, whatsapp_consent, email_consent |
| No segments / tags | tags TEXT[], preferred_language, coordinate_status |
| No import/export | Import from Orders button; CSV import (future) |

**UI link:** On the Customers page, each customer row gets a **"View in Address Book"** button. If that customer has a matching address_book record (matched by phone), the button opens their contact card. If not, a **"Add to Address Book"** button appears.

**Reverse link:** On the Address Book contact card, an **"Order History"** section shows all orders linked to this phone number, pulling from `orders` via phone match.

---

## 4. Connection to Campaigns Page

### Today (pre-R2):
Campaigns use `audience_key` (a static named segment: 'all', 'active', 'vip',
'inactive', 'small_med', 'pending_pay'). These segments are resolved client-side
at display time — no real recipient list is generated.

### After R2:
When creating or editing a campaign, a new **"Audience" step** appears with:

```
[ Audience Builder ]
  ┌───────────────────────────────────────────────────┐
  │  Geography                                        │
  │    ZIPs: [11201, 11202, 10001]                    │
  │    Cities: [Brooklyn, Queens]                     │
  │    State: NY                                      │
  │    Radius: 15km from [Office Address] (geocoded)  │
  ├───────────────────────────────────────────────────┤
  │  Tags                                             │
  │    [✓] vip   [✓] repeat   [ ] small-shipper       │
  ├───────────────────────────────────────────────────┤
  │  Language                                         │
  │    (•) All   ( ) English only   ( ) Spanish only  │
  ├───────────────────────────────────────────────────┤
  │  Consent Gate (auto-set by channel)               │
  │    Channel: WhatsApp → Require whatsapp_consent ✓ │
  └───────────────────────────────────────────────────┘
  Preview: 847 contacts match · 312 with WhatsApp consent
  [ Use this Audience ]
```

**Consent gate is mandatory and auto-set:**
- WhatsApp campaigns → `require_whatsapp_consent = true`
- SMS campaigns → `require_sms_consent = true`
- Email campaigns → `require_email_consent = true`
- Multi-channel → all relevant consent flags checked per channel

The preview count queries `v_campaign_audience_contacts` (the SQL view in the
migration) to show a live contact count before saving.

### Backward compatibility:
Campaigns with an `audience_key` but no `campaign_audiences` record continue
to work exactly as before. R2 adds `campaign_audiences` as an optional
extension — it does not break or alter existing campaigns.

---

## 5. Import Flow

### Option A: Manual (Button)
- In the Address Book tab, an **"Import from Orders"** button (HQ/Office only)
- Calls `import_contacts_from_orders(tenant_id)` RPC
- Shows a result modal: "Imported 423 contacts · 91 already existed · 0 errors"
- Does not overwrite any existing contacts
- Button stays available indefinitely — idempotent re-runs are safe

### Option B: First-Visit Prompt (Jeffrey's decision needed — see Open Questions)
- On first load of the Address Book tab, if `address_book` count = 0 for the tenant:
  ```
  Your address book is empty.
  [Import from Orders] — adds 423 customers from your order history
  [Start Fresh] — begin with a clean address book
  ```
- This is a friendlier onboarding UX but requires a count check on mount.

**Recommendation:** Option A with an informational banner:
*"You have 423 customers in your order history. Import them to your Address Book?"*
This lets Jeffrey control rollout without surprising HQ users.

---

## 6. Phase Breakdown

### R2 — Ships Now
| Feature | Status |
|---|---|
| `address_book` schema + RLS | ✅ Ready for Jeffrey approval |
| `campaign_audiences` schema + RLS | ✅ Ready for Jeffrey approval |
| `import_contacts_from_orders()` function | ✅ Ready for Jeffrey approval |
| Address Book tab in Customers section | 🔵 Forge builds after schema approval |
| Contact card: view/edit, consent flags, tags | 🔵 Forge builds after schema approval |
| Import from Orders button | 🔵 Forge builds after schema approval |
| Audience Builder in Campaign create/edit | 🔵 Forge builds after schema approval |
| Campaign audience preview count | 🔵 Forge builds after schema approval |
| View in Address Book link (Customers page) | 🔵 Forge builds after schema approval |

### R3 — Later
| Feature | Why Deferred |
|---|---|
| CSV import from external source | Needs file upload handling — scope creep for R2 |
| Geocoding integration (Google Maps API) | Requires API key setup and cost review |
| Automated radius-based targeting | Depends on geocoding being live |
| Consent collection form (self-service) | Needs customer-facing portal |
| Tag management UI (create/rename/delete tags) | Administrative feature, not blocking R2 |
| Address Book → export to CSV | Administrative feature |
| Merge duplicate contacts | Complex UI; dedup is handled at import time |
| WhatsApp/SMS send from Address Book directly | Depends on Meta/Twilio integration |

---

## 7. Open Questions for Jeffrey

**Before Forge writes any UI code, Jeffrey needs to decide these:**

### Q1: Import trigger — manual button or first-visit prompt?
> On the Address Book tab, should the import from orders be:
> (A) Always a manual "Import from Orders" button the user clicks
> (B) An automatic prompt on first visit if address book is empty
> (C) Run automatically (silently) on first visit
>
> Recommendation: (A) with an informational banner. Reason: silent auto-imports
> can confuse users who didn't expect data to appear. A button with a preview
> count is more trustworthy.

### Q2: Address Book tab location
> Should Address Book be:
> (A) A tab inside the Customers section (proposed above)
> (B) Its own top-level nav item (more prominent, easier to find)
> (C) Inside the Comms section alongside Campaigns
>
> Recommendation: (A) for R2. It can be promoted to top-level in R3 if usage
> warrants it. Inside Comms is wrong — address book is a data asset, not a
> comms action.

### Q3: Driver visibility of Address Book
> Should drivers see ANY address book view?
> (A) No — they only see customer info on individual order cards (current plan)
> (B) Yes — they can look up a contact by phone when at a pickup
>
> Current plan: (A). Driver RLS allows SELECT on contacts linked to their orders,
> but the Address Book tab itself is hidden from the driver portal.

### Q4: Consent collection at order creation
> When a new order is created, should there be a consent checkbox for:
> (A) WhatsApp marketing messages
> (B) SMS marketing messages
>
> Currently: `orders.sms_opted_in` and `whatsapp_opted_in` exist (R6 migration).
> Import function copies these to address_book. But if the order form doesn't
> show these fields, they default to false and no contacts get consent.
>
> Decision needed: Add explicit consent checkboxes to the new order form in R2,
> or handle consent separately in the Address Book contact edit UI?

### Q5: Campaign audience — backward compat for audience_key
> After R2, should old campaigns with `audience_key = 'vip'` etc. still work
> for sends (when sends are enabled), OR should they require migration to the
> new campaign_audiences system?
>
> Recommendation: Both work — audience_key remains functional for simple sends.
> campaign_audiences is additive for rich targeting. No migration of old campaigns
> required unless Jeffrey wants unified behavior.

---

## 8. Delta Review Section

**Delta (QA Lead) — Schema Review, Consent Enforcement, RLS Correctness**
**Date:** 2026-06-14

---

### 8.1 Schema Review

#### ✅ Tenant isolation
- `tenant_id TEXT NOT NULL` on both `address_book` and `campaign_audiences`
- All RLS policies check `is_member(tenant_id)` before any role check
- No policy uses `USING (true)` — all are scoped

#### ✅ RLS — address_book
- `ab_hq_office_all`: HQ/Office/Owner/Admin get full CRUD scoped to their tenant ✓
- `ab_driver_select`: Drivers get SELECT only on contacts whose phone appears on their assigned orders. Uses subquery into `orders.data->>'assignedDriverUserId'` — same pattern as R1. ✓
- `ab_anon_blocked`: Explicit `USING (false)` — anon cannot read or write. ✓
- **Note:** Driver policy subquery may be slow on large tenants with many orders. Recommend reviewing query plan after production data load. Index on `orders.phone` and `orders.data->>'assignedDriverUserId'` may be needed. Flag for R2 post-deploy smoke.

#### ✅ RLS — campaign_audiences
- `ca_hq_office_all`: HQ/Office full CRUD ✓
- `ca_driver_anon_blocked`: Drivers blocked from campaign audience data ✓
- `ca_anon_blocked`: Anon blocked ✓

#### ✅ No hard deletes
- `is_active BOOLEAN NOT NULL DEFAULT true` on address_book ✓
- No DELETE policies granted to any role on address_book ✓
- campaign_audiences: soft-delete not applicable (audience configs can be deleted by HQ; they are config, not data records). This is acceptable.

#### ✅ Consent enforcement — dual layer
1. `address_book` columns: `sms_consent`, `whatsapp_consent`, `email_consent` — all `BOOLEAN NOT NULL DEFAULT false` (safe default = opt-out) ✓
2. `campaign_audiences`: `require_sms_consent`, `require_whatsapp_consent`, `require_email_consent` — enforced in the SQL view `v_campaign_audience_contacts` ✓
3. The view applies consent gates in WHERE clause — contacts without the required consent do NOT appear in audience resolution ✓

#### ⚠️ Schema concerns / flags before Jeffrey approves

**CONCERN 1: campaigns.id type unknown**
The `campaign_audiences.campaign_id UUID` assumes campaigns.id is UUID.
The live campaigns table was created by the Phase 1 campaign engine which
calls `.upsert([row], { onConflict: "id" })`. This is almost certainly UUID
(Supabase default), but the FK is NOT declared in the migration as a formal
constraint because the live type was not confirmed by Forge at time of writing.

**Delta action item:** Before applying, run:
```sql
SELECT data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'id';
```
If `uuid`, add the FK constraint. If not, adjust `campaign_id` type accordingly.

**CONCERN 2: Driver RLS subquery — phone vs whatsapp**
The driver policy checks `address_book.phone IN (orders.phone UNION orders.whatsapp)`.
This is correct for matching by phone, but contacts imported from orders where the
primary contact field is `whatsapp` (not `phone`) may not be reachable if `phone`
is NULL on the contact record.

Delta will verify: create a test contact with phone=NULL, whatsapp='5551234567',
assign an order with that whatsapp number to a test driver, and confirm the driver
can see the contact.

**CONCERN 3: set_updated_at() function already exists**
The migration uses `CREATE OR REPLACE FUNCTION set_updated_at()`. If another
migration has already created a `set_updated_at()` with different behavior,
this will silently overwrite it. Check live DB first:
```sql
SELECT prosrc FROM pg_proc WHERE proname = 'set_updated_at'
  AND pronamespace = 'public'::regnamespace;
```

---

### 8.2 Campaign Audience Tests — Delta's QA Checklist

These tests will be run after Jeffrey approves and Forge applies the migration.
Tests use Supabase SQL editor with role-switching.

#### T1: Tenant Isolation
- Create contacts for tenant A and tenant B
- Log in as HQ user of tenant A
- Query `SELECT * FROM address_book` → must return ONLY tenant A contacts
- Query `SELECT * FROM address_book WHERE tenant_id = 'tenant-b'` → 0 rows

#### T2: Anon Blocked
- Run `SET ROLE anon; SELECT * FROM address_book; RESET ROLE;`
- Expected: 0 rows (RLS blocks)
- Also test: `SET ROLE anon; INSERT INTO address_book (tenant_id, name) VALUES ('x','y'); RESET ROLE;`
- Expected: permission denied

#### T3: Driver Scope — assigned order contact visible
- Create contact C1 with phone '5551234567', tenant 'casabe-test'
- Create order O1 in tenant 'casabe-test' with phone='5551234567', data→assignedDriverUserId = driver_user_id
- Log in as driver → `SELECT * FROM address_book` → must return C1

#### T4: Driver Scope — unassigned order contact NOT visible
- Create contact C2 with phone '5559999999', tenant 'casabe-test'
- Log in as same driver → must NOT see C2 (no order assigned to driver with that phone)

#### T5: Consent gate — view filters correctly
- Create contact C3: whatsapp_consent=false
- Create campaign audience A1: require_whatsapp_consent=true
- Query `SELECT * FROM v_campaign_audience_contacts WHERE audience_id = A1.id`
- Expected: C3 does NOT appear

#### T6: Consent gate — consented contact appears
- Create contact C4: whatsapp_consent=true, all geo/tag filters pass
- Same audience A1
- Query the view → C4 DOES appear

#### T7: Tag filter — overlap
- Create contacts: C5 with tags={'vip','repeat'}, C6 with tags={'new'}
- Audience with filter_tags={'vip'}
- Query the view → C5 appears, C6 does not

#### T8: Geography filter — ZIP
- Contacts: C7 zip='11201', C8 zip='10001'
- Audience with filter_zips={'11201'}
- Query → C7 appears, C8 does not

#### T9: Import function — happy path
- Call `SELECT * FROM import_contacts_from_orders('casabe-test');`
- Expected: imported_count > 0, error_count = 0
- Run a second time → imported_count = 0, skipped_count increases (idempotent)

#### T10: Import function — does not overwrite manual contact
- Create manual contact M1 with phone='5551234567', name='Manual Customer'
- Run import where orders has same phone with different name
- After import: M1 name still = 'Manual Customer' (skipped)

#### T11: Import function — role gate
- Call as driver role
- Expected: exception raised ('insufficient role — HQ or Office required')

#### T12: is_active=false contact invisible to driver
- Create contact C9: is_active=false
- Assign order with C9's phone to driver
- Driver query → C9 does NOT appear (ab_driver_select includes `is_active = true` filter)

---

### 8.3 Delta Verdict

**Schema status: APPROVED FOR JEFFREY REVIEW**

The schema is structurally sound. Consent enforcement is dual-layered (column
defaults + view WHERE clause). Tenant isolation is correct. The `USING (false)`
anon block is present on both tables. No `USING (true)` policies exist.

**Two items need resolution before apply:**
1. Confirm `campaigns.id` type is UUID to finalize `campaign_audiences.campaign_id` FK
2. Confirm `set_updated_at()` does not already exist with different logic

**Driver RLS subquery** (phone ∪ whatsapp) warrants a post-deploy smoke test
to confirm performance on real tenant data. Flag as P1 for the R2 smoke checklist.

---

*Forge + Delta — ready for Jeffrey Gonzalez sign-off.*
