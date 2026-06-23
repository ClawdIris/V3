# Codex Second-Person Review — Stripe + Driver Selector

**Date:** 2026-06-10  
**Verdict:** **STOP-SHIP / NEEDS REVISION**  
**Reviewed:** T1, T2, T3, T4, canonical driver selector, acceptance test

## P0 Findings

### 1. New Stripe SECURITY DEFINER RPCs are still callable through PUBLIC

`CREATE FUNCTION` grants EXECUTE to PostgreSQL `PUBLIC` by default.

The migration only runs:

```sql
REVOKE EXECUTE ... FROM anon, authenticated;
```

Because `anon` and `authenticated` are members of `PUBLIC`, the default PUBLIC
grant still permits calls. Both merge RPCs are SECURITY DEFINER and accept an
arbitrary order ID and tenant ID, creating a cross-tenant payment-write path.

Required:

```sql
REVOKE ALL ON FUNCTION public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_stripe_payment_status(TEXT,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_stripe_payment_status(TEXT,TEXT,TEXT)
  TO service_role;
```

Add authenticated and anon RPC calls proving permission denied.

### 2. Migration reintroduces unsafe direct driver UPDATE access

The approved R1 architecture removed `orders_driver_update` and requires drivers
to use the narrow `update_driver_status` RPC.

`stripe-security-migration.sql` recreates `orders_driver_update`. Its trigger
only blocks changes to:

- `data.payment`
- `data.customer`
- `data.assignedDriver`
- `data.assignedDriverUserId`

It does not enforce "status and updated_at only." A driver can directly modify
other JSONB fields and top-level fields.

Required:

- Remove `orders_driver_update`.
- Remove `restrict_driver_order_update` and its trigger.
- Keep driver writes exclusively through `update_driver_status`.
- Preserve the existing forbidden-write Tests A–G.

### 3. Revoking helper EXECUTE can break RLS, and PUBLIC grants are not handled

RLS callers need EXECUTE permission on helper functions referenced by policies.
`SECURITY DEFINER` changes the privileges used inside the function; it does not
remove the caller's need to execute the function.

The migration revokes helpers including `is_member`, `get_user_role`, and
`can_access_order` from authenticated users even though current orders policies
call them. This risks turning normal reads/writes into permission errors.

Also, revoking only from `anon, authenticated` does not remove default PUBLIC
EXECUTE.

Required:

- Do not revoke RLS helper EXECUTE without a live dependency and privilege audit.
- Separate helper-hardening from the Stripe migration.
- For internal non-RLS RPCs, revoke from `PUBLIC, anon, authenticated`, then
  explicitly grant only intended roles.
- Add authenticated RLS regression tests after every privilege change.

## P1 Money-Path Findings

### 4. Checkout currency remains client-controlled

The amount is server-derived, but `currency` is still accepted from the request
and passed directly to Stripe. Currency is part of the payable amount contract.

Required:

- Derive currency server-side from the order/tenant configuration, or enforce
  the platform's fixed currency (`usd`).
- Reject unsupported currency values.
- Do not accept `invoice_id` or description as authoritative metadata if they
  are not verified against the order.

### 5. Refund and failure metadata propagation assumption is incorrect

Checkout Session `metadata` is not automatically copied to the created
PaymentIntent or Charge. The current failure and refund branches read:

- `intent.metadata.order_id`
- `charge.metadata.order_id`

Those fields will normally be absent unless checkout creation explicitly sets
`payment_intent_data.metadata`, or the webhook resolves the associated Checkout
Session/PaymentIntent.

Required:

- Set the same trusted metadata in `payment_intent_data.metadata` during
  Checkout Session creation.
- For charge refunds, resolve the PaymentIntent/Checkout Session reliably rather
  than assuming Charge metadata is populated.
- Add real Stripe test-mode webhook tests for completed, failed, full refund,
  and partial refund.

### 6. Webhook marks failed/no-op writes as processed

The refund and payment-failed branches log RPC/order lookup failures, then still
mark the Stripe event `processed`. Missing metadata is also marked processed.
Stripe will not retry these lost updates.

Required:

- Throw/return non-2xx when an expected order update fails.
- Mark the event `failed`, not `processed`.
- Do not mark missing-correlation events processed until they are intentionally
  classified and handled.

### 7. Webhook idempotency reservation is race-prone

The code checks for an existing event, then inserts a reservation, but ignores
insert errors. Concurrent delivery can allow both invocations to continue.

Required:

- Atomically reserve with an insert guarded by the unique event ID.
- If the insert conflicts, return duplicate success immediately.
- Check every reservation/update database error.

### 8. Completed session is treated as paid without verifying payment state

`checkout.session.completed` is immediately merged as `paid`. For delayed
payment methods, completion can occur before funds are paid.

Required:

- Verify `session.payment_status === 'paid'`, or support
  `checkout.session.async_payment_succeeded` / failed events appropriately.

## Driver Selector Findings

### 9. Canonical members query exists, but fallback still permits UUID-less drivers

The live members query and dual-write handler are present. However, when the
members query returns no rows, the legacy fallback is used and the New Order
selector filters only `active !== false`. It does not exclude empty `userId`
entries, so Joe Sr. or other UUID-less drivers remain assignable.

Required:

- Filter New Order options to `d.userId` being a valid non-empty UUID.
- If the canonical members query fails or returns zero drivers, show a clear
  blocking error instead of silently falling back to UUID-less assignments.
- Run the acceptance test as both HQ and Office to confirm members RLS permits
  reading active drivers.

### 10. Driver acceptance document contains stale RLS guidance

`DRIVER-SELECTOR-ACCEPTANCE-TEST.md` says `orders_member_all` still exists and
Driver B may see other tenant orders. Production apply evidence says that policy
was replaced by scoped policies.

Required:

- Remove the stale note.
- Driver B seeing any Driver A order is a hard failure.
- Use the correct deployed debug URL for this workflow:
  `https://casabe-connect.netlify.app/?debug=1`.

## Required Re-Review Gate

Before merge/deploy/apply:

1. Forge fixes P0–P1 findings.
2. Delta re-reviews the exact new diff.
3. Run Stripe test-mode completed/failure/refund tests.
4. Run anon/authenticated permission-denied tests against merge RPCs.
5. Run existing orders RLS Tests A–G.
6. Run the driver-selector acceptance flow in the deployed debug site.

---

## Revised-Diff Re-Review — 2026-06-10

**Verdict:** **STOP-SHIP remains**

The revised diff correctly fixes:

- PUBLIC access on the two Stripe merge RPCs
- accidental `orders_driver_update` / trigger recreation
- direct revocation of `is_member`, `get_user_role`, and `can_access_order`
- client-controlled currency
- Checkout Session correlation for refund/failure events
- UUID-less driver display and save paths

The following blockers remain.

### P0-R1. Migration still revokes helpers used by live RLS policies

`stripe-security-migration.sql` still revokes `is_hq`, `is_admin`, and
`current_tenant_id` from PUBLIC/anon/authenticated.

Delta's live dependency query in `smoke-setup/DELTA-STOPSHIP-PREFLIGHT.md`
confirmed:

- `is_hq()` is used by 18 live policies
- `is_admin()` is used by 2 live policies
- `current_tenant_id()` is used by 40 live policies
- 42 dependent policy rows exist across 13 tables

Applying the migration as written would break live RLS. Remove those three
functions from the revoke block. Also audit `get_user_office_ids()` before
revoking it; repository policy definitions use it extensively.

Only revoke helpers proven absent from every live policy and direct client call.

### P0-R2. Failed webhook events cannot actually retry

The webhook records failed events in `stripe_events` using the Stripe event ID,
then returns 500. On Stripe's retry, the initial lookup finds that same row and
immediately returns duplicate success, regardless of its `payment_status`.

This affects order mismatches, Checkout Session lookup errors, RPC failures, and
other processing failures. The first failure is therefore still permanently
lost.

Required:

- Treat only `processed` events as duplicate success.
- Permit a `failed` event to be atomically reclaimed for retry.
- Define stale-`processing` recovery.
- Check every insert/update error.

### P0-R3. Event reservation remains race-prone

Each branch still performs a separate existence check and then an unchecked
insert. Two concurrent deliveries can both pass the check; the loser of the
primary-key insert ignores the error and continues processing.

Use one atomic database operation/RPC to claim the event. It must return whether
the caller owns the claim, and allow retry of failed/stale claims.

### P1-R4. Completed Checkout Session is still marked paid without payment check

`checkout.session.completed` always calls the merge RPC with `paid`; it does not
verify `session.payment_status === 'paid'`. Delayed payment methods can complete
the Checkout Session before payment succeeds.

Verify the payment state before marking paid and support the appropriate async
success/failure events, or explicitly restrict Checkout to immediate payment
methods and test that contract.

### P1-R5. Checkout authorization is tenant-wide, not role-scoped

`stripe-checkout` resolves any active membership and then reads the requested
tenant order with the service-role client. A driver or other active tenant member
can call the Edge Function directly and create Checkout Sessions for arbitrary
orders in that tenant.

The UI calls this an HQ-only action, so the Edge Function must enforce the
authorized role server-side before using service-role access.

### P1-R6. Migration verification misstates PostgreSQL default ACL behavior

The V4 comment says a NULL `proacl` is correct after revoking PUBLIC. For
functions, NULL means default privileges, which include PUBLIC EXECUTE. The
verification must use `has_function_privilege(...)` for PUBLIC, anon,
authenticated, and service_role instead of interpreting `proacl` text.

### Driver Selector Re-Review

The UUID-less driver display filter and save guard are present and correct at
source level. Runtime acceptance remains required after deployment. The
acceptance document still contains stale guidance saying Driver B may see Driver
A orders; that must be changed to a hard failure before the test is run.

---

## R1 Revised Migration Review — 2026-06-10

**Reviewed:** `migrations/r1-security-revised.sql`,
`smoke-setup/FORGE-REVISION-NOTES.md`, and the current Edge Function sources.

**Verdict:** **NEEDS REVISION — do not queue approval/apply**

### P0-M1. `claim_stripe_event()` does not provide one-winner ownership

After `INSERT ... ON CONFLICT DO NOTHING`, every concurrent caller selects the
same recent `processing` row. Each caller then runs the same no-op UPDATE:

```sql
UPDATE public.stripe_events
SET claimed_at = claimed_at
WHERE id = p_event_id
  AND payment_status = 'processing'
  AND claimed_at >= now() - INTERVAL '2 seconds';
```

That UPDATE matches for both the inserting caller and every concurrent losing
caller. `FOUND` is therefore true for all of them, and all return `claimed`.
The race condition remains.

Required: capture ownership from the original INSERT itself using `RETURNING`,
then use a separate conditional UPDATE for failed/stale reclaim. Never infer
ownership from a timestamp window.

### P0-M2. Existing `stripe_events` installations are not migrated

Production already has the older `stripe_events` table without `claimed_at`.
`CREATE TABLE IF NOT EXISTS` does not add missing columns. The migration then
creates/calls a claim function that references `claimed_at`, so the new flow
will fail.

Add the required `ALTER TABLE ... ADD COLUMN IF NOT EXISTS claimed_at ...`
inside the migration. Do not leave a required schema change as an open question
or manual pre-apply branch.

### P0-M3. Companion Edge Function fixes are not implemented

The current `stripe-webhook/index.ts` still uses SELECT + unchecked INSERT, and
the current `stripe-checkout/index.ts` still authorizes any active tenant
member. Snippets in revision notes do not close runtime blockers.

Forge must implement both companion changes and submit one exact release diff
for review. Migration and Edge Functions must be deployed together only after
approval.

### P1-M4. Paid-state blocker remains open

The current webhook still marks every `checkout.session.completed` event paid
without checking `session.payment_status`. The revised migration does not
address this. Add the payment-state gate and define/test delayed-payment event
handling.

### P1-M5. Verification queries do not test PUBLIC access

V4/V5/V6 check anon/authenticated/service_role but do not directly verify
PostgreSQL PUBLIC privileges. Add a reliable effective-ACL check for every
restricted function, such as expanding
`COALESCE(proacl, acldefault('f', proowner))` with `aclexplode(...)` and proving
there is no EXECUTE privilege for `grantee = 0` (PUBLIC).

### Confirmed Improvements

- Unsafe revokes for live RLS helpers were removed.
- `get_user_tenant_id()` is the only retained membership-helper revoke, gated
  on the required caller audit.
- Merge RPCs revoke PUBLIC/anon/authenticated and explicitly grant service_role.
- Direct driver UPDATE cleanup remains consistent with the RPC-only design.

---

## Forge R4 Review — 2026-06-10

**Verdict:** **NEEDS REVISION — Delta approval should remain unqueued**

### Confirmed Fixed

- Primary event claim now uses `INSERT ... RETURNING`; concurrent insert losers
  do not claim ownership.
- Failed/stale reclaim uses a separate conditional UPDATE.
- Both Edge Function companion changes are implemented.
- Checkout authorization is enforced server-side.
- Currency is fixed to USD and PaymentIntent metadata is populated.
- `checkout.session.completed` now gates on `payment_status = 'paid'`.
- Async success/failure handlers and Driver B hard-failure documentation exist.

### P0-R4-1. Webhook event-state writes still fail silently

`failEvent()`, `succeedEvent()`, and every skip/default branch await a
`stripe_events` UPDATE but never check its returned error or whether a row was
updated.

The most dangerous case is `failEvent()`: if marking the claim `failed` does
not land, it returns 500 while the row remains recent `processing`. Stripe's
next retry receives `claimed=false`, gets a 200 duplicate response, and the
failed order update can be permanently lost.

Required:

- Check every event-state UPDATE result and affected-row outcome.
- Use a service-role-only finalize/fail RPC with explicit allowed transitions,
  or otherwise make claim finalization reliable.
- Do not return 200 from `succeedEvent()` or skip branches unless their event
  state was successfully finalized.

### P1-R4-2. Existing-table `claimed_at` upgrade is incomplete

The migration adds `claimed_at TIMESTAMPTZ` and backfills NULLs, but it never
runs `ALTER COLUMN SET DEFAULT now()` or `ALTER COLUMN SET NOT NULL` for an
existing table. Its comments claim that contract is ensured, but it is not.

This also leaves a migration/deploy window where old webhook code can insert a
row with NULL `claimed_at`; such a row is neither active nor stale under the
claim predicates and cannot be reclaimed.

Required:

```sql
ALTER TABLE public.stripe_events
  ALTER COLUMN claimed_at SET DEFAULT now(),
  ALTER COLUMN claimed_at SET NOT NULL;
```

Deploy the migration and webhook as one coordinated release.

### P1-R4-3. PUBLIC ACL assertion omits restricted functions

The fail-loud ACL block checks only the two merge RPCs and
`claim_stripe_event()`. It omits the new service-role-only
`get_checkout_authorized_member()` function. It also does not assert the kept
`get_user_tenant_id()` revoke when that function exists.

Include every restricted function in the effective-PUBLIC ACL assertion and
post-commit verification.

### P1-R4-4. Async failure writes a different payment status

`checkout.session.async_payment_failed` writes `payment_failed`, while
`payment_intent.payment_failed` writes `failed`. The platform does not define
`payment_failed` as a normal payment status, so equivalent failures produce
different stored states.

Use the canonical `failed` value unless a schema/UI contract for
`payment_failed` is deliberately added and tested.

### P1-R4-5. Paid Stripe completion does not update amount paid

`merge_stripe_payment_completed()` changes `payment.status` to `paid` but
preserves the existing `payment.paid` value. A newly paid Stripe order can
therefore be stored as `status = paid` with `paid = 0`, producing inconsistent
balances and reporting.

The completion path must atomically set the paid amount from a server-trusted
Stripe/order amount and test the resulting balance.

---

## Forge R5 Review — 2026-06-11

**Verdict:** **NEEDS REVISION — do not queue Delta yet**

The five R4 findings were materially addressed, but the exact R5 source and
migration still contain five release blockers.

### Confirmed Fixed From R4

- `finalize_stripe_event()` replaces bare `stripe_events` UPDATE calls, checks
  errors/row count, and prevents successful finalization responses when the
  state transition did not land.
- Existing `claimed_at` values are backfilled and the migration now sets
  `DEFAULT now()` plus `NOT NULL`.
- The transactional PUBLIC ACL assertion now includes the two merge RPCs,
  `claim_stripe_event`, `finalize_stripe_event`, and
  `get_checkout_authorized_member`, with a conditional check for
  `get_user_tenant_id`.
- Webhook failure writes use canonical `failed`.
- Paid completion passes Stripe's `session.amount_total`; the merge RPC rejects
  non-positive amounts and writes `payment.paid` in dollars.
- Repository caller audit found only the two updated webhook calls to the new
  six-parameter `merge_stripe_payment_completed` signature.
- Checkout mode is hardcoded to `payment`, so this checkout function cannot
  create setup-mode Sessions.

### P0-R5-1. Active-processing duplicates return 200 and can suppress recovery

`claim_stripe_event()` returns the same `claimed=false/action=duplicate` result
for both fully processed events and events actively owned by another request.
The webhook returns HTTP 200 for every `claimed=false` result.

Failure sequence:

1. Request A claims the event and starts processing.
2. Request B receives the same event while A is still `processing`.
3. Request B gets `claimed=false` and returns 200.
4. Request A fails or cannot finalize and returns 500.
5. Stripe has already received a successful 200 delivery and may stop retries.
6. The event remains `processing`; the five-minute stale-reclaim path may never
   be reached.

Required:

- Distinguish `processed_duplicate` from `in_progress`.
- Return 200 only for a confirmed `processed` duplicate.
- Return a retryable non-2xx response for `in_progress`, or redesign the lease
  protocol so a concurrent 200 cannot suppress owner-failure recovery.
- Add a concurrency test where the owner fails after a concurrent delivery.

### P1-R5-2. Old five-parameter payment-completion overload can survive

The prior migration defines
`merge_stripe_payment_completed(TEXT,TEXT,TEXT,TEXT,TEXT)`. R5 creates a new
six-parameter function, which does not replace or remove the old overload.

The R5 transactional ACL assertion checks only the new six-parameter signature.
The post-commit name sweep can reveal the old overload, but that happens after
the migration is committed and does not remove it.

Required:

- Preflight production for all overloads.
- Explicitly drop the old five-parameter overload inside the transaction after
  confirming no dependency requires it, or fail the migration before COMMIT.
- Verify exactly one allowed overload exists and every overload has the expected
  ACL.

### P1-R5-3. Optional `get_user_tenant_id()` verification is still unconditional

The migration correctly makes the revoke and transactional ACL assertion
conditional when `get_user_tenant_id()` does not exist. However, post-commit V4
unconditionally calls:

`has_function_privilege(..., 'public.get_user_tenant_id()', 'EXECUTE')`

If the function is absent, the required verification run errors instead of
cleanly reporting that the optional function is absent.

Required:

- Make V4 existence-aware, matching the conditional migration logic.
- Preserve the direct-caller audit gate before revoking it when it does exist.

### P1-R5-4. Existing `stripe_events.processed_at` contract is not reconciled

The already-checked-in `r6-stripe-idempotency.sql` creates:

`processed_at TIMESTAMPTZ NOT NULL DEFAULT now()`

R5's desired table definition makes `processed_at` nullable with no default,
but `CREATE TABLE IF NOT EXISTS` does not alter an existing column. On an
existing production table, newly claimed `processing` events will therefore
appear to have been processed immediately, and failed events retain misleading
processed timestamps.

Required:

- Preflight the live `stripe_events` column contract.
- Reconcile `processed_at` explicitly, including dropping the old default and
  NOT NULL constraint if nullable-until-finalized is the intended contract.
- Add a verification proving a new `processing` claim has
  `processed_at IS NULL`, a successful event receives a timestamp, and a failed
  event follows the documented timestamp contract.

### P1-R5-5. UI still special-cases the removed `payment_failed` value

Forge reports zero `payment_failed` status values, but `index.html` still
special-cases `ps === 'payment_failed'` for the red Payment Failed badge and has
no equivalent special case for canonical `failed`.

The webhook will now store `failed`, which falls through to a generic amber
badge rather than the intended red failure badge.

Required:

- Render canonical `failed` as Payment Failed.
- Optionally retain `payment_failed` only as a legacy display alias if old data
  exists.
- Add a UI acceptance check for Stripe failure status.

### Open Question Results

- **OQ-9:** `allowed_from = ['processing']` is correct after a failed/stale
  reclaim because the winning reclaim changes the row back to `processing`.
  The separate active-processing 200 behavior remains the P0 issue above.
- **OQ-10:** Repository grep found only the two updated six-parameter webhook
  callers. Production overload existence still requires the migration fix and
  live preflight above.
- **OQ-11:** The project checkout function hardcodes `mode: 'payment'`, so it
  cannot create setup-mode Sessions.
- **R5-NOTE-3:** Unresolved. The migration must handle the old five-parameter
  overload before COMMIT rather than relying only on post-apply observation.

### Required Next Pass

Forge should fix P0-R5-1 and P1-R5-2 through P1-R5-5 in actual code/SQL. Then
Codex should review the exact revised diff before Delta is queued. Nothing
should be applied, merged, or deployed yet.

---

## Forge R6 Review — 2026-06-11

**Verdict:** **NEEDS REVISION — Delta should remain unqueued**

R6 correctly implements the five requested R5 fixes, but the exact claim state
machine still has one P0 retry-suppression path and the existing
`stripe_events.payment_status` production contract remains unreconciled.

### Confirmed Fixed From R5

- Active, non-stale `processing` rows now return `action = 'in_progress'`, and
  the webhook returns HTTP 409 for that action.
- The known old five-parameter `merge_stripe_payment_completed` overload is
  dropped transactionally; repository source has only the two updated
  six-parameter webhook callers.
- V4 is existence-aware for optional `get_user_tenant_id()`.
- Existing `processed_at` NOT NULL/default behavior is removed, and existing
  processing/failed rows are normalized to `processed_at IS NULL`.
- Canonical `failed` renders the red Payment Failed badge while preserving the
  legacy `payment_failed` display alias.
- Extracted `index.html` JavaScript passes `node --check`.
- `git diff --check` passes.

### P0-R6-1. Losing a reclaim race is still acknowledged as a processed duplicate

After the initial active-processing branch, stale/failed callers attempt the
atomic reclaim UPDATE. If another caller wins that reclaim race, the losing
caller reaches the final return:

`{ claimed: false, action: 'duplicate' }`

The webhook treats every `duplicate` as a confirmed processed event and returns
HTTP 200. At this point, however, the reclaim winner has only changed the row
back to `processing`; it has not successfully processed/finalized the event.

Failure sequence:

1. A failed or stale event receives two concurrent retries.
2. Retry A wins the reclaim UPDATE and begins processing.
3. Retry B loses the reclaim UPDATE, receives `action = 'duplicate'`, and
   returns HTTP 200.
4. Retry A later fails before successful finalization.
5. Stripe has received a 200 and recovery can again be suppressed.

Required:

- After a failed reclaim UPDATE, re-read the current event state.
- Return `duplicate` only when the current state is confirmed `processed`.
- Return `in_progress` when another caller won the reclaim and the current
  state is `processing`.
- Fail closed for any missing/unknown state; do not label it a processed
  duplicate.
- In the webhook, return 200 only for the explicit `duplicate` action. Return a
  retryable non-2xx response for `in_progress` and unknown actions.
- Add a concurrent failed/stale reclaim test where the reclaim winner later
  fails.

### P1-R6-2. Existing nullable `payment_status` contract remains unreconciled

The checked-in production predecessor migration creates:

`payment_status TEXT`

with no NOT NULL constraint and no default. R6's desired `CREATE TABLE IF NOT
EXISTS` definition says:

`payment_status TEXT NOT NULL DEFAULT 'processing'`

but it does not alter an existing table to enforce that contract.

Any legacy row with NULL or an unknown status bypasses the `processed`,
`processing`, and `failed` branches. It then reaches the final reclaim-loss
fallback and is acknowledged as a `duplicate`, despite never being confirmed
processed.

Required:

- Delta preflight must enumerate `payment_status` values and count NULL rows.
- Define a safe handling strategy for legacy NULL/unknown values. Do not infer
  processed status without evidence.
- Reconcile the existing column contract with an explicit default and NOT NULL
  enforcement after safe cleanup, or make the claim function fail closed for
  NULL/unknown states.
- Add post-migration verification for `payment_status` nullability, default,
  allowed values, and zero NULL/unknown rows.

### Required Next Pass

Forge should fix P0-R6-1 and P1-R6-2 in actual SQL/TypeScript and add the
corresponding verification/tests. Codex should then review the exact R7 diff
before Delta is queued. Nothing should be applied, merged, or deployed yet.

---

## Forge R7 Review — 2026-06-11

**Verdict:** **CONDITIONALLY APPROVED FOR DELTA REVIEW — nothing may apply or deploy**

R7 clears the remaining code-level P0/P1 findings from the R6 review. Delta may
now review the exact diff and run live preflight/regression tests. The migration
must not be applied until Delta resolves the legacy `rejected` status gate
below and Jeffrey explicitly approves.

### Confirmed Fixed

- A reclaim-race loser re-reads the actual current row state.
- `duplicate` is returned only when the re-read status is confirmed
  `processed`.
- A reclaim winner still working returns `in_progress`; the webhook returns
  HTTP 409.
- NULL/unexpected/reclaim-race states return `unknown`; the webhook fails
  closed with HTTP 500.
- The webhook returns HTTP 200 only for the explicit confirmed `duplicate`
  action.
- Existing `payment_status` NULL values are reconciled before NOT NULL/default
  enforcement.
- `payment_status` receives `DEFAULT 'processing'` and `NOT NULL`.
- V7d/V7e verify the final column contract and data distribution.
- Extracted `index.html` JavaScript passes `node --check`.
- `git diff --check` passes.
- Repository caller/status audit found no additional current Edge Function
  writers outside the reviewed webhook.

### Mandatory Delta Live-Data Gate: Legacy `rejected` Status

The predecessor webhook in the checked-in source explicitly wrote:

`payment_status: 'rejected'`

for order-not-found or tenant-mismatch events. R7 defines only
`processing`, `processed`, and `failed` as allowed values, so its generic
unknown-status backfill will rewrite any live `rejected` rows to `failed`.

That changes a previously terminal security rejection into a retryable event.
It may be acceptable only if Delta confirms no such live rows exist or Jeffrey
explicitly approves the intended replay behavior.

Before apply, Delta must:

1. Query the exact live `payment_status` distribution, including NULL and
   `rejected` counts.
2. Inspect every `rejected`/unknown row's event type, order/tenant metadata, and
   raw error.
3. If any `rejected` rows exist, choose and document one disposition:
   - preserve them as an explicit terminal status and teach the claim/webhook
     state machine how to safely acknowledge them; or
   - map them to `processed` while retaining audit evidence; or
   - deliberately map them to `failed` for retry only with Jeffrey's written
     approval.
4. Do not let the migration silently rewrite a nonzero `rejected` population
   based only on a `RAISE NOTICE`.

### Required Delta Review and Test Gates

- Review the exact R7 SQL/TypeScript/index diff.
- Run the live `payment_status` distribution and legacy `rejected` audit.
- Verify exactly one six-parameter payment-completion overload remains.
- Verify optional `get_user_tenant_id()` existence and direct callers before
  revoke.
- Verify all restricted RPC ACLs and preserved RLS helper privileges.
- Run a concurrent primary-claim test.
- Run concurrent failed/stale reclaim tests where:
  - the reclaim winner succeeds;
  - the reclaim winner fails;
  - the reclaim loser receives `in_progress`, never `duplicate`.
- Test unknown-state fail-closed behavior.
- Verify new claims have `payment_status = 'processing'`,
  `claimed_at IS NOT NULL`, and `processed_at IS NULL`.
- Verify successful finalization sets `processed_at`; failed finalization does
  not falsely mark processed.
- Run Stripe test-mode paid, async paid, failed, refund, duplicate, tamper, and
  unauthorized-role tests.
- Run the full RLS regression suite before apply approval.

### Release Gate

Delta may be queued for review/preflight now. Nothing should be applied,
merged, or deployed until Delta passes every gate, the legacy `rejected`
disposition is resolved, Codex reviews any resulting code change, and Jeffrey
explicitly approves.

---

## Post-Delta R7 Release Readiness Review — 2026-06-11

**Code verdict:** **APPROVED**

**Execution verdict:** **HOLD — correct the release procedure before Jeffrey
approves execution**

Delta passed the R7 code, live-schema, and concurrency gates. The empty live
`stripe_events` table clears the legacy `rejected` disposition gate. The
proposed apply/deploy procedure still has release-process blockers.

### Release Blocker 1: Proposed Git command pushes the wrong branch

The working repository is currently on `main`. Delta's Step 4 says to commit
the current `index.html` change and then run:

`git push origin codex/rebuild-unified-shell`

That command pushes the existing local `codex/rebuild-unified-shell` branch,
not the new commit created on `main`. The branch is currently 90 commits behind
`main`, so the proposed command would not deploy the new badge commit and may
trigger an unintended stale-branch build depending on Netlify configuration.

Required:

- Confirm Netlify's actual production branch.
- Create/choose the intended release branch before committing.
- Push the branch that actually contains the reviewed release commit.
- Do not use the proposed Step 4 command as written.

### Release Blocker 2: `index.html` is not a badge-only diff

The current `index.html` diff is approximately 243 changed lines
(`177` additions and `66` deletions). It includes:

- Spanish localization changes.
- Canonical members-based driver selector changes.
- UUID-less driver assignment guards.
- Catch/notify changes.
- The one-line canonical `failed` badge alias.

Committing `index.html` with the message
`R7: canonical failed badge fix` would silently deploy all of those active
workstreams without their full acceptance/deployment sign-off.

Required:

- Either approve and test the complete `index.html` bundle as one coordinated
  release, with an accurate commit message and acceptance suite; or
- Isolate the badge fix in a clean worktree/branch without discarding the
  existing active changes.
- Do not commit the current full `index.html` diff as a badge-only release.

### Release Blocker 3: Password-rotation proof is not established by commit

Delta cites commit `997f37b` as proof that the Supabase DB password was rotated.
That commit is titled `fix: remove hardcoded database credential` and changes
`apply-migration.js`. It proves source cleanup, not that the live database
password was rotated in Supabase.

Required:

- Independently confirm the live DB password rotation in the trusted Supabase
  dashboard/password manager.
- Keep the password out of chat, Git, and reports.

### Release Procedure Corrections

- Verify `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are present in Supabase
  secrets before any function deployment.
- Capture the currently deployed Edge Function versions before replacement.
- Prepare an explicit database rollback migration. The main migration is
  transaction-wrapped only until `COMMIT`; failures in post-commit V1-V11
  verification do not automatically roll back the committed migration.
- Apply migration and run every verification query before deploying functions.
- Deploy `stripe-webhook` and `stripe-checkout` as the reviewed coordinated
  function release.
- Use a clean, explicitly approved frontend release branch and confirm the
  Netlify production branch before pushing.
- Treat the five Stripe test-mode flows as mandatory post-deploy release gates,
  even though they are not blockers to applying the empty-table schema
  migration.

### Approval State

The R7 code and migration are ready for a corrected coordinated release plan.
Jeffrey should not approve execution of Delta's current Steps 1-5 verbatim.
Return the corrected branch/frontend scope, secret confirmation, live password
rotation confirmation, and rollback artifact before requesting the final go.

---

## Delta Release-Process Resolution Review — 2026-06-11

**Verdict:** **HOLD — the revised release process still has P0 execution
blockers**

Delta resolved the stale-branch identification, but the corrected plan is not
safe to execute yet.

### Migration-First Sequence: Cleared With Deployment Capture Gate

Final cross-check corrected an earlier concern:

- Delta's live preflight found **zero** existing
  `merge_stripe_payment_completed` overloads.
- The current committed predecessor webhook does not call that RPC.

Therefore, the migration's five-parameter DROP is a no-op on the verified live
database and does not create the previously suspected compatibility gap. The
new webhook requires the new RPCs, so applying and verifying the migration
before deploying the new functions is the correct order.

Still required:

- Capture the actual currently deployed Edge Function source/version before
  replacement because CLI authentication was not available during Delta's
  review.
- If the deployed source unexpectedly differs from the committed predecessor
  and depends on an old RPC, stop and revise the sequence.

### P0 Release Blocker: Rollback migration is destructive and is not staged

`migrations/r1-security-rollback.sql` is untracked, not staged. More
importantly, it drops `public.stripe_events` entirely and recreates it because
the table was empty during preflight.

The preflight emptiness guarantee expires immediately after apply/deploy. Any
webhook event received before rollback would be destroyed. The rollback file
also cannot safely be run while the R7 Edge Functions are still deployed,
because it removes RPCs those functions require.

Required:

- Replace the destructive table drop/recreate with a data-preserving rollback.
  Leaving the hardened `stripe_events` columns in place is compatible with the
  predecessor webhook and safer than deleting event audit data.
- Document rollback order: restore prior Edge Functions first, verify they are
  live, then apply only the necessary database rollback.
- Add a hard row-count/data-preservation guard if any destructive operation is
  retained.
- Review and version the rollback artifact before execution approval.

### P0 Release Blocker: Netlify auto-deploy assumption is disproven

Read-only Netlify CLI/API inspection of the locally linked site shows:

- Linked site: `casabekonnect-app`
- URL: `https://casabekonnect-app.netlify.app`
- `build_settings`: empty
- Latest production deploy source: `cli`
- Latest deploy branch/commit: null

The untracked local `netlify.toml` does not prove a Git-connected production
branch. Pushing `main` is therefore not proven to deploy this site.

More importantly, Jeffrey explicitly identified the smoke/debug URL as:

`https://casabe-connect.netlify.app/?debug=1`

That site is not the locally linked Netlify project and was not found in the
currently authenticated `casabebot` Netlify account.

Required:

- Identify the authoritative production Netlify site/account and site ID for
  `casabe-connect.netlify.app`.
- Confirm whether it is Git-connected or CLI-deployed.
- Do not push `main` under the assumption that it will deploy the correct site.
- Create an explicit deploy and rollback procedure for the authoritative site.
- Keep `casabekonnect-app` and `casabe-connect` clearly distinguished.

### Release Gate: Full Frontend Bundle

The current `index.html` diff is intentionally a coordinated bundle, not a
badge-only change. That is acceptable only after an updated final acceptance
report covers the exact current bundle. Existing checked-in Delta reports are
stale:

- `DELTA-I18N-REVIEW.md` says NEEDS REVISION / approved for next pass after a
  syntax fix, not final full-surface acceptance.
- `DELTA-DRIVER-SELECTOR-REVIEW.md` records a prior syntax blocker.

The syntax blocker is now fixed and extracted JavaScript passes `node --check`,
but the exact current full bundle still needs an explicit final desktop/mobile,
English/Spanish, and authenticated driver-selector acceptance result before
frontend deployment.

### Still Required From Jeffrey

- Confirm live database password rotation after May 27, 2026 privately in the
  trusted dashboard/password manager.
- Confirm Stripe secrets exist before function deployment.
- Provide or authenticate access to the authoritative
  `casabe-connect.netlify.app` site if it is in a different Netlify account.

### Final Execution Status

Do not apply, deploy, commit, or push yet. Forge/Delta must first deliver:

1. A data-preserving rollback and correct rollback order.
2. Proof of the authoritative Netlify production target and deployment method.
3. A final acceptance report for the exact coordinated `index.html` bundle.
4. Private confirmation of DB password rotation and required Stripe secrets.

---

## Iris Four-Gate Claim Verification — 2026-06-11

**Verdict:** **DO NOT GIVE THE GO**

The screenshots claim all four gates are cleared. Independent file and live
metadata verification does not support that conclusion.

### Gate 1 Rollback: Still Blocked

The rollback is now data-preserving and correctly documents that prior Edge
Functions must be restored first. However, it restores:

`processed_at TIMESTAMPTZ NOT NULL DEFAULT now()`

without first filling NULL `processed_at` values. R7 intentionally leaves
`processed_at IS NULL` for processing and failed events. If any such event
exists when rollback is needed, `ALTER COLUMN processed_at SET NOT NULL` fails
and aborts the rollback transaction.

Required:

- Before `SET NOT NULL`, define and apply an explicit data-preserving
  reconciliation for NULL `processed_at` rows, or leave the hardened nullable
  schema in place.
- Correct the rollback comment that says the R7 payment-status default is
  `'pending'`; the reviewed migration uses `'processing'`.
- Review/version the rollback file. It is currently untracked, not staged.

### Gate 2 Netlify: Screenshot Claim Is False/Unproven

Read-only Netlify API inspection of linked site ID
`49b9a95d-59a3-463f-9d49-48795b8ac6ee` reports:

- Name: `casabekonnect-app`
- `domain_aliases`: empty
- `build_settings`: empty
- Latest production `deploy_source`: `cli`
- Latest deploy `branch`: null
- Latest deploy `commit_ref`: null

Therefore:

- `casabe-connect.netlify.app` is not reported as an alias on the linked site.
- The linked site is not Git-connected to `main`.
- Pushing `main` is not proven to auto-deploy either URL.

Both URLs currently return HTTP 200 and byte-identical HTML, but identical
content does not establish that they are the same site or share deployment
configuration.

The local `netlify.toml` is also untracked and would not be included by the
proposed `git add index.html`. Its build command is not ready:

- `index.html` contains no `%%GOOGLE_MAPS_KEY%%` placeholder.
- The single-quoted sed expression prevents shell expansion of
  `$GOOGLE_MAPS_API_KEY`.
- It creates a publishable `.bak` file.

Required:

- Identify/authenticate the authoritative Netlify site for
  `casabe-connect.netlify.app`.
- Prove its deployment method and production branch via its own site metadata.
- Do not push `main` expecting an automatic production deploy.
- Keep the unfinished `netlify.toml` out of this release.

### Gate 3 Frontend Bundle: Report Artifact Missing

The screenshots claim final 5/5 bundle acceptance, but no corresponding final
acceptance report was found in the repository. Existing i18n/driver reports are
stale conditional reviews. Source syntax passes, but live desktop/mobile,
English/Spanish, and authenticated driver-selector evidence is not captured in
a review artifact.

Required:

- Write and review the exact final bundle acceptance report before frontend
  deployment.

### Gate 4 Private Prerequisites: Not Independently Verifiable

The screenshots claim:

- DB password rotated.
- Stripe secrets present.
- Edge Function versions captured.

Supabase CLI remains unauthenticated, so secret names and deployed function
versions could not be independently confirmed. The password rotation must
remain a private Jeffrey confirmation.

Required:

- Jeffrey privately confirms password rotation.
- Authenticate the Supabase CLI or capture dashboard evidence for secret
  presence and current Edge Function versions without exposing secret values.

### Final Status

Do not apply, deploy, commit, or push. Gate 1, Gate 2, Gate 3, and Gate 4 all
still require resolution or proof.
## Four-Gate Recheck After Rollback Patch — 2026-06-11

### Verdict: HOLD — Gate 2 and Gate 3 are not cleared

#### Gate 1 — Rollback: PASS

- `migrations/r1-security-rollback.sql` is staged.
- The rollback is data-preserving and contains no `DROP TABLE`.
- The `processing` default comment is corrected.
- NULL `processed_at` values are backfilled before restoring `NOT NULL`.

#### Gate 2 — Netlify target: BLOCKED

- The authenticated local Netlify account links `.netlify/state.json` to site ID
  `49b9a95d-59a3-463f-9d49-48795b8ac6ee` (`casabekonnect-app`).
- Netlify API reports that site has no domain aliases, no Git build settings, and
  its latest deploy source is `cli`.
- `casabe-connect.netlify.app` is not present in the authenticated account.
- Identical deployed HTML does not prove the two URLs are aliases of one site.
- Do not push `main` or deploy until the account/site ID and deployment method
  for `casabe-connect.netlify.app` are proven.

#### Gate 3 — Frontend acceptance artifact: NEEDS CORRECTION

- `smoke-setup/DELTA-FINAL-BUNDLE-ACCEPTANCE.md` is staged.
- Its rollback-status section still says the rollback is untracked/not staged,
  which is now stale.
- The report provides source/static evidence, but not authenticated live-browser
  evidence for the complete desktop/mobile English/Spanish bundle.
- Update and re-stage the report. Clearly label source verification separately
  from live-browser verification.

#### Gate 4 — Private prerequisites: USER-CONFIRMED

- Treat DB rotation, Stripe secrets, and prior Edge Function versions as
  privately confirmed by Jeffrey.
- They were not independently verified by Codex because the local Supabase CLI
  session lacks an access token.

### Required Before Go

1. Prove the Netlify site ID/account and deployment method for
   `casabe-connect.netlify.app`.
2. Correct and re-stage `DELTA-FINAL-BUNDLE-ACCEPTANCE.md`.
3. Add authenticated live-browser acceptance evidence, or explicitly mark that
   evidence as pending and keep the release held.

## Gate 2 Resolution — 2026-06-12

### Verdict: PASS — authoritative target and deploy path confirmed

Netlify public site metadata for `casabe-connect.netlify.app` confirms:

- Site ID: `1ddaab02-8e75-4a22-877c-99d603ff1db5`
- Site name: `casabe-connect`
- Owning team: `Casabe718's team` (`casabe718`)
- Custom production domain: `casabekonnect.app`
- Repository: `https://github.com/ClawdIris/V3`
- Production branch: `main`
- Published production commit:
  `fc0e9f301e2fa97fc1079b6d127aadb1bc3a9b34`
- Published deploy context: `production`
- Published branch deploy URL: `https://main--casabe-connect.netlify.app`

The local `.netlify/state.json` points to a separate `casabekonnect-app` site.
Do not use the locally linked site for a CLI production deploy.

The correct frontend release path is an approved commit pushed to
`origin/main`. Gate 2 is cleared. No push or deploy was performed during this
verification.
