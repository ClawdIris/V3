# DELTA REVIEW V3 — Smoke Setup QA Report

**Reviewer:** Delta (QA/Debugger)  
**Date:** 2026-06-10  
**Scope:** Re-review of v3 smoke-setup files for Jefe's 6 blocking fixes  
**Files Reviewed:**
- `smoke-setup/create-smoke-accounts.js`
- `smoke-setup/DELTA-PREFLIGHT.md`
- `smoke-setup/HQ-ORDER-CREATION.md`

---

## Syntax Check

**Command:** `node --check ~/casabe-v3/smoke-setup/create-smoke-accounts.js`  
**Result:** ✅ PASS — zero errors, clean exit (EXIT:0)

---

## Fix-by-Fix Verification

---

### Fix 1 — Role-column logic (create-smoke-accounts.js)

**Status: ✅ CONFIRMED**  
**File:** `create-smoke-accounts.js`  
**Lines:** 99–100, 215–218

**Evidence:**
```js
// Line 99-100 — constants declared at top of file:
const ROLE_COLUMN = 'role';
const APP_ROLE_COLUMN = 'app_role';

// Lines 215-218 — single members insert path, both columns always written:
const membersRow = {
  ...
  [ROLE_COLUMN]: account.role,        // line 217 — writes `role`
  [APP_ROLE_COLUMN]: account.role,    // line 218 — writes `app_role`
  ...
};
```

There is exactly **one** `.insert(membersRow)` path (line 231). Because `membersRow` is built once and always includes both `[ROLE_COLUMN]` and `[APP_ROLE_COLUMN]`, every members row insert — for all four accounts (hq, office, driver-a, driver-b) — writes **both** `role` and `app_role`. No conditional branch omits either field.

---

### Fix 2 — Payment JSONB query (DELTA-PREFLIGHT.md)

**Status: ✅ CONFIRMED**  
**File:** `DELTA-PREFLIGHT.md`  
**Lines:** 170–172, 186

**Evidence:**
```sql
-- Line 170-172 — JSONB path operator used correctly:
SELECT id, data->'payment' AS payment_shape
FROM orders
WHERE data->'payment' IS NOT NULL
LIMIT 3;
```

The preflight explicitly states at line ~162: _"Payment is stored inside the `data` JSONB column, not as a top-level column."_ The inspection query at lines 170–172 uses `data->'payment'` (JSONB arrow operator), and the blocker line at 186 also references `data->'payment'`. There is no query in the file that uses `SELECT ... payment FROM orders` as a bare column reference.

---

### Fix 3 — Rollback on members failure (create-smoke-accounts.js)

**Status: ✅ CONFIRMED**  
**File:** `create-smoke-accounts.js`  
**Lines:** 236–244

**Evidence:**
```js
// Lines 236-244 — catch block, inside the try/catch wrapping the insert:
} catch (membersError) {
  console.error(`  ❌ members insert failed: ${membersError.message}`);
  console.error(`     Code: ${membersError.code} | Details: ...`);
  console.error(`  🔄 Rolling back Auth user ${account.email} ...`);
  await supabase.auth.admin.deleteUser(userId);               // line 242
  console.error(`  [ROLLBACK] Auth user ${account.email} deleted after members insert failure`);
  errors.push(...);
  throw membersError;                                          // line 245
}
```

The `deleteUser(userId)` call (line 242) is:
- **Inside** the catch block (not outside it)
- **Awaited** correctly — it's async and properly awaited
- **Followed by** a re-throw (`throw membersError`) so the error propagates and the credential is never added to the output summary
- Applied to the exact `userId` returned from `createUser()` earlier in the same loop iteration

This is a correct and complete rollback pattern.

---

### Fix 4 — Security warning block (create-smoke-accounts.js + DELTA-PREFLIGHT.md)

**Status: ✅ CONFIRMED**  
**Files:** Both files  
**Lines:**  
- `create-smoke-accounts.js` lines 36–41 (inline comment block after imports)  
- `DELTA-PREFLIGHT.md` lines 3–6 (blockquote at top of document)

**Evidence from create-smoke-accounts.js (lines 36–41):**
```js
// ⚠️  SECURITY: Run this script MANUALLY in a trusted local terminal only.
// Do NOT execute via OpenClaw, Codex, or any agent session.
// Credentials are printed to stdout — agent sessions retain stdout in logs.
// After running: immediately save credentials to your password manager and
// clear your terminal history.
```

**Evidence from DELTA-PREFLIGHT.md (lines 3–6):**
```markdown
> ⚠️  **SECURITY: Run queries MANUALLY in a trusted local terminal or the Supabase SQL Editor only.**  
> Do NOT execute via OpenClaw, Codex, or any agent session.  
> Credentials visible in this flow — agent sessions retain output in logs.  
> After running: immediately save any retrieved credentials to your password manager and clear your terminal history.
```

Both warnings are **prominent** — top-level, not buried in buried inline comments. The JS warning appears immediately after the `'use strict'` declaration and before any substantive code. The DELTA-PREFLIGHT.md warning is a blockquote in the third paragraph of the document, before any checklist items. Both explicitly name OpenClaw, Codex, and "any agent session."

---

### Fix 5 — can_access_order() is a hard blocker (DELTA-PREFLIGHT.md)

**Status: ✅ CONFIRMED**  
**File:** `DELTA-PREFLIGHT.md`  
**Lines:** 105–108

**Evidence:**
```markdown
**If the function does NOT exist:**
- **Status: ❌ BLOCKED** — do not proceed with authenticated smoke testing
- Missing server-side driver RLS enforcement blocks R1 release approval. Do not proceed with 
  authenticated smoke until this function is confirmed live or Jefe explicitly accepts the risk 
  in writing.
- Do NOT create this function during preflight — flag it as a blocker for Jefe immediately
```

The language is unambiguous: **"❌ BLOCKED"**, **"do not proceed"**, **"blocks R1 release approval."** There is no hedging, no "acceptable," no "can proceed anyway." The only exception path requires **Jefe's written sign-off** — not a unilateral judgment call by the operator. This satisfies the hard-blocker requirement.

---

### Fix 6 — need_box under My Drop-Offs (HQ-ORDER-CREATION.md)

**Status: ✅ CONFIRMED**  
**File:** `HQ-ORDER-CREATION.md`  
**Lines:** 71–72

**Evidence:**
```markdown
> will see this order in their **My Drop-Offs** tab (not My Pickups — `need_box` orders  
> appear under Drop-Offs because the driver must collect the box from the customer).
```

The file explicitly says `need_box` → **My Drop-Offs**, and actively calls out that it is **not My Pickups** with a parenthetical clarification. There is no remaining occurrence of "My Pickups" in relation to `need_box` anywhere in the file. The phrase "Ready for Pickup" and "My Pickups" appear only in context of SMOKE-002 (status: `Ready for Pickup`), which is a different order and unrelated to the `need_box` fix.

---

## Summary Table

| Fix | Description | Status | File | Line(s) |
|-----|-------------|--------|------|---------|
| 1 | role + app_role both written on every members insert | ✅ CONFIRMED | create-smoke-accounts.js | 99–100, 217–218 |
| 2 | Payment query uses `data->'payment'` JSONB path | ✅ CONFIRMED | DELTA-PREFLIGHT.md | 170–172, 186 |
| 3 | Rollback calls deleteUser inside catch before re-throw | ✅ CONFIRMED | create-smoke-accounts.js | 236–245 |
| 4 | Security warning in both files, prominent and explicit | ✅ CONFIRMED | Both | JS:36–41, MD:3–6 |
| 5 | can_access_order() missing = ❌ BLOCKED (hard language) | ✅ CONFIRMED | DELTA-PREFLIGHT.md | 105–108 |
| 6 | need_box → My Drop-Offs (not My Pickups) | ✅ CONFIRMED | HQ-ORDER-CREATION.md | 71–72 |

---

## Final Verdict

**✅ APPROVED FOR MANUAL EXECUTION**

All 6 of Jefe's blocking fixes are correctly implemented. Syntax check is clean. No regressions detected. No credentials found in any file. No stray `SELECT payment FROM orders` bare-column queries. No remaining "My Pickups" confusion for `need_box` orders.

**Pre-execution reminder:** Complete all 7 Delta preflight checks before running the script. The `can_access_order()` check (preflight step 3) is a hard blocker — if that function is absent from the live DB, stop and escalate to Jefe before proceeding.

---

*Signed: Delta — QA/Debugger, Casabe Konnect v3 Smoke Review*
