# FORGE REVISION NOTES — R1 Security Migration Redesign

**Author:** Forge (Dev Lead)  
**Migration File:** `~/casabe-v3/migrations/r1-security-revised.sql`  
**Status:** DRAFT — Pending Delta review + Jefe explicit go-ahead  
**DO NOT APPLY to Supabase without Delta review and Jefe sign-off**

---

## R7 Pass (2026-06-11) — Delta R6 Blockers Fixed

This pass addresses 2 blockers (1 P0, 1 P1) from the R6 review.
Nothing below has been applied to Supabase. Delta must re-review, then Jefe signs off.

### What Changed in R7

| Item | Priority | File(s) | What Changed |
|------|----------|---------|-------------|
| P0-R6-1: Reclaim-race loser returns `duplicate` before event confirmed processed | P0 | SQL + TS | `claim_stripe_event()`: removed hardcoded final `RETURN ... 'duplicate'` fallback. Added **Step 5** that re-reads the current row state and classifies accurately: `payment_status='processed'` → `'duplicate'`; `payment_status='processing'` → `'in_progress'`; NULL or other → `'unknown'` (fail closed). Updated function comment block to document the new `'unknown'` action and note that after P1-R6-2 schema reconciliation, NULL/unknown should not occur at runtime but function still fails closed defensively. Webhook `!initialClaim?.claimed` branch updated: split `claimAction` explicitly — `'in_progress'` → 409, `'duplicate'` → 200, `'unknown'` or unexpected → 500 (fail closed, never return 200 without confirmed `processed` state). |
| P1-R6-2: `stripe_events.payment_status` nullable contract not reconciled | P1 | SQL | Added schema reconciliation block before `processed_at` fix: (1) DO $$ preflight logs NULL + unknown-status counts; (2) UPDATE backfills NULL `payment_status` → `'processing'`; (3) UPDATE backfills unknown values → `'failed'`; (4) `ALTER COLUMN payment_status SET DEFAULT 'processing', SET NOT NULL`. Closes root-cause: legacy rows with NULL `payment_status` bypassed all three branches and fell through to the (now-removed) hardcoded `'duplicate'` return. After P1-R6-2, NULL/unknown states cannot exist at runtime; `claim_stripe_event()` Step 5 `ELSE` branch now only fires on extreme edge cases (defensively). Added post-commit **V7d** (confirms `is_nullable='NO'`, `column_default='''processing'''`) and **V7e** (confirms `null_count=0`, `unknown_count=0`). |

### Verification Output (R7 grep checks)

See deliverables at the end of the task report. All grep/syntax checks confirmed clean.

### Files Modified in R7

- `migrations/r1-security-revised.sql` — P0-R6-1 Step 5 re-read block + comment update; P1-R6-2 backfill + NOT NULL + DEFAULT block; V7d + V7e post-commit queries
- `supabase/functions/stripe-webhook/index.ts` — P0-R6-1 explicit 3-way action split (`'duplicate'` / `'in_progress'` / `'unknown'`/unexpected → 500) + header comment
- `smoke-setup/FORGE-REVISION-NOTES.md` — this R7 pass section

### Delta Review Checklist Additions (R7)

- [ ] **P0-R6-1 SQL**: `claim_stripe_event()` Step 5 block present after Step 4 `IF FOUND` block. Uses `SELECT payment_status INTO v_existing FROM public.stripe_events WHERE id = p_event_id`. Three branches: `'processed'` → `'duplicate'`; `'processing'` → `'in_progress'`; ELSE → `'unknown'`. No hardcoded `RETURN ... 'duplicate'` at end of function body.
- [ ] **P0-R6-1 SQL**: Comment block on `claim_stripe_event()` documents `'unknown'` action and notes that after P1-R6-2 reconciliation, NULL/unknown should not occur at runtime but function still fails closed defensively.
- [ ] **P0-R6-1 TS**: `!initialClaim?.claimed` branch uses `const claimAction = initialClaim?.action`. Three explicit branches: `claimAction === 'in_progress'` → 409; `claimAction === 'duplicate'` → 200; else (including `'unknown'`) → 500. No unguarded fallthrough to 200.
- [ ] **P1-R6-2 SQL**: Preflight DO $$ block logs NULL count and unknown-status count.
- [ ] **P1-R6-2 SQL**: `UPDATE ... SET payment_status = 'processing' WHERE payment_status IS NULL` present.
- [ ] **P1-R6-2 SQL**: `UPDATE ... SET payment_status = 'failed' WHERE payment_status NOT IN ('processing','processed','failed')` present.
- [ ] **P1-R6-2 SQL**: `ALTER TABLE public.stripe_events ALTER COLUMN payment_status SET DEFAULT 'processing', ALTER COLUMN payment_status SET NOT NULL` present and runs before COMMIT.
- [ ] **V7d** post-commit query present: confirms `payment_status` `is_nullable='NO'`, `column_default='''processing'''`.
- [ ] **V7e** post-commit query present: confirms `null_count=0`, `unknown_count=0`.

---

## R6 Pass (2026-06-11) — Delta R5 Blockers Fixed

This pass addresses all 5 P0/P1 blockers from Delta’s R5 review.
Nothing below has been applied to Supabase. Delta must re-review, then Jefe signs off.

### What Changed in R6

| Item | Priority | File(s) | What Changed |
|------|----------|---------|--------------|
| P0-R5-1: Active-processing duplicates return HTTP 200 | P0 | SQL + TS | `claim_stripe_event()`: active `processing` (non-stale) branch now returns `action: 'in_progress'` instead of `action: 'duplicate'`. Webhook `!initialClaim?.claimed` branch split: `action === 'in_progress'` → **HTTP 409** (retryable); `action === 'duplicate'` (confirmed processed) → HTTP 200. Prevents Stripe from silently dropping events when an owning in-flight request later fails. |
| P1-R5-2: Old 5-param `merge_stripe_payment_completed` overload survives | P1 | SQL | Added `DROP FUNCTION IF EXISTS public.merge_stripe_payment_completed(TEXT, TEXT, TEXT, TEXT, TEXT);` immediately after the 6-param GRANT block. Safe no-op on fresh installs. Also added post-commit V5b to confirm exactly 1 overload exists. |
| P1-R5-3: V4 post-commit verification throws on missing `get_user_tenant_id` | P1 | SQL | Replaced bare `has_function_privilege` SELECT with a `DO $$` block that first checks for function existence. Reports `NOTICE` if absent (optional revoke skipped), `WARNING` if callable, `NOTICE` if revoke confirmed. |
| P1-R5-4: `stripe_events.processed_at` NOT NULL + DEFAULT from prior migration | P1 | SQL | Added `DO $$` block that conditionally drops NOT NULL constraint and DEFAULT on `processed_at` if present (covers existing prod tables from `r6-stripe-idempotency.sql`). Backfill UPDATE sets `processed_at = NULL` for any `processing` or `failed` rows. Added post-commit V7c to confirm `is_nullable='YES'`, `column_default=NULL`. |
| P1-R5-5: UI badge shows amber for canonical `failed`, not red “Payment Failed” | P1 | index.html | Changed `ps === 'payment_failed'` to `ps === 'failed' \|\| ps === 'payment_failed'` on line 24912. Retains backward compatibility for legacy `payment_failed` data. |

### Verification Output (R6 grep checks, all passed)

```
Verify 1 (P1-R5-5 badge): line 24912 — 'failed' || 'payment_failed' branch present ✅
Verify 2 (P0-R5-1 SQL):   lines 483, 486, 538 — 'in_progress' action returned ✅
Verify 3 (P0-R5-1 TS):    lines 11, 107–117 — 409 branch for in_progress ✅
Verify 4 (P1-R5-2 DROP):  line 290 — DROP FUNCTION IF EXISTS 5-param present ✅
Verify 5 (P1-R5-3 DO):    line 899 — V4 DO $$ block present ✅
Verify 6 (P1-R5-4):       lines 380, 403, 416, 1032 — processed_at fix present ✅
```

### Files Modified in R6

- `migrations/r1-security-revised.sql` — P0-R5-1 SQL, P1-R5-2 DROP+V5b, P1-R5-3 V4 DO block, P1-R5-4 processed_at reconcile+V7c
- `supabase/functions/stripe-webhook/index.ts` — P0-R5-1 409 split branch + header comment
- `index.html` — P1-R5-5 badge line 24912
- `smoke-setup/FORGE-REVISION-NOTES.md` — this R6 pass section

### Delta Review Checklist Additions (R6)

- [ ] **P0-R5-1**: `claim_stripe_event()` returns `action: 'in_progress'` (not `'duplicate'`) when `payment_status='processing'` AND within stale window. Webhook returns HTTP 409 for `in_progress`, HTTP 200 only for `action='duplicate'` (confirmed processed).
- [ ] **P1-R5-2**: `DROP FUNCTION IF EXISTS public.merge_stripe_payment_completed(TEXT, TEXT, TEXT, TEXT, TEXT)` present after 6-param GRANT. V5b post-commit query present and confirms exactly 1 overload.
- [ ] **P1-R5-3**: V4 post-commit is a `DO $$` block with existence check, not a bare SELECT. `RAISE NOTICE` for absent function; `RAISE WARNING` for failed revoke; `RAISE NOTICE` for confirmed revoke.
- [ ] **P1-R5-4**: `DO $$` block conditionally drops NOT NULL + DEFAULT on `processed_at`. Backfill UPDATE sets `processed_at = NULL` for `processing`/`failed` rows. V7c present and checks `is_nullable='YES'`, `column_default=NULL`.
- [ ] **P1-R5-5**: `index.html` line 24912: `ps === 'failed' || ps === 'payment_failed'` — not just `'payment_failed'`.

---

## R5 Pass (2026-06-11) — Delta R4 Blockers Fixed

This pass addresses all 5 P0/P1 blockers from Delta's R4 review (verdict: NEEDS REVISION).
Nothing below has been applied to Supabase. Delta must re-review, then Jefe signs off.

### What Changed in R5

| Item | Priority | What Changed |
|------|----------|--------------|
| P0-R4-1: Webhook event-state writes fail silently | P0 | Added `finalize_stripe_event()` RPC (service-role only, transition-validated, returns rows_updated). Replaced all `failEvent()`, `succeedEvent()`, and every skip/default `.update()` call in webhook with calls to this RPC. Error AND rows_updated checked on every call. 0 rows → 500 (Stripe retries). No 200 returned without confirmed DB finalization. |
| P1-R4-2: claimed_at missing DEFAULT and NOT NULL | P1 | Added `ALTER TABLE public.stripe_events ALTER COLUMN claimed_at SET DEFAULT now(), ALTER COLUMN claimed_at SET NOT NULL;` immediately after the backfill UPDATE. Closes deploy window where old webhook code could INSERT NULL claimed_at (which is unclaimable). |
| P1-R4-3: ACL assertion incomplete | P1 | Expanded aclexplode loop from 3 to 5 functions (added `finalize_stripe_event` and `get_checkout_authorized_member`). Added separate conditional block for `get_user_tenant_id` (may not exist on all envs). All restricted functions now verified. |
| P1-R4-4: async_payment_failed wrote 'payment_failed' | P1 | Changed `p_payment_status: 'payment_failed'` to `p_payment_status: 'failed'` in `checkout.session.async_payment_failed` handler. `payment_intent.payment_failed` already used 'failed'. Now consistent across all failure branches. |
| P1-R4-5: Paid completion doesn't write amount_paid | P1 | `merge_stripe_payment_completed()` signature updated with `p_amount_paid NUMERIC` (6th param). Function rejects `p_amount_paid <= 0`. Sets `payment.paid = p_amount_paid / 100.0` atomically alongside `payment.status`. Webhook passes `session.amount_total` at both `checkout.session.completed` and `checkout.session.async_payment_succeeded` call sites. Validates amount > 0 before calling RPC. |

---

## P0-R4-1: Webhook Event-State Writes — Detailed Fix

### What Was Wrong in R4

`failEvent()`, `succeedEvent()`, and all skip/default branches called:
```typescript
await supabase.from('stripe_events').update({ payment_status: 'failed', raw_error: errMsg })
  .eq('id', event.id);
```

**No error check. No rowsAffected check.**

The dangerous path:
1. `failEvent()` fails silently → row stays `processing`
2. Stripe retries → `claim_stripe_event()` sees recent `processing` → returns `claimed: false`
3. Returns 200 (duplicate) → **failed order update is permanently lost**

Even the `succeedEvent()` path was unsafe: a failed `.update()` meant the row
stayed `processing`, eligible for stale reclaim, with no indication the event
was actually handled.

### The Fix

**New RPC: `finalize_stripe_event(p_event_id, p_new_status, p_allowed_from[], p_processed_at, p_raw_error)`**

```sql
CREATE OR REPLACE FUNCTION public.finalize_stripe_event(
  p_event_id     TEXT,
  p_new_status   TEXT,
  p_allowed_from TEXT[],
  p_processed_at TIMESTAMPTZ DEFAULT NULL,
  p_raw_error    TEXT        DEFAULT NULL
)
RETURNS INTEGER  -- rows_updated: 0 or 1
```

- Only transitions FROM allowed states (e.g. `ARRAY['processing']`)
- Returns 0 if the row was not in an allowed state (race, stale reclaim, or lost)
- Service-role only (REVOKE from PUBLIC/anon/authenticated)

**Webhook callers now:**
```typescript
const { data: rowsUpdated, error: finalizeErr } = await supabase.rpc('finalize_stripe_event', { ... });
if (finalizeErr || rowsUpdated === 0) {
  // return 500 — Stripe retries
}
```

**`skipEvent()` helper added** for "not a Casabe event" and "async will handle it" paths.
Previously these used bare `.update()` calls inline. Now they go through `skipEvent()`
which calls `finalize_stripe_event()` and returns 500 if finalization fails.

---

## P1-R4-2: claimed_at DEFAULT + NOT NULL — Detailed Fix

### What Was Wrong in R4

Migration did:
```sql
ALTER TABLE IF EXISTS public.stripe_events ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
UPDATE public.stripe_events SET claimed_at = COALESCE(claimed_at, now()) WHERE claimed_at IS NULL;
```

But NEVER added `DEFAULT now()` or `NOT NULL` constraint. This created a deploy window:
- Old webhook code (without R5 deployed yet) could INSERT a row with no `claimed_at` value → NULL
- A NULL `claimed_at` row is neither active nor stale under `claim_stripe_event()` predicates:
  - `payment_status = 'processing' AND claimed_at >= now() - 5min` → FALSE (claimed_at IS NULL)
  - `payment_status = 'processing' AND claimed_at < now() - 5min` → FALSE (claimed_at IS NULL)
  - Neither duplicate nor stale → falls through to attempt reclaim
  - Reclaim UPDATE also checks claimed_at → NULL → no match → returns `duplicate`
  - Row is unclaimable: stuck in `processing` forever → silent loss

### The Fix

```sql
ALTER TABLE public.stripe_events
  ALTER COLUMN claimed_at SET DEFAULT now(),
  ALTER COLUMN claimed_at SET NOT NULL;
```

Added immediately after the backfill UPDATE (which eliminates all existing NULLs).
Both `SET DEFAULT` and `SET NOT NULL` are safe to re-apply on a column that already
has these attributes (PostgreSQL silently accepts redundant constraint statements).

**Deploy coordination note:** Migration must be applied before old webhook code
can insert rows. After migration, even old webhook code cannot produce NULL claimed_at
because the DEFAULT catches it at INSERT time.

---

## P1-R4-3: ACL Assertion Expanded — Detailed Fix

### What Was Wrong in R4

The aclexplode DO $$ block only iterated over 3 functions:
- `merge_stripe_payment_completed(text,text,text,text,text)`
- `merge_stripe_payment_status(text,text,text)`
- `claim_stripe_event(text,text,text,text)`

**Missing from assertion:**
- `get_checkout_authorized_member(text)` — added in R4, had REVOKE, but not in assert
- `get_user_tenant_id()` — has REVOKE, was not verified
- `finalize_stripe_event(...)` — new in R5, needs verification

### The Fix

Loop now iterates 5 functions unconditionally:
1. `merge_stripe_payment_completed(text,text,text,text,text,numeric)` (updated signature)
2. `merge_stripe_payment_status(text,text,text)`
3. `claim_stripe_event(text,text,text,text)`
4. `finalize_stripe_event(text,text,text[],timestamptz,text)`
5. `get_checkout_authorized_member(text)`

Plus a **separate conditional block** for `get_user_tenant_id()` (may not exist on all
environments — the revoke block is also conditional, so the assertion must be too).

**V6b post-commit query** updated to include all 6 function names.

**Note on signature change:** `merge_stripe_payment_completed` now takes 6 params.
The ACL assertion uses `ILIKE v_fn || '%'` to match, which handles the numeric suffix
correctly. Post-commit V5 query updated to use the 6-param explicit signature.

---

## P1-R4-4: async_payment_failed Status — Detailed Fix

### What Was Wrong in R4

```typescript
// checkout.session.async_payment_failed
const { error: updateErr } = await supabase.rpc('merge_stripe_payment_status', {
  p_payment_status: 'payment_failed',  // ← WRONG: undefined status value
});
```

```typescript
// payment_intent.payment_failed
const { error: failUpdateErr } = await supabase.rpc('merge_stripe_payment_status', {
  p_payment_status: 'failed',  // ← correct
});
```

Two equivalent payment failure events produced different stored states.
`payment_failed` is not defined in the schema/UI. Broken reporting and status displays.

### The Fix

```typescript
// checkout.session.async_payment_failed (R5)
const { error: updateErr } = await supabase.rpc('merge_stripe_payment_status', {
  p_payment_status: 'failed',  // ← now canonical
});
```

All failure branches now use `'failed'`:
- `checkout.session.async_payment_failed` → `'failed'` ✅
- `payment_intent.payment_failed` → `'failed'` ✅ (was already correct, preserved)

No SQL schema change needed — `merge_stripe_payment_status` writes whatever string
is passed; the fix is entirely in the webhook caller.

---

## P1-R4-5: Amount Paid in Completion — Detailed Fix

### What Was Wrong in R4

`merge_stripe_payment_completed()` set `payment.status = 'paid'` but did not touch
`payment.paid`. A newly completed order could be stored as `status=paid, paid=0`
(or `paid=undefined`) — broken balances and reporting.

### The Fix

**Migration:**
```sql
CREATE OR REPLACE FUNCTION public.merge_stripe_payment_completed(
  p_order_id        TEXT,
  p_tenant_id       TEXT,
  p_session_id      TEXT,
  p_payment_status  TEXT,
  p_payment_method  TEXT,
  p_amount_paid     NUMERIC  -- Stripe cents; converted to dollars
)
...
  IF p_amount_paid <= 0 THEN
    RAISE EXCEPTION 'p_amount_paid must be > 0, got % for order %', ...;
  END IF;

  UPDATE public.orders SET data = data || jsonb_build_object(
    'payment', COALESCE(data->'payment', '{}'::jsonb) || jsonb_build_object(
      'status', p_payment_status,
      'method', p_payment_method,
      'stripe_session_id', p_session_id,
      'paid', (p_amount_paid / 100.0)  -- cents → dollars
    )
  ) WHERE ...;
```

**Webhook callers:**
```typescript
// Before calling RPC, validate amount
const amountTotal = session.amount_total;
if (!amountTotal || amountTotal <= 0) {
  return await failEvent(`invalid amount_total=${amountTotal}`);
}

// Pass to RPC
await supabase.rpc('merge_stripe_payment_completed', {
  ...
  p_amount_paid: amountTotal,  // session.amount_total in cents
});
```

Both `checkout.session.completed` and `checkout.session.async_payment_succeeded`
callers updated. Amount validated at webhook layer AND at RPC layer (belt-and-suspenders).

**Test assertion:** After completion, `data->'payment'->>'paid'` must be > 0 and
match `session.amount_total / 100.0` (e.g. amount_total=5000 → paid=50.00).

---

## R4 Pass (2026-06-10) — Delta STOP-SHIP Blockers Fixed (archived)

This section is preserved for continuity. All R4 items remain intact in R5.

### What Changed in R4

| Item | Priority | What Changed |
|------|----------|--------------|
| claim_stripe_event() race condition | P0-M1 | Full rewrite using `INSERT … RETURNING id INTO v_inserted_id`. Only caller whose INSERT created the row gets non-NULL v_inserted_id → owns claim. All others get NULL → immediately return claimed=false/duplicate. Timestamp-window ownership inference completely removed. |
| stripe_events missing claimed_at in production | P0-M2 | Added `ALTER TABLE IF EXISTS public.stripe_events ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;` unconditionally before function creation. Backfill UPDATE for existing NULL values. |
| stripe-webhook/index.ts old pattern | P0-M3 | Full file rewrite. Atomic claim via RPC (RETURNING-based). payment_status='paid' gate (P1-M4). Non-2xx on order update failures. Proper Checkout Session/PaymentIntent correlation for refunds/failures. async_payment_succeeded and async_payment_failed stubs implemented. |
| stripe-checkout/index.ts old pattern | P0-M3 | Full file rewrite. Server-side role enforcement via get_checkout_authorized_member() RPC (hq/admin/owner/office only → 403 for others). Currency hardcoded 'usd'. payment_intent_data.metadata populated with order_id+tenant_id at session creation. |
| payment_status gate in webhook | P1-M4 | checkout.session.completed handler returns 200 with skipped='not_paid' if payment_status !== 'paid'. async_payment_succeeded handles actual paid state for async methods. |
| PUBLIC ACL verification | P1-M5 | Added DO $$ block using aclexplode(COALESCE(proacl, acldefault('f', proowner))) after all GRANT/REVOKE statements. grantee=0 is PostgreSQL PUBLIC. RAISES EXCEPTION if PUBLIC EXECUTE remains on any restricted function. Also added V6b verification query in post-commit section. |
| DRIVER-SELECTOR-ACCEPTANCE-TEST.md | Doc fix | Removed "Driver B may see Driver A orders" language. Updated debug URL to https://casabe-connect.netlify.app/?debug=1. Made explicit: any Driver B visibility of Driver A tenant rows is a HARD FAIL. |

---

## What Remains Unchanged From R4

| Change | Status |
|--------|--------|
| N2: Drop `orders_driver_update` policy + `restrict_driver_order_update` trigger | ✅ Preserved |
| N1: Backfill `assignedDriverUserId` from `members.display_name` | ✅ Preserved |
| H3 (partial): `merge_stripe_payment_completed` + `merge_stripe_payment_status` RPCs | ✅ Preserved (signature extended) |
| M2: `SET search_path = ''` on four financial functions | ✅ Preserved |
| `get_user_tenant_id()` revoke (gated on Audit A) | ✅ Preserved |
| All dropped revokes (is_hq, is_admin, current_tenant_id, get_user_office_ids) | ✅ Still dropped — RLS dependencies unchanged |
| `update_driver_status` RPC-only driver write path | ✅ Preserved |
| No `orders_driver_update` recreation | ✅ Correct — still absent |
| RETURNING-based `claim_stripe_event()` | ✅ Preserved (R4 P0-M1 fix intact) |
| `get_checkout_authorized_member()` RPC | ✅ Preserved (now also in ACL assertion) |

---

## What Was Confirmed Good (per Delta R3 → R4 review)

- Removing unsafe revokes for `current_tenant_id()`, `is_hq()`, `is_admin()`, `get_user_office_ids()`
- `get_user_tenant_id()` revoke kept (gated on Audit A by Delta)
- Merge RPCs: REVOKE from PUBLIC/anon/authenticated, GRANT to service_role only
- No `orders_driver_update` recreation
- `update_driver_status` RPC-only driver write path preserved
- UUID-less driver display filter and save guard

---

## Delta Review Checklist (What Delta Should Verify in R5)

### Migration (r1-security-revised.sql)

#### R5 Items (New)

- [ ] **P0-R4-1**: `finalize_stripe_event(TEXT, TEXT, TEXT[], TIMESTAMPTZ, TEXT)` RPC present.
  - Returns `INTEGER` (rows_updated: 0 or 1)
  - `UPDATE ... WHERE id = p_event_id AND payment_status = ANY(p_allowed_from)`
  - `GET DIAGNOSTICS v_rows_updated = ROW_COUNT`
  - REVOKE from PUBLIC/anon/authenticated, GRANT to service_role
- [ ] **P1-R4-2**: After ADD COLUMN + backfill: `ALTER TABLE public.stripe_events ALTER COLUMN claimed_at SET DEFAULT now(), ALTER COLUMN claimed_at SET NOT NULL;` is present and runs before COMMIT.
- [ ] **P1-R4-3**: ACL assertion DO $$ loop covers: `merge_stripe_payment_completed(text,text,text,text,text,numeric)`, `merge_stripe_payment_status`, `claim_stripe_event`, `finalize_stripe_event`, `get_checkout_authorized_member`. Separate conditional block for `get_user_tenant_id`.
- [ ] **P1-R4-5**: `merge_stripe_payment_completed` signature has `p_amount_paid NUMERIC` as 6th parameter. Body: `IF p_amount_paid <= 0 THEN RAISE EXCEPTION`. Body: `'paid', (p_amount_paid / 100.0)` in jsonb_build_object. Old 5-parameter signature no longer present (CREATE OR REPLACE replaces it).
- [ ] V6 and V6b post-commit queries include `finalize_stripe_event` and `get_checkout_authorized_member`.
- [ ] V7b post-commit query checks `is_nullable = 'NO'` and `column_default` for claimed_at.
- [ ] New V10 (finalize_stripe_event transition test) and V11 (zero amount rejection test) present.

#### R4 Items (Preserved — verify not regressed)

- [ ] **P0-M1**: `claim_stripe_event()` uses `INSERT … RETURNING id INTO v_inserted_id`. Primary ownership check is `v_inserted_id IS NOT NULL`. No timestamp-window ownership inference on the primary claim path.
- [ ] **P0-M2**: `ALTER TABLE IF EXISTS public.stripe_events ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;` present before `claim_stripe_event()`.
- [ ] **P1-M5**: `DO $$` aclexplode block uses `COALESCE(proacl, acldefault('f', proowner))`. Checks `grantee = 0`. Raises EXCEPTION on violation.
- [ ] All R3 confirmed-good items still present and unmodified.

### stripe-webhook/index.ts

#### R5 Items (New)

- [ ] **P0-R4-1**: `failEvent()` calls `supabase.rpc('finalize_stripe_event', { p_new_status: 'failed', p_allowed_from: ['processing'], p_raw_error: errMsg })`. Checks `finalizeErr` and logs but still returns 500 (Stripe will retry; stale reclaim handles it).
- [ ] **P0-R4-1**: `succeedEvent()` calls `supabase.rpc('finalize_stripe_event', { p_new_status: 'processed', p_allowed_from: ['processing'] })`. Checks `finalizeErr` → return 500. Checks `rowsUpdated === 0` → return 500. Only returns 200 when `rowsUpdated >= 1` and no error.
- [ ] **P0-R4-1**: `skipEvent(reason)` helper exists. Called for all "not a Casabe event" and "async will handle it" paths. Calls `finalize_stripe_event` with `p_new_status: 'processed'`. Returns 500 if finalization fails.
- [ ] **P0-R4-1**: No inline bare `.from('stripe_events').update(...)` calls remain anywhere in the file (all replaced by `failEvent`, `succeedEvent`, or `skipEvent`).
- [ ] **P1-R4-4**: `checkout.session.async_payment_failed` handler uses `p_payment_status: 'failed'` (not `'payment_failed'`). Search the file for `'payment_failed'` — must be 0 occurrences.
- [ ] **P1-R4-5**: `checkout.session.completed` validates `session.amount_total > 0` before calling RPC. Passes `p_amount_paid: amountTotal` to `merge_stripe_payment_completed`.
- [ ] **P1-R4-5**: `checkout.session.async_payment_succeeded` validates `session.amount_total > 0`. Passes `p_amount_paid: asyncAmountTotal` to `merge_stripe_payment_completed`.
- [ ] **P1-R4-5**: Both `merge_stripe_payment_completed` call sites have 6 parameters (including `p_amount_paid`).
- [ ] Default branch uses `skipEvent('unhandled_event_type')` — not bare `.update()`.

#### R4 Items (Preserved — verify not regressed)

- [ ] **P0-M1/P0-M3**: `claim_stripe_event()` RPC called at top, before event type switch. `claimed=false` returns 200 immediately.
- [ ] **P1-M4**: `checkout.session.completed` checks `session.payment_status !== 'paid'`.
- [ ] **P1-M4**: `checkout.session.async_payment_succeeded` handler implemented (not a stub).
- [ ] **P1-M4**: `checkout.session.async_payment_failed` handler implemented (not a stub).
- [ ] All non-2xx paths use `failEvent()`.
- [ ] Refund/failure: tries `intent.metadata` first, then Checkout Session lookup fallback.
- [ ] No `charge.metadata` used for order_id/tenant_id resolution anywhere.

### stripe-checkout/index.ts (unchanged in R5 — verify no regression)

- [ ] **P0-M3**: `get_checkout_authorized_member({ p_user_id: userId })` called via service_role client. 0 rows → 403.
- [ ] **P1-1**: `currency = 'usd'` hardcoded.
- [ ] `payment_intent_data.metadata` set with `order_id`, `tenant_id`, `invoice_id`.

---

## Open Questions Still Requiring Resolution Before Apply

### OQ-1: `get_user_tenant_id()` direct client callers (Audit A — REQUIRED)

```bash
grep -r "get_user_tenant_id" ~/casabe-v3/src ~/casabe-v3/supabase/functions ~/casabe-v3/index.html
# Expected: 0 results
```

### OQ-2: stripe_events schema compatibility (RESOLVED by P0-M2 + P1-R4-2 fixes)

The `ALTER TABLE … ADD COLUMN IF NOT EXISTS` + backfill + `SET DEFAULT / SET NOT NULL`
unconditionally handles all cases. Delta should run V7b to confirm post-apply.

### OQ-3: claim_stripe_event() stale window assumptions

5-minute stale reclaim window. Delta should confirm this is appropriate for the
Stripe retry interval in production. Risk level: LOW.

### OQ-4: get_checkout_authorized_member() app_role vs role column

Uses `COALESCE(m.app_role, m.role)`. Confirm live schema has both columns and
that `office` as a role value exists in live data for smoke test accounts.

### OQ-5: async_payment_succeeded/failed — event subscription

Confirm `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`
are subscribed in the Stripe Dashboard webhook endpoint.

### OQ-6: `check_stripe_payment_write()` trigger — still present?

```sql
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgname = 'trg_check_stripe_payment_write'
  AND tgrelid = 'public.orders'::regclass;
-- Expected: 1 row, tgenabled = 'O'
```

### OQ-7: `get_user_office_ids()` future hardening path

No change. Still out of scope per Jefe's instructions.

### OQ-8: payment_intent_data.metadata — backward compatibility (from R4)

Sessions created BEFORE stripe-checkout R4 deployed will NOT have `PaymentIntent.metadata`.
Webhook's refund/failure path falls back to Checkout Session lookup. Correct.
Delta should confirm fallback path is exercised in tests for pre-R4 session scenarios.

### OQ-9 (NEW): finalize_stripe_event p_allowed_from — reclaim path

`finalize_stripe_event` always passes `p_allowed_from: ['processing']`. This is
correct for the normal path. However, `claim_stripe_event` can reclaim a `failed`
row and reset it to `processing`. If a reclaimed event then calls `failEvent()`
again, it will be in `processing` → `failEvent` calls `finalize_stripe_event`
with `p_allowed_from: ['processing']` → lands correctly (row is in `processing`
after reclaim). Delta should confirm this chain is understood.

### OQ-10 (NEW): merge_stripe_payment_completed — old 5-param callers

The function signature changed from 5 to 6 parameters. Any caller that was not
in the webhook (e.g. any scripts, cron jobs, or other Edge Functions) would break
if they call the old 5-param signature. Delta should grep for all callers of
`merge_stripe_payment_completed` outside of stripe-webhook.

### OQ-11 (NEW): amount_total NULL on older Stripe API versions

`session.amount_total` can be `null` for certain session modes (e.g. `setup` mode)
or in some older API response shapes. The webhook validates `!amountTotal || amountTotal <= 0`
before calling the RPC — this will route to `failEvent()` for null amounts.
Delta should confirm that `setup` mode sessions are not processed through
`checkout.session.completed` (they should not be, as `setup` mode sessions
don't have payment completion events of this type).

---

## Undisclosed Changes Policy

Per standing instructions: any additional issues found during implementation are
documented here, NOT silently fixed.

### Additional issues found in R5 implementation (documented, not silently fixed):

**R5-NOTE-1**: The `failEvent()` helper in R5 logs the finalize_stripe_event failure
but still returns 500 (rather than returning a different error). This is intentional:
even if we can't record the failure state in DB, we still return 500 to trigger Stripe
retry. After 5 minutes the row goes stale and is reclaimed. The consequence is that
`raw_error` may not be populated in the DB for the first failed attempt. Subsequent
retries will populate it. Delta should confirm this is acceptable.

**R5-NOTE-2**: `skipEvent()` returns 500 if `finalize_stripe_event` fails or returns 0 rows.
For "not a Casabe event" skips, this means Stripe will retry an event that we previously
decided to skip. On retry, `claim_stripe_event()` will see the row in `processing` state
(still within 5 min) → return `claimed=false` → 200 immediately. The retry is effectively
a no-op unless the stale reclaim fires. This is correct behavior — better to retry safely
than to silently leave rows in `processing`. Delta should confirm.

**R5-NOTE-3**: `merge_stripe_payment_completed` REVOKE/GRANT statements now use the
6-parameter signature. If the old 5-parameter version was ever applied to the database
(in a prior migration attempt), the old overload would still exist with its original ACL.
The new overload gets fresh ACL via this migration. Delta should verify there is no
lingering 5-param overload: `SELECT proname, proargtypes FROM pg_proc WHERE proname =
'merge_stripe_payment_completed' AND pronamespace = 'public'::regnamespace;` — should
return exactly 1 row (the 6-param version).

**WEBHOOK-NOTE-1** (from R4, preserved): The `default` case now uses `skipEvent()` instead
of bare `.update()`. Confirmed intentional and required by P0-R4-1.

**WEBHOOK-NOTE-2** (from R4, preserved): Initial `claim_stripe_event()` passes `p_order_id: null`
and `p_tenant_id: null`. Acceptable — webhook always re-derives these from event payload.

**CHECKOUT-NOTE-1** (from R4, preserved): `authMemberRows` indexing may need verification
against actual Supabase JS client version.

---

## Why Each R3 Revoke Was Removed (unchanged from R3/R4, preserved for continuity)

### ❌ `is_hq()` — REVOKE DROPPED
18 active RLS policies across 8 tables depend on it.

### ❌ `is_admin()` — REVOKE DROPPED
2 active RLS policies on members table.

### ❌ `current_tenant_id()` — REVOKE DROPPED
40 active RLS policies across 13 tables. Foundational tenant isolation primitive.

### ❌ `get_user_office_ids()` — REVOKE DROPPED
Per Jefe's explicit instruction.

### ✅ `get_user_tenant_id()` — REVOKE KEPT
0 live RLS policy dependencies (Delta audit). Safe pending Audit A.

---

## Apply Sequence (For Jefe — Post-Delta Approval)

1. **Run Audit A** (SQL Editor + grep) → confirm `get_user_tenant_id` has 0 callers
2. **Audit OQ-10** → confirm no other callers of old 5-param `merge_stripe_payment_completed`
3. **Apply** `~/casabe-v3/migrations/r1-security-revised.sql` in SQL Editor
4. **Run all V1–V11 verification queries** + V6b (PUBLIC ACL) from bottom of migration
5. **Deploy stripe-webhook Edge Function** (R5 version)
6. **Deploy stripe-checkout Edge Function** (R4 version — unchanged in R5)
7. **Add async events** to Stripe webhook subscription in Dashboard:
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
8. **Run smoke tests** (Acceptance Tests 1–8 in stripe-webhook comments)
9. **Delta re-reviews** post-apply verification output before final sign-off
10. **Jefe go-ahead** for production

---

*Forge — Dev Lead sign-off R5 pass, 2026-06-11*  
*Delta reviews next — this is a STOP-SHIP gate. Do not skip.*
