# Spanish Localization Audit Inventory
**Date:** 2026-06-10  
**Auditor:** Forge (automated + manual review)  
**File:** `index.html`  
**Method:** grep-based scan of JSX render layer for English strings not wrapped in `t()` or `T()`

---

## Fixed in This Session (41 strings)

| # | Surface | Component / Location | English String | Line # | Notes |
|---|---|---|---|---|---|
| 1 | Shipments panel — selector label | Overview / ShipmentPanel | `🚢 Shipment:` | 7989 | Fixed: `"\uD83D\uDEA2 " + t("Shipment:", "Envío:")` |
| 2 | Shipments panel — default option | Overview / ShipmentPanel | `— All shipments —` | 7995 | Fixed: `t("— All shipments —", "— Todos los envíos —")` |
| 3 | Shipments panel (Finance) — selector | Finance / ShipmentPanel | `🚢 Shipment:` | 8502 | Fixed same pattern |
| 4 | Shipments panel (Finance) — default option | Finance | `— All shipments —` | 8508 | Fixed same pattern |
| 5 | Dashboard dup-banner | Orders page | `Same-driver duplicates auto-group on route` | 8064 | Fixed: full `t()` |
| 6 | Dashboard dup-banner | Orders page | `Cross-driver duplicates need review` | 8064 | Fixed: full `t()` |
| 7 | Dashboard dup-banner — dynamic | Orders page | `N duplicate address(es) detected` | 8075 | Fixed: dynamic `t()` with interpolated count |
| 8 | Dashboard dup-banner | Orders page | `View details` / `Hide details` | 8090 | Fixed |
| 9 | Dashboard dup-banner | Orders page | `Dismiss` | 8097 | Fixed |
| 10 | New Order modal — WhatsApp checkbox | OrderForm | `Send customer box status updates by WhatsApp/SMS` | 3509 | Fixed |
| 11 | New Order modal — label | OrderForm | `Partner / Intake Source` | 3600 | Fixed |
| 12 | New Order modal — label | OrderForm | `Assign to Shipment` | 3645 | Fixed |
| 13 | New Order modal — button | OrderForm / Box section | `+ Add Box` | 3720 | Fixed |
| 14 | New Order modal — box label | OrderForm / Box row | `Declared Value ($)` | 3802 | Fixed |
| 15 | New Order modal — box label | OrderForm / Box row | `📍 Department / City` | 3817 | Fixed |
| 16 | New Order modal — box label | OrderForm / Box row | `Description / Contents` | 3844 | Fixed |
| 17 | New Order modal — box button | OrderForm / Box Recipient | `Same as Consignee` | 3855 | Fixed |
| 18 | New Order modal — box button | OrderForm / Box Sender | `Same as Customer` | 3873 | Fixed |
| 19 | New Order modal — box label | OrderForm / Box row | `⚠ Danger Zone` | 3882 | Fixed |
| 20 | New Order modal — pricing | OrderForm | `Suggested price` | ~3985 | Fixed |
| 21 | New Order modal — payment label | OrderForm | `Status` (payment section) | ~4097 | Fixed |
| 22 | New Order modal — payment label | OrderForm | `Method` | ~4115 | Fixed |
| 23 | New Order modal — payment label | OrderForm | `Amount Charged ($)` | ~4132 | Fixed |
| 24 | New Order modal — payment label | OrderForm | `Amount Paid ($)` | ~4148 | Fixed |
| 25 | New Order modal — payment label | OrderForm | `Manual` (price override badge) | ~4132 | Fixed |
| 26 | New Order modal — payment action | OrderForm | `Reset` (price override) | ~4132 | Fixed |
| 27 | New Order modal — Cancel button | OrderForm | `Cancel` | 4321 | Fixed |
| 28 | New Order modal — Save button | OrderForm | `✓ Save Order & Apply Automation` | 4324 | Fixed |
| 29 | New Order modal — quick-fill sender | OrderForm / CustomerSearch | `Quick-fill: type sender name or phone...` | 22794 | Fixed (placeholder) |
| 30 | New Order modal — quick-fill receiver | OrderForm / ReceiverSearch | `Quick-fill: type receiver name or local phone...` | 23015 | Fixed (placeholder) |
| 31 | New Order modal — description label | OrderForm | `Description` (modal-section header) | ~4183 | Fixed |
| 32 | New Order modal — notes placeholder | OrderForm | `Contents, special instructions...` | 4191 | Fixed (placeholder) |
| 33 | New Order modal — customer language | OrderForm | `Customer Language / Idioma` | 3514 | Fixed |
| 34 | Topbar — Quick Scan button | AppShell / Topbar | `Quick Scan` | 29863 | Fixed |
| 35 | Topbar — Quick Scan tooltip | AppShell / Topbar | `Quick Scan — single box...` | 29862 | Fixed (title attr) |
| 36 | Sidebar role switcher — role labels | AppShell / Sidebar | `Office`, `Driver` (role pill labels) | 29753 | Fixed — HQ left as brand acronym |
| 37 | Sidebar role info | AppShell / LIVE_ROLES | `Office Worker` (role display) | ~25370 | Fixed |
| 38 | Sidebar role info | AppShell / LIVE_ROLES | `Driver` (role display for driver user) | ~25376 | Fixed |
| 39 | Sidebar role info | AppShell / LIVE_ROLES | `Owner` (HQ fallback display name) | ~25361 | Fixed |
| 40 | Shipment counter | Finance page | `N orders`, `Prior: N orders`, `No prior shipment` | 8517-8518 | Fixed (dynamic) |
| 41 | Various modals — Cancel buttons | Multiple modals (x13 instances) | `Cancel` | 11913, 12217, 14060, 17573, 26537, others | Fixed: all 13 instances via batch replace |

---

## Known Gaps / Not Fixed (Intentional)

| Surface | String | Reason |
|---|---|---|
| Topbar role switcher | `HQ` | Left as brand/internal acronym per Jeffrey's instruction |
| Receipt / Label printout | English copy text | Print templates use `t()` in most labels; remaining English in templates is for print-side output which always includes bilingual content |
| Admin onboarding wizard | Various setup strings | Not in Jeffrey's screenshot scope; separate audit ticket |
| Seed/fallback `ROLES` object (line ~22268) | `"Head Office"`, `"Office"`, etc. | These are internal default data structures, not directly rendered. Live path uses `T()` wrappers at point of use |
| `status` chip labels (STATUS_CFG) | Already translated via existing `v.label` values | Status labels come from `STATUS_CFG` which uses `t()`-resolved values at definition time |
| Dynamic driver scorecard | `"No driver data yet..."` | Low priority; not in Jeffrey's screenshot |
| Loading screen | `"Loading…"` | Momentary splash; language preference not yet loaded at that point |

---

## Summary

- **Strings inventoried:** 41 untranslated UI strings  
- **Strings fixed:** 41  
- **Dynamic strings handled correctly:** YES (interpolated with full-sentence pattern)  
- **DB contracts preserved:** YES (no `t()` wrapped around stored enum values)  
- **node --check result:** PASS  
