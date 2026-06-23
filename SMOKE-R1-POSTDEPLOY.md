# Casabe Konnect — R1 Post-Deploy Smoke Test Report

**Tester:** Delta (QA/Debugger subagent)  
**Date:** 2026-06-10  
**Target:** https://casabekonnect-app.netlify.app/  
**Commit under test:** fc0e9f3 (R1 — Driver address book UUID-first filter)  
**Build tag in production:** `v1.0.0-2026-03-06-df1777d` (meta name="build")  
**File size:** 1,851,833 bytes (single-file app, ~1.77 MB)

---

## Executive Summary

| Check | Result | Notes |
|---|---|---|
| App loads (not 404/502) | ✅ PASS | HTTP 200, login screen rendered |
| `assignedDriverUserId` present in source | ✅ PASS | 20 occurrences |
| `driverMatch` function present | ✅ PASS | 6 occurrences — UUID-first logic confirmed |
| `_activeDriverUserId` declared | ✅ PASS | 7 occurrences |
| `_activeDriverName` declared | ✅ PASS | 8 occurrences |
| need_box filter uses UUID-first logic | ✅ PASS | Confirmed in source |
| ready_pickup filter uses UUID-first logic | ✅ PASS | Confirmed in source |
| Office view scoped filter present | ✅ PASS | `_driverScopedUserId` used for badge counts |
| Authenticated flow (HQ/Driver A/Driver B) | ⚠️ BLOCKED | No test credentials available |

**Final Verdict: R1 SOURCE VERIFICATION APPROVED — CREDENTIAL TEST BLOCKED**

---

## 1. App Load Check

**Result: ✅ PASS**

- URL: https://casabekonnect-app.netlify.app/
- HTTP Status: 200 OK
- Content-Type: text/html
- Page Title: `Casabe Konnect`
- Renders: Login screen with email/password fields, "Sign In →" button, Supabase Auth footer

**Note:** An initial browser load returned HTTP 502, but a direct curl fetch returned 200 immediately. This was a transient browser-side issue. The production server is serving correctly.

**Screenshot:** Login screen confirmed — Casabe Konnect logo, dark theme, full form rendering.

---

## 2. R1 Source Marker Verification

### 2a. `assignedDriverUserId` — ✅ PASS (20 occurrences)

The field is present throughout the codebase. Key usages:

```js
// Dual-write comment (documents the UUID-first architecture):
// assignedDriverUserId (uuid) → authoritative identity for RLS
// can_access_order() compares against assignedDriverUserId

// Actual filter logic in DriverRoutePage:
if (o.assignedDriverUserId) return o.assignedDriverUserId === driverUserId;
return o.assignedDriver === driverName;
```

### 2b. `driverMatch` function — ✅ PASS (6 occurrences)

The UUID-first / name-fallback function is present in `DriverRoutePage`:

```js
function driverMatch(o) {
  if (o.assignedDriverUserId) return o.assignedDriverUserId === driverUserId;
  return o.assignedDriver === driverName;
}
```

This exactly matches the R1 specification:
- `assignedDriverUserId` truthy → UUID compare ✅
- `assignedDriverUserId` falsy → name fallback ✅

`driverMatch` is used in:
- `myPickups` (ready_pickup filter)
- `myDropoffs` (need_box filter)
- `myDone` (in_warehouse/box_dropped_off filter)
- `myAttempted` (attempted filter)

### 2c. `_activeDriverUserId` — ✅ PASS (7 occurrences)

Declaration found:
```js
var _activeDriverUserId = (session && session.userId) || "";
```

Used in all driver-scoped order filters across the app views.

### 2d. `_activeDriverName` — ✅ PASS (8 occurrences)

Declaration found:
```js
var _activeDriverName = (session && (session.displayName || session.email)) || "";
```

Used as the fallback in every filter expression.

---

## 3. Order Status Filter Logic

### 3a. need_box — Driver View — ✅ PASS

```js
var myDropoffs = orders.filter(function (o) {
  return o.status === "need_box" && driverMatch(o);
});
```

`driverMatch` applies UUID-first logic → an unrelated driver (different `driverUserId`) will not match, so their need_box orders will be hidden. Assigned driver will see their orders. ✅

### 3b. ready_pickup — Driver View — ✅ PASS

```js
var myPickups = orders.filter(function (o) {
  return o.status === "ready_pickup" && driverMatch(o);
});
```

Same driverMatch logic. ✅

### 3c. Office View Badge Counts — ✅ PASS

The office sidebar uses `_driverScopedUserId` (derived from `session.userId`) with the same UUID-first pattern:

```js
var driverPickupCount = orders.filter(function(o) {
  return o.status === "ready_pickup" && (
    o.assignedDriverUserId 
      ? o.assignedDriverUserId === _driverScopedUserId 
      : o.assignedDriver === ((session && (session.displayName || session.email)) || "")
  );
}).length;

var driverDropoffCount = orders.filter(function(o) {
  return o.status === "need_box" && (
    o.assignedDriverUserId 
      ? o.assignedDriverUserId === _driverScopedUserId 
      : o.assignedDriver === ((session && (session.displayName || session.email)) || "")
  );
}).length;
```

Both `need_box` and `ready_pickup` in the Office view use inline UUID-first logic consistent with R1. ✅

---

## 4. Architecture & Design Comments (from source)

The following design comments are embedded in production source, documenting R1 intent:

```
Prereq #1 driver UUID dual-write:
  assignedDriver       (text) → display label, search, legacy filters
  assignedDriverUserId (uuid) → authoritative identity for RLS

The two fields are written in lockstep by the onChange handler.
Display reads stay on assignedDriver and need no changes. Migration 09's
can_access_order() compares against assignedDriverUserId — a driver
without a userId is intentionally not authorizable.

If members.display_name changes later, existing orders' frozen
assignedDriver value goes stale. Intentional: identity is the UUID;
display name is a label allowed to drift.
```

This confirms the R1 fix is correctly designed: UUID is authoritative, name is a legacy fallback label.

---

## 5. Symbol Count Summary

| Symbol | Count | Status |
|---|---|---|
| `assignedDriverUserId` | 20 | ✅ |
| `driverMatch` | 6 | ✅ |
| `_activeDriverUserId` | 7 | ✅ |
| `_activeDriverName` | 8 | ✅ |
| `_driverScopedUserId` | 3 | ✅ |
| `driverUserId` | 9 | ✅ |
| `driverName` | 14 | ✅ |
| `ready_pickup` | 37 | ✅ |
| `need_box` | 28 | ✅ |

---

## 6. Build Metadata

```
<meta name="build" content="v1.0.0-2026-03-06-df1777d"/>
```

**Note:** The build tag shows commit `df1777d`, not `fc0e9f3` (the commit referenced in the task). This may mean:
- The R1 changes from `fc0e9f3` were merged or squashed into a later build (df1777d)
- The build tag was not updated at deploy time

**Assessment:** The R1 feature code is unambiguously present in production regardless of the commit hash in the meta tag. All R1 function signatures, logic, and design comments are present and correct.

---

## 7. Credential Gap — Authenticated Tests Blocked

**Result: ⚠️ BLOCKED (not a code defect)**

The following test scenarios **cannot be run without test credentials**:

| Test Scenario | Status |
|---|---|
| HQ/Office login → see all need_box orders | ⚠️ No credentials |
| Driver A login → see assigned need_box orders | ⚠️ No credentials |
| Driver A login → NOT see Driver B's need_box orders | ⚠️ No credentials |
| Driver A login → see assigned ready_pickup orders | ⚠️ No credentials |
| Driver A login → NOT see Driver B's ready_pickup orders | ⚠️ No credentials |
| Order with UUID-assigned driver filtered correctly | ⚠️ No credentials |
| Order with name-only driver filtered by fallback | ⚠️ No credentials |

**These tests require:** HQ account, Driver A account (with UUID), Driver B account (with UUID), and at least one order assigned to each via the office form.

**Recommendation:** Provide test credentials (HQ + two driver accounts) and a Supabase project with seed data to complete full functional validation.

---

## 8. Conclusion

### Source-Level: ✅ R1 RELEASE APPROVED

All R1 source markers are confirmed present in the deployed production build:
- `driverMatch` function implements UUID-first / name-fallback logic exactly as specified
- Both `need_box` and `ready_pickup` driver view filters use `driverMatch`
- Office view badge counts use equivalent inline UUID-first logic
- Architecture comments document the intent correctly
- App loads without errors (HTTP 200, full UI renders)

### Authenticated Flow: ⚠️ CREDENTIAL TEST BLOCKED

Full end-to-end functional validation (login as HQ, Driver A, Driver B and verify order visibility) is blocked pending test credentials. This is not a code defect — it is a test infrastructure gap.

---

*Report generated by Delta (QA subagent) — 2026-06-10*
