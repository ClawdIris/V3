# HQ Order Creation Guide — Smoke Test
**Project:** Casabe Konnect  
**Who:** Forge or authorized smoke-test operator  
**When:** After Delta preflight is signed off AND accounts are created  
**Purpose:** Create smoke orders through the production UI to test real dual-write behavior

> ⚠️ **Do NOT seed orders via SQL.**  
> Orders must be created through the production UI.  
> SQL-seeded orders bypass the dual-write logic under test and will produce  
> misleading smoke results.

---

## Prerequisites

Before starting:

- [ ] `create-smoke-accounts.js` ran successfully with zero errors
- [ ] Credentials for `smoke-hq@casabe-test.internal` are in your password manager
- [ ] Delta preflight sign-off is complete (all 7 checks ✅ or ⚠️ documented)
- [ ] You have a fresh browser window (no cached sessions from prior accounts)

---

## Step 1 — Log In as HQ

1. Open: **https://casabekonnect-app.netlify.app/**
2. Enter credentials:
   - **Email:** `smoke-hq@casabe-test.internal`
   - **Password:** _(from one-time credential summary printed by script)_
3. Click **Sign In**
4. Verify the dashboard loads and shows **HQ** role in the header
5. 📸 **Screenshot:** Take a screenshot of the logged-in HQ dashboard  
   _(filename: `smoke-ss-01-hq-login.png`)_

**If login fails:**
- Confirm account was created successfully (check script output)
- Confirm `members` row was inserted (check script output — no errors on that account)
- Confirm the password was copied correctly

---

## Step 2 — Create Order SMOKE-001

**Purpose:** Test "Need a Box" status assignment to Driver A  

1. Click **New Order** (or the equivalent button in the HQ interface)
2. Fill in the following fields:

   | Field | Value |
   |---|---|
   | Customer name | `Smoke Customer 001` |
   | Phone | `+1-555-000-0001` |
   | Delivery address | `123 Smoke Test Ave, Houston, TX 77001` |
   | Box type | `Standard` (or the default) |
   | Status | `Need a Box` |
   | Assigned driver | `Smoke Driver A` _(smoke-driver-a account)_ |
   | Payment method | `cash` |
   | Payment amount | `50.00` |
   | Payment status | `unpaid` |
   | Office | _(Select the office tied to the smoke office account)_ |

3. Click **Save** / **Create Order**
4. 📸 **Screenshot:** Take a screenshot of the order confirmation / order detail view  
   _(filename: `smoke-ss-02-order-smoke001.png`)_
5. **Record the Order ID** assigned by the system:  
   `SMOKE-001 actual ID: ___________________________`

> **Why this matters:** The Driver portal filters by `o.status === "need_box"` and  
> `o.assignedDriverUserId === driverUserId`. If both fields write correctly, Driver A  
> will see this order in their **My Drop-Offs** tab (not My Pickups — `need_box` orders  
> appear under Drop-Offs because the driver must collect the box from the customer).

---

## Step 3 — Create Order SMOKE-002

**Purpose:** Test "Ready for Pickup" status visibility in the Driver Route view  

1. Click **New Order** again
2. Fill in the following fields:

   | Field | Value |
   |---|---|
   | Customer name | `Smoke Customer 002` |
   | Phone | `+1-555-000-0002` |
   | Delivery address | `456 Smoke Test Blvd, Houston, TX 77002` |
   | Box type | `Standard` (or the default) |
   | Status | `Ready for Pickup` |
   | Assigned driver | `Smoke Driver A` _(same driver)_ |
   | Payment method | `cash` |
   | Payment amount | `75.00` |
   | Payment status | `unpaid` |
   | Office | _(Same office as SMOKE-001)_ |

3. Click **Save** / **Create Order**
4. 📸 **Screenshot:** Take a screenshot of the order confirmation / order detail view  
   _(filename: `smoke-ss-03-order-smoke002.png`)_
5. **Record the Order ID** assigned by the system:  
   `SMOKE-002 actual ID: ___________________________`

> **Why this matters:** The Driver Route page (index.html ~line 6368) reads  
> `o.payment.method === "cash"` and `o.payment.status !== "paid"` to show the  
> "Collect & Pick Up" action. If `payment` JSONB is missing or malformed,  
> the Driver page crashes. These orders validate that HQ order creation  
> produces correct `payment` objects.

---

## Step 4 — Verify Orders Appear in HQ List

1. Return to the main orders list
2. Confirm both SMOKE-001 and SMOKE-002 are visible
3. Confirm their statuses show correctly
4. Confirm driver assignment shows "Smoke Driver A"
5. 📸 **Screenshot:** Take a screenshot showing both orders in the list  
   _(filename: `smoke-ss-04-hq-order-list.png`)_

---

## Step 5 — Record Order IDs for Delta

| Order | Intended Status | Assigned Driver | Actual System ID |
|---|---|---|---|
| SMOKE-001 | Need a Box | Smoke Driver A | |
| SMOKE-002 | Ready for Pickup | Smoke Driver A | |

> **Delta:** These IDs are what you'll use to verify Driver portal visibility  
> and RLS policy correctness in your verification pass.

---

## Step 6 — Sign Out

1. Click **Sign Out** in the HQ dashboard
2. Verify you are returned to the login screen
3. 📸 **Screenshot:** _(filename: `smoke-ss-05-signout.png`)_

---

## Handoff to Delta

After completing all steps above:

1. Upload the 5 screenshots to the shared smoke-test folder
2. Fill in the "Actual System ID" column above
3. Send to Delta with the message:  
   > "HQ orders created. IDs recorded. Screenshots attached.  
   > Ready for Driver portal verification."

---

## Known Risks & Watch Points

| Risk | Impact | Mitigation |
|---|---|---|
| `payment` JSONB not populated by UI | Driver page crashes on these orders | Delta preflight step 5 must confirm shape; if crash occurs, file issue immediately |
| `assignedDriverUserId` not dual-written | Driver A won't see orders in their portal | Check that the driver dropdown writes UUID alongside display name |
| Office RLS mismatch | Orders not visible to office account | Delta preflight steps 4 & 7 must be confirmed |
| `office_id` not set on order | Office filter returns nothing | Check that the UI writes `office_id` when office is selected (source: index.html ~line 3154) |
