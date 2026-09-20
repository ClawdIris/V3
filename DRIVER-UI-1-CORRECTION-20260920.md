# DRIVER-UI-1 + ROUTE-HQ-1 — correction against the actual host. LOCAL ONLY, rev 4.

Worktree `/Users/joshua/casabe-collection-dev`, branch `codex/collection-office-local`,
base `7367d98`. Uncommitted, unpushed, not merged, no deploy, no flag change.
No staging/production call, no SQL applied, no credentials read, no account,
invite, Stripe, refund, Twilio, SMS or external message. Original
`/Users/joshua/casabe-v3` untouched. `.handoff/CAND` intact and re-verified this
session: `shasum -a 256 -c MANIFEST.sha256` → 12/12 OK.

Everything below is **local only**: local source, synthetic in-memory tests, no
target call of any kind. Rev 2 answered the six items of the first independent
review; rev 3 answered the two proof gaps of the second; rev 4 answers the
write-identity and tenant-capture gaps of the third. Evidence:
`DRIVER-UI-1-EVIDENCE-20260920.txt`.

## Executed results

| run | source under test | result |
|---|---|---|
| 1 | corrected worktree, all three suites | **97/97 pass** (55 driver + 24 host + 18 HQ) |
| 2 | driver suite vs `route-optimizer.js@HEAD` | 48 of 55 fail — defect reproduced |
| 3 | driver suite vs chat candidate `route-optimizer.PATCHED.js` | 48 of 55 fail |
| 4 | host suite vs `index.html@HEAD` | 17 of 24 fail |
| 5 | HQ suite vs `route-optimizer.js@HEAD` | 13 of 18 fail — HQ defect reproduced |
| 6 | candidate's own suite, as supplied | 18/18 pass, against a contract the host never returns |

`node --test tests/driver-ui-1-driver-ui.test.mjs tests/driver-ui-1-host-contract.test.mjs tests/route-hq-1-completion.test.mjs`

## Rev 4 item A — readable existence is not write confirmation

The rev 3 read-back fallback was wrong, exactly as flagged: a zero-row upsert
response followed by a scoped read of an **existing, unchanged** row was being
treated as `persisted:true`, so a suppressed write could still complete a stop
and credit a shift tally. `_db.upsertOrderReturning` now **fails closed on an
empty representation**: with `.select()` requested, zero rows means the write
did not land on a row this caller can see, and it resolves `null` with no
read-back at all. The only thing that could confirm identity across a separate
read is an explicit write/version identity on the row (a version column or a
server write token returned and compared); `orders` carries none today, and
none is invented here — that is a schema decision for the target gate.
`saveOrder` turns `null` into `not_confirmed` (rollback, no success UI, no
`confirmedRow`).

Tests revised, not just added: the two tests that endorsed the read-back are
gone. New: zero-row + existing-unchanged row ⇒ `null` **and** zero read-back
calls; any zero-row write ⇒ `null`; through the real `saveOrder`, a suppressed
`picked_up` over an existing row completes nothing and is rolled back.

## Rev 4 item B — tenant captured before the request

`upsertOrderReturning(id, data, tenantId)` captures the tenant **once at entry**
(explicitly passed by `saveOrder` from the session its closure holds) and uses
it for the row, the request and the identity check. The mutable `_db._tenantId`
is never consulted after the request starts. Tests: a pending request survives
`_db.init("T2")` mid-flight and the T1 row is still accepted for T1; after the
switch, a returned T2 row is rejected for the T1 call (`row_mismatch`); and a
call with no tenant at all is refused before any request is sent.

## Rev 3 item A — strict money parsing

`paidProofOf` used `parseFloat` with `|| 0`, which accepted a numeric prefix
(`"100oops"` → 100), `"Infinity"`, exponent notation and negative totals, and
turned every unreadable amount into a settled zero. Replaced by `strictAmount`,
at module scope so both surfaces share it. **Supported forms, exhaustively:** a
finite JS number ≥ 0, or a canonical decimal string matching
`/^\d+(\.\d{1,2})?$/` — no sign, no exponent, no whitespace, no thousands
separator, at most two decimals. Anything else is *unusable*, which is not the
same as zero, and every caller fails closed on it. A missing `paid` still reads
as 0; a *malformed* `paid` does not.

Sixteen table-driven regressions cover numeric prefix, `"Infinity"`, `Infinity`,
`NaN`, negative number, negative string, exponent, three decimals, leading
whitespace, thousands separator, currency symbol, empty string, `null`, boolean,
object and array — each asserted to withhold the receipt. Plus: a malformed
`paid` does not settle a zero-amount order, and canonical decimal *strings* are
still accepted.

## Rev 3 item B — the client payload is not a saved row

`writtenRow = updated` was the object the client sent. `_db.upsert` discarded its
response and `saveOrder` returned only booleans, so nothing in the old chain knew
what the database actually held. That is now impossible:

* **New `_db.upsertOrderReturning(id, data)`** upserts with `.select(...)`,
  asks for the server's own representation, and falls back to a **scoped
  read-back** (`.eq("id", …).eq("tenant_id", …).maybeSingle()`) when the upsert
  returns no representation. It rejects a row whose `id` or `tenant_id` does not
  match (`row_mismatch`), rejects a multi-row response (`ambiguous`), and
  resolves `null` when a zero-row write cannot be read back. **RLS is
  untouched** — it reads back only what the caller may already select, and it is
  a separate method so no other table's write gains a `.select()`.
* **`saveOrder`** uses it, treats a missing row as a failure
  (`reason: "not_confirmed"`, optimistic change rolled back, no success UI), and
  carries the server row as `confirmedRow`.
* **`completeStop`** takes its proof from `result.confirmedRow` (save path) or
  `result.order_data` (status path). `writtenRow` is gone.
* **`receiptFiguresFrom`** builds every receipt figure from the confirmed row and
  additionally requires the confirmed increase in `paid` to equal what the action
  asked to record. A trigger-adjusted, concurrent or unexplained value withholds
  the receipt rather than printing a number nobody confirmed. The driver's
  *partial* balance message is now quoted from the confirmed row too, not from
  local subtraction.

Nine tests execute the **real `_db`** object literal from `index.html` against a
stub PostgREST chain: server representation used, scoped read-back on a zero-row
write (asserting the `id`+`tenant_id` filters), `null` when unreadable, rejection
for a wrong id, a wrong tenant and a multi-row response, and a denied write
propagated. Plus driver/HQ tests for a server-adjusted amount, a persisted write
with no confirmed row, an over-credit, and a settlement this action did not cause.

**Residual limitation, declared:** on the status path `order_data` is the row the
RPC computed and wrote, not a post-write re-read, so a trigger firing after that
`UPDATE` would not be reflected. Changing that means changing the RPC, which is
an unapplied file-only draft and a target-gated question — not fixed here.

## Review item 1 — a completed status is not proof of payment

`alreadyPaid` stays reachable with a balance outstanding (a customer really can
have paid outside the app), but it can no longer *assert* payment. A paid receipt
now requires **authoritative numbers from the confirmed row**:

* status path — the payment on `order_data`, the committed row the RPC returns;
* save path — the payment on the row `persisted:true` says landed.

`paidProofOf()` computes `amount − paid` and requires `≤ 0`. A status label is
never accepted as evidence; a missing or non-numeric `amount`, or a payload with
no `order_data`, **fails closed**. When the proof is absent the stop is still
confirmed as a pickup and the outstanding figure is reported instead:
*"✅ Ana Diaz — picked up. The saved order still shows $100 outstanding — NO paid
receipt was sent."*

Regressions added: unpaid order + successful status change → no receipt, balance
reported; partially paid ($60 of $100) → no receipt, $40 reported; success with
no `order_data` → fails closed; and the narrow positive case where the server's
own numbers say settled even though the stale local row does not → receipt
issued (the server, not the client, is the authority).

## Review item 2 — `saveOrder` now fails closed with no session

The no-session branch previously ran the whole success path against a resolved
no-op promise: optimistic `setOrders`, form close, `setNewOrderConfirm` /
"✓ Order updated". It returned `persisted:false` *after* telling the user it had
saved. It now refuses at the top of the function before any mutation, and the
test asserts the **UI effects**, not just the return value: no upsert, no
`setOrders`, no `setShipments`, no form close, no confirmation, no success
notification, and a visible refusal. A companion test pins that the guard is
narrow — with a session the normal success UI still runs.

## Review item 3 — a blocked popup is not a sent receipt

`window.open` after an `await` is routinely popup-blocked and returns `null`.
Both surfaces now check the handle and never claim delivery on `null`:

* **Driver:** the receipt is parked and a page-level banner offers
  **🧾 Send receipt**, which re-opens the same URL from a real user gesture.
  Rendered at page level on purpose — a completed stop leaves the route list as
  soon as its new status arrives, and a test asserts the action survives that.
  Still blocked on retry → stays parked, "allow pop-ups, then tap again".
* **HQ:** `RO.pendingReceipt` + `RO.sendPendingReceipt()`, offered as a button in
  the toast; a toast carrying an action no longer auto-dismisses after 9s.

The completion itself is still reported as saved in both cases — only the receipt
claim is withheld. Six regressions cover blocked, retry-succeeds, retry-blocked,
survives-unmount, and the collect path.

## Review item 4 — no "reviewed/authorized" wording on the onSave path

All such wording is gone from source and tests. `confirmCollect` now reads:
the payment call "keeps the pre-existing `props.onSave` path exactly as it was.
That path is **PRESERVED, NOT endorsed**: no authorized driver
payment-collection contract has been demonstrated for it, and the local SQL
sources create no driver UPDATE policy on `orders`, so a real driver payment
upsert is expected to be refused." One test title was reworded the same way.

## Review item 5 — ROUTE-HQ-1, the `completeWrite` sibling

`route-optimizer.js:1391` `completeWrite` (HQ `RouteOptimizerPage`, reached from
`RO.completePickup` / `RO.completeDrop`, which the rendered buttons call by
`onclick`) had the identical defect: `try { save(updated); return true; }`
reported success on invocation. Downstream, unconditionally: the stop was struck
off, **the shift cash tally `RO.session.completed` grew by the collected
amount**, and a WhatsApp receipt opened. A refused write inflated the driver's
cash reconciliation for money never recorded against the order.

Corrected the same way: `completeWrite` resolves `{ ok, … }`, positive only on
`success === true && persisted === true`; session credit, struck-off state,
modal close, `renderAll` and receipt are all downstream of it; a repeat submit
for the same stop is refused while a write is outstanding.

**No financial-policy widening:** `collected`, `owed`, `method`, the
receipt channel and the payload all come from the same form fields and reach the
same writer with the same values. A test pins that (`paid 25 + collected 40 = 65`,
`owed 35`) and another pins that the existing incomplete-form guard still
refuses before any write. 13 tests, driven through the real `RO.*` entry points
with the module's own `$("#id")` lookups against a stub DOM.

## Review item 6 — DRIVER-PAY-1 file-only proposal

`driver-pay-1/01_driver_record_collection.PROPOSAL.sql` and
`driver-pay-1/rollback/01_driver_record_collection_rollback.sql`. Deliberately
**not** under `supabase/migrations/` so no runner can pick them up; the proposal
file ends in `ROLLBACK` so it cannot commit. Never applied, never executed, not
syntax-checked against a database.

It contains the authorization inventory (`current_tenant_id()`, `members`
active + role, `assignedDriverUserId` origin lane, the
`driver_update_order_status` grant shape it copies, `orders_driver_select`, the
absent driver UPDATE policy, and the service-role-only `merge_stripe_payment_*`
as the only existing payment writers); idempotency via
`UNIQUE (tenant_id, order_id, client_request_id)` plus a payload hash, so a
replay returns the stored result and a changed payload reports `request_id_conflict`;
an append-only audit that records refusals too, with the O1 caveat stated (the
audit row commits in the ordinary transaction — **not** an autonomous guarantee);
`FOR UPDATE` on the order to serialise concurrent taps; RLS-on-with-no-policies
plus `REVOKE` so no client role writes either table.

**DRIVER-PAY-1 remains a proposal and a target gate, not completed
functionality.** Nothing in it is built, applied or wired to any surface.
**No owner money semantics are invented.** It writes numbers only and leaves
seven decisions explicit: OPEN-D1 atomicity with the status change (recommended:
one transaction, which needs the transition validation refactored into a shared
internal function), D2 `payment.status` derivation (not written at all until
decided), D3 over-collection, D4 the per-collection ceiling (config-driven,
fails closed when missing, no literal invented), D5 currency and method
allow-list, D6 whether a driver collection feeds `commissionSnapshot`, D7
correction/void path. The tests such a contract would need are listed; none are
written and none are run.

## Declared behaviour changes

1. `saveOrder` with no tenant session now refuses outright. Session-less
   demo/dev mode no longer produces a local-only "saved" order.
2. "Already paid" on an order whose confirmed payment does not show a settled
   balance no longer sends a paid receipt — it confirms the pickup and reports
   the balance.
3. An order whose payment `amount` is missing or non-numeric no longer yields a
   paid receipt anywhere (previously `balanceOf` read it as $0 due).
4. HQ completion effects — shift cash credit, struck-off stop, modal close,
   receipt — now all require a persisted write.
5. An HQ toast carrying an action button no longer auto-dismisses.
6. Any receipt now requires a confirmed row whose payment increase matches what
   the action recorded. Orders the server cannot confirm — or confirms
   differently — get a completion confirmation and no receipt.
7. `alreadyPaid` / `boxDelivered` no longer write the local human history note or
   `boxDelivered`'s `stopCompletion`: the RPC rejects a `reason_note` on
   `picked_up` / `box_dropped_off`, and it records `ts`, `by`, `byUserId`,
   `byName` and per-box `statusUpdatedAt`/`By` server-side. `stopCompletion`
   has no reader anywhere in the repo. `confirmCollect` still writes its full
   `stopCompletion`.

## Changed / added files

* `route-optimizer.js` — module scope: `strictAmount`, `paidProofOf`,
  `receiptFiguresFrom`, `withheldReasonText`. `DriverRouteLite`: `completeStop`
  + all three callers, confirmed-row receipt gate, popup fallback, in-flight
  guard, pending-receipt banner.
  `RouteOptimizerPage`: `completeWrite`, `RO.completePickup`, `RO.completeDrop`,
  `toast` action parameter, `RO.sendPendingReceipt`.
* `index.html` — `saveOrder` only: fail-closed guard + explicit
  `{ success, changed, persisted, reason, error }` result. `changeStatus`
  untouched. Every pre-existing `saveOrder` caller ignores the resolved value.
* `tests/driver-ui-1-driver-ui.test.mjs` (55), `tests/driver-ui-1-host-contract.test.mjs` (24),
  `tests/route-hq-1-completion.test.mjs` (18), `tests/helpers/driver-ui-1-harness.mjs`.
* `driver-pay-1/` — proposal + rollback (file-only, unapplied).
* `DRIVER-UI-1-EVIDENCE-20260920.txt`.

`DRIVER_UI_1_RO` / `DRIVER_UI_1_HOST` re-point either suite at another copy of
either source, which is how runs 2–5 were produced.

## Still required — not claimed

* **LOCAL-MOCK only.** 97 tests prove control flow, the host result contract and
  the UI effects. They do not prove real persistence, RLS behaviour or a reload.
  `T-D1` (reload shows the new status), `T-D2` (real `42501` / transition
  rejection), `T-D4` (real double-tap idempotency), `T-D5` (unassigned driver
  refused) stay staged for an approved authenticated target run; `T-D6` remains
  blocked on the A2 transition.
* `20260818013434_p0_pack1_enforce_rpc_only.sql` remains a file-only draft.
  Applying it before DRIVER-PAY-1 exists makes the driver collect action fail
  closed at every stop.
* The repo's jest/playwright suites could not be executed: `node_modules` is
  empty and installing would need network access.
  `tests/p0-pack1-frontend.test.js` is string-grep based; the `index.html` edit
  only adds lines and removes no string it asserts — inspection, not execution.
* Unchanged from the review, still open: grants/contact candidates, import
  identity, metrics/commission, full dashboard, both order flows, day/dark,
  Access UI, delegated refunds. Product calls P1 grade bands, P3 dormancy
  threshold, P4 campaign alerts, P6 snapshot precedence are **not** invented.

Grants/contact corrections: see `COLLECTION-OFFICE-C1-C2-CORRECTION-20260920.md`.
