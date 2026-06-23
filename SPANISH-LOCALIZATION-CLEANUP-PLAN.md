# Spanish Localization Cleanup Plan

## Goal

When Spanish mode is active, every visible user-facing label, alert, button,
placeholder, status, and empty state must render in Spanish across HQ, Office,
Driver, and shared order-detail surfaces.

## Screenshot Findings

The owner screenshot shows Spanish mode with these English strings still visible:

- `VIEWING AS`
- `Head Office`
- `Owner`
- `HQ`, `Office`, `Driver`
- `DASHBOARD`
- `ORDERS & SHIPMENTS`
- `Shipment:`
- `— All shipments —`
- `Quick Scan`
- `+ New Order`
- `Search...`
- `9 duplicate addresses detected`
- `Same-driver duplicates auto-group on route`
- `View details`
- `Dismiss`

Live inspection of the New Order modal also found:

- `Quick-fill: type sender name or phone...`
- `Send customer box status updates by WhatsApp/SMS`
- `Office`
- `Partner / Intake Source`
- `Assign to Shipment`
- `+ Add Box`
- `Declared Value ($)`
- `Department / City`
- `Description / Contents`
- `Recipient`, `Sender`, and their field labels
- `Danger Zone`
- `Same as Customer` / `Same as Consignee`
- `Suggested price`
- Every visible order-status button
- Payment status and method option labels
- `Cancel`
- `✓ Save Order & Apply Automation`

## Forge Tasks

1. Create a complete inventory of user-facing strings in `index.html`.
   - Include JSX text, button labels, placeholders, option labels, badges,
     notifications, confirmation dialogs, chart labels, table headers, and
     dynamically generated strings.
   - Exclude developer comments, test assertions, and internal identifiers.

2. Replace every direct user-facing English string with the existing `t(en, es)`
   localization helper or the platform's established translation pattern.

3. Add translations for role and navigation labels.
   - `Head Office` → `Oficina Central`
   - `Owner` → `Propietario`
   - `Office` → `Oficina`
   - `Driver` → `Conductor`
   - Preserve `HQ` only if the owner confirms it is a brand/internal acronym.

4. Localize dynamic dashboard messages with variables.
   - Duplicate-address warning and action buttons.
   - Shipment selector and shipment names where appropriate.
   - Search and form placeholders.
   - Toasts, validation errors, empty states, and confirmation dialogs.
   - Avoid concatenating translated fragments; translate complete sentences
     with interpolated values so Spanish grammar remains correct.

5. Audit all four primary role surfaces:
   - HQ
   - Office
   - Driver
   - Customer/public tracking

6. Preserve stored database values and API contracts.
   - Do not translate status keys, role keys, IDs, or persisted enum values.
   - Translate only their display labels.

## Delta Acceptance Tests

1. Open `?debug=1`, switch to Spanish, and inspect HQ, Office, and Driver views.
2. Navigate every sidebar tab and open every major modal.
3. Create and edit an order in Spanish mode.
   - Include every field, dropdown option, consent label, status button, payment
     option, validation error, automation message, and action button.
4. Trigger validation errors, warnings, empty states, and notifications.
5. Search rendered visible text for known English labels.
6. Switch back to English and verify no Spanish labels remain.
7. Refresh while Spanish is selected and verify language preference persists.
8. Test desktop and mobile widths.

## Release Gate

- No visible English remains while Spanish mode is active, except approved
  names, acronyms, customer-entered content, addresses, and external brands.
- English mode remains unchanged.
- No database values or RLS/API behavior changes.
- Delta provides screenshots for HQ, Office, Driver, order creation, and mobile.
