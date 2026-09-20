# C1 / C2 candidate review — grants, contacts, import. SOURCE REVIEW, LOCAL ONLY.

Reviewing `.handoff/CAND/sql/01_collection_grants.sql` (`3b0ba805…`) and
`02_collection_contacts.sql` (`58b4ac2a…`) against R1/R2 of
`PM-ACTING-REVIEWER-COLLECTION-v5-A2-20260920.md`. Candidates unchanged; this is
review, not a rewrite yet.

**Not executed.** These are read findings from the source. The candidate's own
`cct.sql` was not run: a local PostgreSQL is listening on `/tmp:5432`, but it is
the machine's own dev server, and creating even a disposable database on it is
not something this handoff explicitly authorized. Say the word and I will run
`ccbase.sql` + `cct.sql` in a throwaway database and drop it afterwards — the
scripts contain no `CREATE/DROP DATABASE`, `CREATE ROLE`, `dblink`, `COPY … FROM
PROGRAM`, `pg_read_file` or `\!`, so the side effects are confined to whatever
database they are pointed at. Note that `ccbase.sql` does
`CREATE SCHEMA IF NOT EXISTS auth` and creates `public.*` tables, so it must
never be pointed at an existing database.

## Finding 0 — the 17/17 proves less than it claims (both files)

`cct.sql` never issues `SET ROLE` / `SET LOCAL ROLE`. Every check runs as the
connecting owner/superuser, which **bypasses RLS entirely and ignores every
`REVOKE … FROM authenticated`** in both candidates. So the suite cannot have
proven any of R1's access requirements:

* that `authenticated` cannot write `collection_contact_grants` /
  `collection_grant_audit` / `collection_import_batches` directly;
* that RLS-enabled-with-no-policies actually denies;
* that `anon` is excluded;
* that `ck_is_tenant_hq` is not executable by `authenticated`.

Correction: every access assertion must run under `SET LOCAL ROLE authenticated`
(and `anon`) with `request.jwt.claims` set, and must assert the failure, not just
the happy path.

## C1 — grants / revoke / audit

**C1-1 `member_id` is actually a `user_id`. Contract-breaking ambiguity.**
`collection_contact_grant` refuses self-grant with `v_uid = p_member_id`, and
`ck_collection_contact_allowed` matches `g.member_id = v_uid` — so the column
named `member_id` must hold `members.user_id`. The C1 contract in
`COLLECTION-OFFICE-CONTRACTS-v5-AND-DRIVER-UI-1` specifies `p_member_id uuid`
against a `members` row. If a caller passes `members.id`, the grant row inserts
happily and then **never matches any check** — access silently granted to
nobody. R1 also requires validating actor and target against *current active
same-tenant membership*, and `members` can hold several rows per user
(duplicate/ reassigned memberships), which this design cannot express. Decide the
identity, name the column for it, and constrain it.

**C1-2 Unbounded audit pollution with attacker-chosen ids.** The refusal audit
row is written **before** any validation of `p_collection_office_id` or
`p_member_id`, and the `not_hq` refusal is audited too. So *any* authenticated
user can write unlimited `collection_grant_audit` rows naming arbitrary
foreign-tenant uuids. R1: "Audit bounds and caller scoping must prevent arbitrary
foreign-tenant audit pollution." Correction: validate scope before auditing,
audit refusals with the caller's own tenant only, null out unvalidated targets,
and bound the rate.

**C1-3 A no-op revoke is reported and audited as a revocation.**
`collection_contact_revoke` returns `ok:true` and inserts
`outcome='revoked'` even when `ROW_COUNT = 0`. The audit then records a
revocation that never happened. Correction: report `changed:false` and audit a
distinct `no_op` outcome — the same rule the driver work applied to
`changed === true`.

**C1-4 Revoke validates nothing but the role.** No office-in-tenant check, no
membership check. Combined with C1-2, an HQ of `t1` can write audit rows against
any office/member uuid in the world.

**C1-5 Re-grant destroys the revocation record.** The PK is
`(tenant_id, collection_office_id, member_id, action)` with `ON CONFLICT DO
UPDATE … revoked_by=NULL, revoked_at=NULL`. R1 requires "revocation recorded
rather than deleted"; here the next grant wipes it from the grants table. A
partial unique index on the *active* key plus a separate row (or a history table)
per grant/revoke cycle is needed.

**C1-6 Assignment silently implies `manage`.** `ck_collection_contact_allowed`
returns `true` for **any** `p_need` when the caller's
`members.assigned_partner_id = p_collection_office_id`. So an assigned
`partner_agent` gets `manage` — which C2 uses to authorize **import/overwrite** —
with no grant at all. The suite's "read grant does NOT imply manage" check never
exercises this path. This is the most consequential C1 defect.

**C1-7 Result shape differs from the accepted convention.** `ok` rather than
`success`, and no `changed`. The reviewed convention (and the driver work now in
this worktree) is `success === true` / `changed === true`. Align, or state why
this one differs.

**C1-8 "Append-only" is a claim, not a constraint.** Nothing prevents `UPDATE`
or `DELETE` on `collection_grant_audit` by the table owner or `service_role`; no
trigger, no revoke on those verbs for the definer's own role. R1 asked for
append-only "appropriately" — the claim needs a mechanism.

**C1-9 Missing R1 tests.** R1 names them explicitly: disabled members,
reassignment, duplicate memberships, unknown partner, cross-tenant
partner/member pairs, self/non-HQ grants, **concurrent regrant**. The candidate
covers self-grant, cross-tenant office, invalid action, non-HQ, read≠manage,
office isolation, revoke-bites-open-session and metrics separation. Disabled
member, duplicate membership, reassignment and concurrency are absent.

**C1-10 Refusal codes distinguish which id was valid.** `office_not_in_tenant`
vs `member_not_in_tenant` tells a caller which half of the pair resolved. R1
wants a stable **generic** denial code for the not-found family.

## C2 — contacts, identity, import

**C2-1 The replay key carries no payload hash — a changed replay is silently
swallowed.** R2 requires "idempotency records with payload hashes … A conflicting
replay must report conflict." `collection_import_batches` stores only
`(tenant, office, replay_key)` + result. A retry with the **same key and
different rows** returns the stored result and reports `replayed:true`: the new
content is neither imported nor reported. This is the headline R2 miss, and the
candidate README advertises exactly this table as the fix.

**C2-2 `p_limit` / `p_offset` are inert, and an offset returns null.**
`collection_contacts_list` aggregates with `jsonb_agg` and no `GROUP BY`, so the
query yields exactly one row and `LIMIT`/`OFFSET` apply to that aggregate row.
Every call returns **all** contacts for the office; `p_offset >= 1` returns zero
rows, leaving `v` NULL, so the response is `{"ok":true,"rows":null}`. The
contract's `p_search` parameter is missing entirely. Paging must be applied in a
subquery before aggregation.

**C2-3 A row without a name blanks an existing contact's name.**
`v_name := btrim(coalesce(r->>'name',''))` then `UPDATE … SET name = v_name`. A
row carrying only an `external_ref` overwrites the stored name with `''`
(`NOT NULL` does not stop it). R2: an update "must revalidate ownership and
preserve immutable office scope" and must not silently change content. Only
supplied fields may be written.

**C2-4 No row / request / field limits.** `p_rows` is unbounded and no field
length is capped. R2 requires these to be stated and enforced.

**C2-5 Concurrent retry behaviour is accidental, not defined.** Two concurrent
calls with the same replay key both miss the `SELECT`, both insert contacts, then
the loser hits the batch-table PK and **raises**, rolling its inserts back. It
happens to avoid duplication, but it returns an exception instead of a structured
conflict and depends on statement ordering. Claim the key first
(`INSERT … ON CONFLICT DO NOTHING`, or an advisory lock) and then do the work.

**C2-6 Phone normalization is stated nowhere and is inconsistent with storage.**
The ambiguity probe compares `regexp_replace(phone,'[^0-9+]','','g')` but the
row stores the **raw** `r->>'phone'`. Every future import re-normalizes on read
with no index (full scan per row, O(rows × contacts)), and `+` is preserved at
any position. R2 requires the normalization, absent/both-identifier handling and
source namespace to be stated explicitly.

**C2-7 Address validation is not reused; coordinates are dropped.**
`coordinate_status` is hardcoded `'missing'` and lat/lon are ignored. That
correctly refuses to trust client coordinates, but it also means no address
validation happens at all — R2 asked for real validation to be reused. State the
gap; network-based validation stays separately gated.

**C2-8 Deactivated contacts can be silently updated.** The `external_ref` match
ignores `is_active`, so an import can modify (and effectively resurrect) a
deactivated contact with no report.

**C2-9 Target-gate deployment hazard.** `ALTER TABLE public.partners DROP
CONSTRAINT IF EXISTS partners_id_tenant_uk` followed by `ADD CONSTRAINT …
UNIQUE (id, tenant_id)` takes `ACCESS EXCLUSIVE` and rebuilds the index; the
`DROP` also fails outright if any FK already references that unique key. Needs a
`CREATE UNIQUE INDEX CONCURRENTLY` + `ADD CONSTRAINT … USING INDEX` plan and a
pre-check, not a bare drop/add, before this is ever applied.

**C2-10 Positive R2 points, for the record.** No phone/email/name uniqueness and
no merge-on-phone: correct and matches R2. The composite FK
`(collection_office_id, tenant_id) → partners(id, tenant_id)` makes the
same-tenant invariant structural rather than checked: also correct. The
scoped partial unique index on `(tenant, office, external_ref)` is the right
shape for external identity.

## Next step

Rebuild C1/C2 as corrected file-only candidates addressing C1-1…C1-10 and
C2-1…C2-9, with a hostile suite that runs under `SET LOCAL ROLE authenticated`
and `anon`, adds the four missing R1 cases and a concurrent regrant, and covers
the replay-conflict, paging, partial-row and limit cases for C2. Product
decisions are **not** required for any of these: they are all technical
corrections. Unchanged unresolved product items stay as listed (P1 grade bands,
P3 dormancy, P4 campaign alerts, P6 snapshot precedence).
