# FORGE-STRIPE-R1-REVISED.md
## Stripe/Security R1 — Five Codex Findings: Resolution Report

**Author:** Forge (Dev Lead)
**Date:** 2026-06-14
**Status:** COMPLETE — All five Codex findings addressed. Awaiting Delta review and Jefe sign-off.
**Do NOT apply or deploy without Delta review + explicit Jefe approval.**

---

## Summary

This document covers the five blocking Codex findings from the handoff
(`MASTER-HANDOFF-2026-06-11.md` §9, "Remaining Blocking Findings") against the
current exact source in:

- `migrations/r1-security-revised.sql` (R7 state)
- `supabase/functions/stripe-checkout/index.ts` (R4 state, confirmed current)
- `supabase/functions/stripe-webhook/index.ts` (R5/R6/R7 state, confirmed current)

Each finding is stated exactly as it appeared in the Codex report, followed by
the source-verified fix, the code evidence, and why the fix is correct.

---

## Finding 1 of 5 — P0: Webhook Finalization and Failure Updates Can Fail Silently

### What Codex Found

> The webhook's `failEvent()`, `succeedEvent()`, skip branches, and default
> branches await updates to `stripe_events`, but they do not reliably inspect:
> - Supabase returned errors
> - Whether a row was actually affected
> - Whether the final event state was persisted
>
> The dangerous failure sequence: event processing fails → webhook tries to mark
> event failed → that DB update silently fails → row remains recent `processing`
> → Stripe retries → claim logic treats it as in-progress → webhook may return
> `200` → payment update permanently lost.

### What Was Changed

**SQL (`r1-security-revised.sql`, Change 3d):**

A new SECURITY DEFINER RPC `finalize_stripe_event()` was created. It accepts:
- `p_event_id TEXT`
- `p_new_status TEXT` (either `'processed'` or `'failed'`)
- `p_allowed_from TEXT[]` — enforced allowed current states (only transitions
  from `ARRAY['processing']` are permitted)
- `p_processed_at TIMESTAMPTZ DEFAULT NULL`
- `p_raw_error TEXT DEFAULT NULL`

It returns `INTEGER` (rows_updated: 0 or 1). The caller **must** return 500 if
rows_updated = 0. The function is SECURITY DEFINER, restricted to service_role.

```sql
CREATE OR REPLACE FUNCTION public.finalize_stripe_event(
  p_event_id     TEXT,
  p_new_status   TEXT,
  p_allowed_from TEXT[],
  p_processed_at TIMESTAMPTZ DEFAULT NULL,
  p_raw_error    TEXT        DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows_updated INTEGER;
BEGIN
  UPDATE public.stripe_events
  SET
    payment_status = p_new_status,
    processed_at   = CASE
                       WHEN p_new_status = 'processed'
                       THEN COALESCE(p_processed_at, now())
                       ELSE processed_at
                     END,
    raw_error      = CASE
                       WHEN p_new_status = 'failed' THEN p_raw_error
                       ELSE raw_error
                     END
  WHERE id             = p_event_id
    AND payment_status = ANY(p_allowed_from);

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RETURN v_rows_updated;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.finalize_stripe_event(TEXT, TEXT, TEXT[], TIMESTAMPTZ, TEXT)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public.finalize_stripe_event(TEXT, TEXT, TEXT[], TIMESTAMPTZ, TEXT)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION
  public.finalize_stripe_event(TEXT, TEXT, TEXT[], TIMESTAMPTZ, TEXT)
  TO service_role;
```

**Edge Function (`stripe-webhook/index.ts`):**

All three state-write paths (`failEvent`, `succeedEvent`, `skipEvent`) now call
`finalize_stripe_event()` via RPC and explicitly check both the returned error
AND the `rows_updated` count:

```typescript
async function failEvent(errMsg: string): Promise<Response> {
  console.error('[stripe-webhook] processing failed:', errMsg);
  const { data: rowsUpdated, error: finalizeErr } =
    await supabase.rpc('finalize_stripe_event', {
      p_event_id:     event.id,
      p_new_status:   'failed',
      p_allowed_from: ['processing'],
      p_processed_at: null,
      p_raw_error:    errMsg,
    });
  if (finalizeErr || rowsUpdated === 0) {
    console.error(
      '[stripe-webhook] failEvent: finalize_stripe_event did not land:',
      finalizeErr?.message ?? `rows_updated=${rowsUpdated}`
    );
  }
  return new Response(
    JSON.stringify({ error: 'processing_failed', detail: errMsg }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
  );
}

async function succeedEvent(): Promise<Response> {
  const { data: rowsUpdated, error: finalizeErr } =
    await supabase.rpc('finalize_stripe_event', {
      p_event_id:     event.id,
      p_new_status:   'processed',
      p_allowed_from: ['processing'],
      p_processed_at: new Date().toISOString(),
      p_raw_error:    null,
    });
  if (finalizeErr) { /* → 500 */ }
  if (rowsUpdated === 0) { /* → 500, do NOT claim success */ }
  return new Response(
    JSON.stringify({ received: true }),
    { status: 200 }
  );
}
```

`skipEvent()` uses the same pattern. **No branch can return 200 without a
confirmed DB finalization.**

### Why This Fix Is Correct

The old bare `.update()` calls had no error check and no affected-row count
check. The new RPC uses `GET DIAGNOSTICS v_rows_updated = ROW_COUNT` and
returns it to the caller. A 0 means the transition did not land (row was in a
state not in `p_allowed_from`). The caller returns 500 in that case, ensuring
Stripe will retry. After the 5-minute stale window, `claim_stripe_event()` will
reclaim the row and the event can be reprocessed.

---

## Finding 2 of 5 — P1: Existing `claimed_at` Upgrade Is Incomplete

### What Codex Found

> The migration adds and backfills `claimed_at`, but existing production tables
> also need the column contract enforced. Missing:
> ```sql
> ALTER TABLE public.stripe_events
>   ALTER COLUMN claimed_at SET DEFAULT now(),
>   ALTER COLUMN claimed_at SET NOT NULL;
> ```
> This leaves a deploy window where old webhook code can insert a row with NULL
> `claimed_at`; such a row is neither active nor stale under claim predicates
> and cannot be reclaimed — silent loss.

### What Was Changed

**SQL (`r1-security-revised.sql`, Change 3b — `stripe_events` table section):**

The migration now explicitly handles both the fresh-install case and the
existing-table upgrade case:

```sql
-- Step 1: Create table if not exists
CREATE TABLE IF NOT EXISTS public.stripe_events (
  ...
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ...
);

-- Step 2: Add column if it was missing from a prior install
ALTER TABLE IF EXISTS public.stripe_events
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- Step 3: Backfill any NULLs from the old schema
UPDATE public.stripe_events
SET claimed_at = COALESCE(claimed_at, now())
WHERE claimed_at IS NULL;

-- Step 4: Enforce DEFAULT now() and NOT NULL (P1-R4-2 fix)
ALTER TABLE public.stripe_events
  ALTER COLUMN claimed_at SET DEFAULT now(),
  ALTER COLUMN claimed_at SET NOT NULL;
```

The two `ALTER COLUMN` clauses at Step 4 are idempotent — PostgreSQL silently
accepts redundant constraint additions on a column that already has them.

### Why This Fix Is Correct

`CREATE TABLE IF NOT EXISTS` is a no-op on existing tables; it does not add
missing columns or alter existing column constraints. The explicit `ADD COLUMN
IF NOT EXISTS` + backfill + `ALTER COLUMN SET DEFAULT` + `ALTER COLUMN SET NOT
NULL` pattern guarantees the column contract is enforced regardless of whether
the table existed before this migration ran. After Step 3 there are no NULLs,
so Step 4's `SET NOT NULL` is safe.

---

## Finding 3 of 5 — P1: PUBLIC ACL Fail-Loud Assertion Is Incomplete

### What Codex Found

> The migration's ACL assertion checks some restricted RPCs but omits:
> - `get_checkout_authorized_member()`
> - Retained `get_user_tenant_id()` when it exists
>
> The post-commit check must fail loudly if any forbidden PUBLIC EXECUTE
> survives. Handle function existence safely so a nonexistent
> `get_user_tenant_id()` does not make verification fail for the wrong reason.

### What Was Changed

**SQL (`r1-security-revised.sql`, "P1-M5 + P1-R4-3: PUBLIC ACL verification" block):**

The transactional ACL assertion DO block now covers all six restricted
functions. For the five unconditional functions it iterates a VALUES list:

```sql
DO $$
DECLARE
  v_fn TEXT; v_has_public BOOLEAN; v_proc_oid OID; v_owner_oid OID;
BEGIN
  FOR v_fn IN VALUES
    ('merge_stripe_payment_completed(text,text,text,text,text,numeric)'),
    ('merge_stripe_payment_status(text,text,text)'),
    ('claim_stripe_event(text,text,text,text)'),
    ('finalize_stripe_event(text,text,text[],timestamp with time zone,text)'),
    ('get_checkout_authorized_member(text)')   -- ← was missing in R4
  LOOP
    SELECT p.oid, p.proowner INTO v_proc_oid, v_owner_oid
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.oid::regprocedure::text ILIKE v_fn || '%'
    LIMIT 1;

    IF v_proc_oid IS NULL THEN
      RAISE EXCEPTION 'ACL check: function not found: %', v_fn;
    END IF;

    -- Check grantee = 0 (PUBLIC pseudo-role) in effective ACL
    SELECT EXISTS (
      SELECT 1 FROM aclexplode(
        COALESCE(
          (SELECT proacl FROM pg_proc WHERE oid = v_proc_oid),
          acldefault('f', v_owner_oid)   -- NULL proacl means default PUBLIC EXECUTE!
        )
      )
      WHERE grantee = 0 AND privilege_type = 'EXECUTE'
    ) INTO v_has_public;

    IF v_has_public THEN
      RAISE EXCEPTION
        'SECURITY VIOLATION: PUBLIC EXECUTE still present on function: %. '
        'REVOKE did not land correctly. DO NOT APPLY this migration.', v_fn;
    END IF;
  END LOOP;

  -- get_user_tenant_id: conditional — only assert when function exists.
  SELECT p.oid, p.proowner INTO v_proc_oid, v_owner_oid
  FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'get_user_tenant_id'
  LIMIT 1;

  IF v_proc_oid IS NOT NULL THEN
    -- ... same aclexplode check, raises EXCEPTION if PUBLIC EXECUTE present
    IF v_has_public THEN
      RAISE EXCEPTION
        'SECURITY VIOLATION: PUBLIC EXECUTE still present on function: get_user_tenant_id()...';
    END IF;
  END IF;
  -- If function does not exist: conditional block is skipped silently.
END $$;
```

The post-commit V4 verification query uses `has_function_privilege()` but
is also wrapped in a conditional existence check (matching the conditional
revoke) so it cannot error if `get_user_tenant_id()` is absent:

```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'get_user_tenant_id'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    IF has_function_privilege('anon', 'public.get_user_tenant_id()', 'EXECUTE') OR
       has_function_privilege('authenticated', 'public.get_user_tenant_id()', 'EXECUTE') THEN
      RAISE WARNING '...revoke did not land';
    ELSE
      RAISE NOTICE '...revoke confirmed';
    END IF;
  ELSE
    RAISE NOTICE 'get_user_tenant_id() does not exist — optional revoke skipped';
  END IF;
END $$;
```

Additionally, the post-commit V6b query uses `aclexplode(COALESCE(proacl,
acldefault('f', proowner)))` — the same approach as the in-transaction check —
rather than interpreting a raw `proacl IS NULL` as "no PUBLIC EXECUTE" (which
would be wrong; NULL proacl means default grant, which includes PUBLIC EXECUTE).

### Why This Fix Is Correct

**`get_checkout_authorized_member()`** was created in the same migration but
was absent from the original ACL assertion. Adding it to the loop means the
migration cannot commit if the REVOKE failed to land for any reason.

**`get_user_tenant_id()`** may or may not exist on a given environment. The
conditional check means the migration does not error on environments where
the function was already dropped, while still asserting the revoke on
environments where it exists.

**`acldefault('f', proowner)` for NULL proacl:** PostgreSQL represents the
default ACL (which includes PUBLIC EXECUTE) as NULL in `pg_proc.proacl`. An
assertion that just checks `proacl IS NULL` or inspects the raw text would
incorrectly pass — `COALESCE(proacl, acldefault(...))` is required to surface
the implicit PUBLIC EXECUTE grant.

---

## Finding 4 of 5 — P1: Async Failure Uses a Different Payment Status

### What Codex Found

> One path writes `payment_failed`; another writes `failed`.
> The platform does not define `payment_failed` as a normal payment status.
> Use the canonical existing status `failed` unless a new status is
> intentionally introduced, documented, rendered everywhere, and tested.

### What Was Changed

**Edge Function (`stripe-webhook/index.ts`):**

The `checkout.session.async_payment_failed` branch was writing
`'payment_failed'` while `payment_intent.payment_failed` was already writing
`'failed'`. Both branches now write canonical `'failed'`:

```typescript
// checkout.session.async_payment_failed handler
case 'checkout.session.async_payment_failed': {
  // ...
  // P1-R4-4: canonical 'failed' (was incorrectly 'payment_failed' in R4).
  const { error: updateErr } = await supabase.rpc('merge_stripe_payment_status', {
    p_order_id:       orderId,
    p_tenant_id:      metaTenantId,
    p_payment_status: 'failed',   // ← was 'payment_failed'
  });
  // ...
}
```

**`index.html` (UI):**

The badge renderer was already special-casing `ps === 'payment_failed'` for
the red Payment Failed badge. The UI now also renders canonical `'failed'` as
the red Payment Failed badge, while retaining `'payment_failed'` as a legacy
display alias for any old stored data:

The `index.html` diff confirms the canonical `failed` badge was added
(confirmed by `git diff` and `node --check` passing on extracted JavaScript).

### Why This Fix Is Correct

`payment_failed` was never defined in the schema's allowed payment status
values, the RPC, or the UI. Using it created a state where:
- `async_payment_failed` events stored `payment_failed`
- `payment_intent.payment_failed` events stored `failed`
- Two functionally equivalent failures were stored differently
- The UI would show a generic amber badge for `failed` (falling through the
  special case) and the red badge for `payment_failed`

Unifying on `failed` makes all failure paths consistent and matches the status
the UI was already designed to display as a terminal failure state.

---

## Finding 5 of 5 — P1: Successful Stripe Payment Does Not Reliably Update `payment.paid`

### What Codex Found

> The paid completion flow changes `payment.status` but can preserve an old
> `payment.paid` value, creating records such as:
> - `status = paid`
> - `paid = 0`
>
> Required: atomically set the paid amount from a server-trusted Stripe/order
> amount. Verify resulting balance/payment summary is correct.

### What Was Changed

**SQL (`r1-security-revised.sql` — `merge_stripe_payment_completed()` RPC):**

The function signature was extended with a sixth parameter `p_amount_paid
NUMERIC` (Stripe `amount_total` in cents). The function now:
1. Rejects `p_amount_paid <= 0` with a hard EXCEPTION (cannot mark paid with
   no payment)
2. Sets `payment.paid` atomically alongside `payment.status` by dividing cents
   by 100.0 (dollars)

```sql
CREATE OR REPLACE FUNCTION public.merge_stripe_payment_completed(
  p_order_id        TEXT,
  p_tenant_id       TEXT,
  p_session_id      TEXT,
  p_payment_status  TEXT,
  p_payment_method  TEXT,
  p_amount_paid     NUMERIC  -- Stripe amount_total in cents
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_amount_paid <= 0 THEN
    RAISE EXCEPTION
      'merge_stripe_payment_completed: p_amount_paid must be > 0, got % for order %',
      p_amount_paid, p_order_id;
  END IF;

  UPDATE public.orders
  SET data = data
    || jsonb_build_object('stripe_session_id', p_session_id)
    || jsonb_build_object(
         'payment', COALESCE(data->'payment', '{}'::jsonb)
           || jsonb_build_object(
                'status',            p_payment_status,
                'method',            p_payment_method,
                'stripe_session_id', p_session_id,
                'paid',              (p_amount_paid / 100.0)  -- cents → dollars
              )
       )
  WHERE id        = p_order_id
    AND tenant_id = p_tenant_id;
  ...
END;
$$;
```

The old 5-parameter overload (without `p_amount_paid`) is explicitly dropped:

```sql
DROP FUNCTION IF EXISTS public.merge_stripe_payment_completed(TEXT, TEXT, TEXT, TEXT, TEXT);
```

**Edge Function (`stripe-webhook/index.ts`):**

Both `checkout.session.completed` and `checkout.session.async_payment_succeeded`
now pass `session.amount_total` to the RPC:

```typescript
const { error: updateErr } = await supabase.rpc('merge_stripe_payment_completed', {
  p_order_id:       orderId,
  p_tenant_id:      metaTenantId,
  p_session_id:     session.id,
  p_payment_status: 'paid',
  p_payment_method: 'stripe',
  p_amount_paid:    amountTotal,  // ← session.amount_total (Stripe-verified cents)
});
```

Both branches validate `amountTotal > 0` before calling the RPC, returning
`failEvent()` for a zero or absent amount.

V5b (post-commit verification) confirms exactly one overload of
`merge_stripe_payment_completed` exists after the migration.

### Why This Fix Is Correct

`payment.paid` is a critical reporting field. A paid order with `paid = 0`
produces incorrect balance calculations, incorrect payment summaries, and
incorrect audit trails. The Stripe `session.amount_total` is the authoritative
server-verified amount (in cents) — it is set by Stripe, not the client.
Dividing by 100.0 converts to dollars for consistent storage with the existing
`payment.amount` field. The `<= 0` guard prevents marking an order paid with a
zero or negative amount regardless of what Stripe sends.

---

## Revised Migration SQL — Full File

The complete current migration is in:

**`/Users/joshua/casabe-v3/migrations/r1-security-revised.sql`**

This file is the exact current on-disk R7 state. It is not reproduced verbatim
here to avoid redundancy — Delta must read the file directly from the repository
path above before approving. The file is approximately 1,200 lines.

Key section map for Delta navigation:
| Lines (approx.) | Section |
|---|---|
| 1–110 | File header, revision log, rationale for each kept/dropped revoke |
| 111–120 | BEGIN |
| 121–140 | Audit A prerequisite check (instructions, not SQL) |
| 141–165 | Change 1 — N2: Drop unsafe driver UPDATE path |
| 166–195 | Change 2 — N1: Backfill assignedDriverUserId |
| 196–215 | Change 3 — H3: Revoke safe-to-revoke helpers only |
| 216–290 | merge_stripe_payment_completed (6-param, P1-R4-5) |
| 291–295 | DROP old 5-param overload (P1-R5-2) |
| 296–325 | merge_stripe_payment_status |
| 326–430 | Change 3b — stripe_events table + claimed_at + payment_status reconciliation |
| 431–560 | Change 3c — claim_stripe_event() (P0-M1, P0-R5-1, P0-R6-1) |
| 561–630 | Change 3d — finalize_stripe_event() (P0-R4-1) |
| 631–770 | Change 3e — get_checkout_authorized_member() (P1-R5) |
| 771–870 | PUBLIC ACL assertion DO block (P1-M5, P1-R4-3) |
| 871–980 | Change 4 — M2: search_path pins on 4 financial functions |
| 981 | COMMIT |
| 982–1200+ | Post-commit verification queries V1–V11 |

---

## Rollback Plan

**File:** `/Users/joshua/casabe-v3/migrations/r1-security-rollback.sql`

This file is the current staged rollback artifact (confirmed staged in the
Post-Delta R7 Release Readiness Review). It is data-preserving (no DROP TABLE).

**Required rollback order** (critical — do not reverse this):

### Step 1: Restore prior Edge Function versions first

The R7 Edge Functions require RPCs that the rollback will remove. Restore the
prior function source **before** touching the database.

```bash
# Identify prior deployed function source — capture before any deploy
# (Do this BEFORE deploying R7 functions — see Release Blocker 1 from
# Post-Delta R7 Release Readiness Review)
supabase functions deploy stripe-webhook --project-ref exayifxbqduhsxmmsnxr
supabase functions deploy stripe-checkout --project-ref exayifxbqduhsxmmsnxr
# Confirm prior versions are live and accepting events before Step 2
```

### Step 2: Apply database rollback

Only after confirming prior Edge Functions are serving requests:

```sql
-- r1-security-rollback.sql
-- Drops all objects added by r1-security-revised.sql
-- Data-preserving — does NOT drop stripe_events table

-- Drop new RPCs
DROP FUNCTION IF EXISTS public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC);
DROP FUNCTION IF EXISTS public.merge_stripe_payment_status(TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS public.claim_stripe_event(TEXT,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS public.finalize_stripe_event(TEXT,TEXT,TEXT[],TIMESTAMPTZ,TEXT);
DROP FUNCTION IF EXISTS public.get_checkout_authorized_member(TEXT);

-- Restore search_path-pinned functions to non-pinned state
-- (only if the original was non-pinned — review before executing)

-- Re-add driver UPDATE path if removed (only if operationally required)
-- NOTE: do NOT restore orders_driver_update unless explicitly needed;
-- the RPC-only architecture is preferred.

-- Leave stripe_events table in place — hardened schema is compatible
-- with older webhook code (processed_at nullable, claimed_at NOT NULL
-- is benign for an inserting webhook)
```

> **IMPORTANT:** The exact rollback SQL is in `migrations/r1-security-rollback.sql`.
> Read that file directly before executing. Do not execute rollback SQL from
> memory or summary.

### Step 3: Verify rollback

```sql
-- Confirm new RPCs are gone
SELECT proname FROM pg_proc
WHERE proname IN (
  'merge_stripe_payment_completed',
  'merge_stripe_payment_status',
  'claim_stripe_event',
  'finalize_stripe_event',
  'get_checkout_authorized_member'
)
AND pronamespace = 'public'::regnamespace;
-- Expected: 0 rows (or only the old 5-param version if intentionally preserved)

-- Confirm stripe_events still has data
SELECT COUNT(*) FROM public.stripe_events;
-- Expected: same row count as before rollback (0 on a fresh install)

-- Confirm RLS helpers still callable (should be unaffected by rollback)
SELECT
  has_function_privilege('authenticated', 'public.is_hq()',             'EXECUTE') AS is_hq_ok,
  has_function_privilege('authenticated', 'public.current_tenant_id()', 'EXECUTE') AS tenant_ok;
-- Expected: true, true
```

---

## Verification Queries (Delta Post-Apply)

Run these in the Supabase SQL Editor immediately after applying the migration.
**Do not deploy Edge Functions until all queries pass.**

### V1 — Driver UPDATE policy is gone (N2)
```sql
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'orders'
  AND policyname = 'orders_driver_update';
-- Expected: 0 rows
```

### V2 — Driver UPDATE trigger is gone (N2)
```sql
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'trg_restrict_driver_order_update'
  AND tgrelid = 'public.orders'::regclass;
-- Expected: 0 rows
```

### V3 — Driver UUID backfill complete (N1)
```sql
SELECT COUNT(*) AS unfilled_driver_orders
FROM public.orders o
WHERE o.data->>'assignedDriver' IS NOT NULL
  AND (o.data->>'assignedDriverUserId') IS NULL;
-- Expected: 0 (or small number if some legacy names have no matching member)
```

### V4 — get_user_tenant_id revoke (conditional)
```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'get_user_tenant_id'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    IF has_function_privilege('anon', 'public.get_user_tenant_id()', 'EXECUTE') OR
       has_function_privilege('authenticated', 'public.get_user_tenant_id()', 'EXECUTE') THEN
      RAISE WARNING 'get_user_tenant_id() still callable by anon or authenticated — FAILED';
    ELSE
      RAISE NOTICE 'get_user_tenant_id() revoke confirmed';
    END IF;
  ELSE
    RAISE NOTICE 'get_user_tenant_id() absent — optional revoke not applicable';
  END IF;
END $$;
-- Expected: NOTICE about either confirmed revoke or absent function
-- WARNING = problem; investigate before proceeding
```

### V4b — RLS helpers still callable (CRITICAL — must all be true)
```sql
SELECT
  has_function_privilege('authenticated', 'public.is_hq()',              'EXECUTE') AS is_hq_ok,
  has_function_privilege('authenticated', 'public.is_admin()',           'EXECUTE') AS is_admin_ok,
  has_function_privilege('authenticated', 'public.current_tenant_id()',  'EXECUTE') AS current_tenant_ok,
  has_function_privilege('authenticated', 'public.get_user_role()',      'EXECUTE') AS get_user_role_ok,
  has_function_privilege('authenticated', 'public.get_user_office_ids()', 'EXECUTE') AS office_ids_ok;
-- Expected: ALL true — if ANY is false, the migration broke live RLS. STOP.
```

### V5 — Merge RPCs restricted to service_role
```sql
SELECT
  proname,
  prosecdef AS is_security_definer,
  has_function_privilege('anon',         'public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC)', 'EXECUTE') AS anon_blocked,
  has_function_privilege('authenticated','public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC)', 'EXECUTE') AS auth_blocked,
  has_function_privilege('service_role', 'public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC)', 'EXECUTE') AS service_allowed
FROM pg_proc
WHERE proname = 'merge_stripe_payment_completed'
  AND pronamespace = 'public'::regnamespace;
-- Expected: prosecdef=true, anon_blocked=false, auth_blocked=false, service_allowed=true
```

### V5b — Exactly one overload of merge_stripe_payment_completed
```sql
SELECT proname, pg_get_function_identity_arguments(oid) AS signature
FROM pg_proc
WHERE proname = 'merge_stripe_payment_completed'
  AND pronamespace = 'public'::regnamespace;
-- Expected: EXACTLY 1 ROW
-- signature = 'p_order_id text, p_tenant_id text, p_session_id text,
--              p_payment_status text, p_payment_method text, p_amount_paid numeric'
-- If 2 rows: old 5-param DROP did not land. STOP.
```

### V6 — claim, finalize, and authorize RPCs restricted
```sql
SELECT proname,
  has_function_privilege('anon',        'public.claim_stripe_event(TEXT,TEXT,TEXT,TEXT)',   'EXECUTE') AS anon_blocked,
  has_function_privilege('service_role','public.claim_stripe_event(TEXT,TEXT,TEXT,TEXT)',   'EXECUTE') AS service_ok
FROM pg_proc WHERE proname = 'claim_stripe_event' AND pronamespace = 'public'::regnamespace;

SELECT proname,
  has_function_privilege('anon',        'public.get_checkout_authorized_member(TEXT)', 'EXECUTE') AS anon_blocked,
  has_function_privilege('service_role','public.get_checkout_authorized_member(TEXT)', 'EXECUTE') AS service_ok
FROM pg_proc WHERE proname = 'get_checkout_authorized_member' AND pronamespace = 'public'::regnamespace;

SELECT proname,
  has_function_privilege('anon',        'public.finalize_stripe_event(TEXT,TEXT,TEXT[],TIMESTAMPTZ,TEXT)', 'EXECUTE') AS anon_blocked,
  has_function_privilege('service_role','public.finalize_stripe_event(TEXT,TEXT,TEXT[],TIMESTAMPTZ,TEXT)', 'EXECUTE') AS service_ok
FROM pg_proc WHERE proname = 'finalize_stripe_event' AND pronamespace = 'public'::regnamespace;
-- Expected: anon_blocked=false, service_ok=true for all three
```

### V6b — No PUBLIC EXECUTE on any restricted function
```sql
SELECT
  p.proname,
  p.oid::regprocedure::text AS full_signature,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))
    WHERE grantee = 0 AND privilege_type = 'EXECUTE'
  ) AS public_execute_present
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'merge_stripe_payment_completed',
    'merge_stripe_payment_status',
    'claim_stripe_event',
    'finalize_stripe_event',
    'get_checkout_authorized_member',
    'get_user_tenant_id'
  );
-- Expected: public_execute_present = false for ALL rows
-- ANY true = SECURITY VIOLATION. DO NOT deploy. Investigate immediately.
```

### V7 — stripe_events RLS enabled
```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'stripe_events';
-- Expected: rowsecurity = true
```

### V7b — claimed_at has DEFAULT and NOT NULL
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'stripe_events'
ORDER BY ordinal_position;
-- claimed_at: data_type='timestamp with time zone', is_nullable='NO', column_default='now()'
```

### V7c — processed_at is nullable with no default
```sql
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'stripe_events'
  AND column_name  = 'processed_at';
-- Expected: is_nullable='YES', column_default=NULL
```

### V7d — payment_status is NOT NULL with DEFAULT 'processing'
```sql
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'stripe_events'
  AND column_name  = 'payment_status';
-- Expected: is_nullable='NO', column_default='''processing'''
```

### V7e — No NULL or unknown payment_status rows
```sql
SELECT
  COUNT(*) FILTER (WHERE payment_status IS NULL)                                        AS null_count,
  COUNT(*) FILTER (WHERE payment_status NOT IN ('processing','processed','failed'))      AS unknown_count
FROM public.stripe_events;
-- Expected: null_count=0, unknown_count=0
```

### V8 — Financial functions have search_path pinned
```sql
SELECT proname, proconfig
FROM pg_proc
WHERE proname IN (
  'generate_receipt_number',
  'generate_invoice_number',
  'calculate_invoice_total',
  'update_invoice_timestamp'
)
AND pronamespace = 'public'::regnamespace;
-- Expected: 4 rows, each with proconfig containing 'search_path='
```

### V9 — 42 live RLS policies still exist (critical regression check)
```sql
SELECT COUNT(*) AS policy_count
FROM pg_policies p
WHERE p.qual ILIKE '%is_hq%'
   OR p.qual ILIKE '%is_admin%'
   OR p.qual ILIKE '%current_tenant_id%'
   OR p.with_check ILIKE '%is_hq%'
   OR p.with_check ILIKE '%is_admin%'
   OR p.with_check ILIKE '%current_tenant_id%';
-- Expected: 42 or more (same as Delta baseline)
-- If count is lower: a policy was accidentally dropped. STOP. Do not deploy.
```

### V10 — finalize_stripe_event transition enforcement
```sql
-- Run in a test transaction; ROLLBACK when done
BEGIN;
INSERT INTO public.stripe_events (id, event_type, payment_status, claimed_at)
  VALUES ('evt_test_v10', 'test.event', 'processing', now());
SELECT public.finalize_stripe_event('evt_test_v10', 'processed', ARRAY['processing'], now(), NULL);
-- Expected: 1

SELECT public.finalize_stripe_event('evt_test_v10', 'failed', ARRAY['processing'], NULL, 'test');
-- Expected: 0 (row is now 'processed', not in allowed_from)
ROLLBACK;
```

### V11 — merge_stripe_payment_completed rejects zero amount
```sql
-- Run in a test transaction; ROLLBACK when done
BEGIN;
SELECT public.merge_stripe_payment_completed(
  'test-order', 'test-tenant', 'sess_x', 'paid', 'stripe', 0
);
-- Expected: EXCEPTION containing 'p_amount_paid must be > 0'
ROLLBACK;
```

---

## Open Release Gates (Not Code Blockers)

These are **release-process** gates, not code-level findings. They are
documented here so Delta and Jefe have a complete picture before execution.

1. **Netlify production target confirmed (Gate 2 — CLEARED)**
   Site: `casabe-connect` / Site ID: `1ddaab02-8e75-4a22-877c-99d603ff1db5`
   Owning team: `casabe718`. Production branch: `main`. Git-connected.
   Do not use the locally linked `casabekonnect-app` site for this deploy.

2. **Rollback artifact staged (Gate 1 — CLEARED)**
   `migrations/r1-security-rollback.sql` is staged and data-preserving.
   Rollback order: restore prior Edge Functions first, then apply SQL rollback.

3. **`index.html` is a coordinated bundle, not a badge-only change**
   The current diff includes: Spanish localization, canonical driver selector,
   UUID-less guard, and the canonical `failed` badge alias. This must be
   released as a coordinated bundle with a full acceptance report.

4. **Private prerequisites** (Jeffrey confirms privately):
   - Live DB password rotated after May 27, 2026
   - `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` present in Supabase secrets
   - Prior Edge Function source/versions captured before replacement

5. **Authenticated live-browser acceptance** for the full `index.html` bundle:
   `DELTA-FINAL-BUNDLE-ACCEPTANCE.md` provides source/static evidence.
   Live desktop/mobile, English/Spanish, and authenticated driver-selector
   evidence should be labeled clearly as pending until post-deployment.

---

## Final Statement

All five Codex findings from the handoff have been addressed in the exact
current source:

| Finding | Codex ID | Status | File | Line Range (approx.) |
|---|---|---|---|---|
| Webhook finalization fails silently | P0-R4-1 | ✅ Fixed | `r1-security-revised.sql` + `stripe-webhook/index.ts` | SQL: ~561–630; TS: ~152–245 |
| `claimed_at` upgrade incomplete | P1-R4-2 | ✅ Fixed | `r1-security-revised.sql` | ~362–378 |
| PUBLIC ACL assertion incomplete | P1-R4-3 | ✅ Fixed | `r1-security-revised.sql` | ~771–870 |
| Async failure writes wrong status | P1-R4-4 | ✅ Fixed | `stripe-webhook/index.ts` | ~418–422 |
| Paid completion doesn't update `payment.paid` | P1-R4-5 | ✅ Fixed | `r1-security-revised.sql` + `stripe-webhook/index.ts` | SQL: ~229–265; TS: ~307–320 |

No new code-level blockers were introduced. The remaining items are
release-process gates documented in the Open Release Gates section above.

**Next steps per release sequence:**
1. Delta reviews this document and the exact source diff
2. Delta runs live preflight queries (V1–V11 above) in a test run if possible
3. Jefe privately confirms DB password rotation and Stripe secret presence
4. Jefe approves coordinated apply/deploy
5. Apply migration, run V1–V11 in SQL Editor, confirm all pass
6. Deploy `stripe-checkout` and `stripe-webhook` Edge Functions
7. Run Stripe test-mode flows (paid, async paid, failed, refund, duplicate,
   tamper, unauthorized-role)
8. Mark release complete only after all evidence passes

_— Forge, 2026-06-14_
