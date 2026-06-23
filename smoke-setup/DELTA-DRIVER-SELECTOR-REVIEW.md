# DELTA QA REVIEW — Stream 1: Driver Selector Fix
**Reviewer:** Delta (QA/Debugger)  
**Date:** 2026-06-10  
**File reviewed:** `~/casabe-v3/index.html`  
**Stream:** 1 — Driver Selector Fix (R1 BLOCKER)

---

## Members Query Checks

- ✅ **Query filters all three:** `tenant_id = currentTenantId` AND `role = 'driver'` AND `active = true`  
  Lines 25279–25288: `.eq('tenant_id', currentTenantId)`, `.eq('role', 'driver')`, `.eq('active', true)` — all present.

- ✅ **`.select()` includes `user_id` AND `display_name`**  
  Line 25283: `.select('user_id, display_name')` — both fields selected.

- ✅ **UUID filter: `.filter(d => !!d.user_id)` present before storing**  
  Lines 25293–25295: `rows.filter(function(d) { return !!d.user_id; })` — present and correct.

- ✅ **Result stored in `membersDrivers` state**  
  Line 25303: `setMembersDrivers(mapped)` — correct.

- ✅ **useEffect dependency array includes `session.tenantId`**  
  Line 25305: `}, [session ? session.tenantId : ''])` — re-runs on tenant change, with null guard.

- ✅ **Error case handled gracefully**  
  Lines 25290–25293: `if (res.error) { console.error(...); return; }` — no crash on failure; silently falls back to empty `membersDrivers`, which then triggers legacy fallback in `tenantDrivers` useMemo.

---

## tenantDrivers useMemo Checks

- ✅ **Prefers `membersDrivers` when non-empty (canonical path)**  
  Line 25316: `if (membersDrivers.length > 0) return membersDrivers;` — correct.

- ✅ **Falls back to legacy `tenant.drivers` blob only when `membersDrivers` is empty**  
  Lines 25317–25323: legacy blob path only reached if `membersDrivers.length === 0` — correct.

- ⚠️ **ADVISORY (not blocking): Legacy fallback UUID-less entries are mapped with `userId: ""`**  
  Line 25321: `return { name: d.name, userId: d.user_id || "", active: ... }` — UUID-less drivers get `userId: ""`.  
  The `onChange` handler writes `assignedDriverUserId = ""` (empty string) not `null` for these entries. This is a minor softness but not a crash or incorrect selection — UUID-less legacy entries are effectively inert for RLS matching. Not a blocker.

- ✅ **UUID-less entries cannot be selected for a new order when `membersDrivers` has results**  
  When membersDrivers is non-empty, the legacy blob is never consulted. UUID-less entries only appear if Supabase query fails AND legacy blob has UUID-less drivers — a double-failure edge case, not typical path.

---

## Dual-Write on Save Checks

- ✅ **`assignedDriver` set to selected driver's display label (string)**  
  Line 4026: `set("assignedDriver", name)` — writes display name.

- ✅ **`assignedDriverUserId` set to selected driver's `user_id` UUID**  
  Line 4028: `set("assignedDriverUserId", userId)` — writes UUID from matched entry.

- ⚠️ **ADVISORY: "No driver selected" writes empty string `""` to both fields, not `null`**  
  When the `"— Unassigned —"` option is selected (value `""`), `name` = `""`, `match` = undefined, `userId` = `""`. Both `assignedDriver` and `assignedDriverUserId` are set to `""`. This is consistent behavior (empty = no driver) but is not a hard null. Downstream RLS/filter code should handle both `null` and `""` as "unassigned". Not a syntax blocker.

- ✅ **Old orders: `assignedDriver` string display is unchanged (not broken)**  
  The `onChange` only fires on user interaction. Existing orders are not touched. Display uses `o.assignedDriver || "—"` (line 5413) — unchanged.

---

## Syntax Check: `node --check`

**❌ FAIL — SYNTAX ERROR INTRODUCED BY STREAM 2 LOCALIZATION**

```
/private/tmp/casabe_check.js:4266
  }, t("\u2713 Save Order & Apply Automation", "\u2713 Guardar Orden y Aplicar Automatizaci\xF3n"))))});
                                                                                                    ^
SyntaxError: missing ) after argument list
```

**Root cause:** Forge's Stream 2 localization wrapped the "✓ Save Order & Apply Automation" button label in `t()` but introduced an extra `});` at the end of the line, breaking the parenthesis balance.

**Old code (HEAD, passes):**
```js
  }, "\u2713 Save Order & Apply Automation")))));<br>
```
(5 closing parens + semicolon)

**New code (working copy, FAILS):**
```js
  }, t("\u2713 Save Order & Apply Automation", "\u2713 Guardar Orden y Aplicar Automatizaci\xF3n"))))});
```
(4 closing parens + spurious `}` + spurious `)` + semicolon)

**File:** `~/casabe-v3/index.html`, line **4324** (JS line 4266 in extracted script).

**Fix required:** Change the ending from `))))});` → `)))))` to restore the original paren balance (the t() call replaces the bare string argument but does not change the surrounding delimiter count). Correct form:
```js
  }, t("\u2713 Save Order & Apply Automation", "\u2713 Guardar Orden y Aplicar Automatizaci\xF3n")))))
```

---

## Acceptance Test File

- ✅ **`~/casabe-v3/smoke-setup/DRIVER-SELECTOR-ACCEPTANCE-TEST.md` exists**  
  File present, 38 lines.

- ✅ **8 steps present**  
  Steps 1–8 confirmed: Log in → Open New Order → Confirm Driver A in dropdown → Create temp order → Verify dual-write → Verify Driver RLS scoping → Clean up → Create SMOKE-001 / SMOKE-002.  
  Includes dual-write verification (Step 5), RLS check (Step 6), and SMOKE-001/002 creation (Step 8).

---

## Stream 1 Verdict

**❌ STILL BLOCKED**

**Blocking issue:** Syntax error at `index.html` line 4324 — extra `});` introduced by Stream 2 localization in the `OrderForm` component's Save button wrapping. `node --check` FAILS. The application will not load.

All driver selector logic checks PASS — the membersDrivers query, useMemo fallback, and dual-write handler are correct. The file cannot be deployed in current state due to the paren imbalance.

**Required fix (1 line):**  
`index.html` line 4324: Change `t("...", "..."))))});` → `t("...", "...")))))`  
(remove the trailing `});`, keep the 5th `)`)

After fix, re-run `node --check` extracted JS to confirm RC=0, then this blocker is cleared.
