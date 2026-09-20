# C1 / C2 corrected candidates — grants, contacts, import. LOCAL ONLY.

File-only candidates in `collection-office/`, proven on a **fresh, disposable
local PostgreSQL cluster** that this session initialised, ran and stopped. This
is local synthetic testing within the current implementation scope. It is
**not** a staging or production GO, no candidate has been applied anywhere else,
and the original `.handoff/CAND` artifacts are intact (12/12 manifest OK).

## What ran, and where

* Cluster: `initdb` into the session scratchpad, `listen_addresses=''` (no TCP),
  Unix socket only in a private `mktemp -d` directory, port name 54329, trust
  auth on that private socket, synthetic data only. `postgres 16.14`.
* **The shared instance on `/tmp:5432` was not touched**: verified before and
  after — still up, same four databases (`escape postgres template0 template1`),
  its socket untouched. Only the cluster this session created was stopped
  (`pg_ctl -m fast stop`, status confirmed not running), and its socket
  directory removed. PGDATA is left in the session scratchpad.
* Evidence: `collection-office/tests/evidence/20260920T162055Z/` —
  `run.log` (full transcript with applied-file hashes), `ck_results.tsv`
  (every check, authoritative), `conc/` (raw output of each of the six
  concurrent sessions), `initdb.log`, `server.log`.
* Runner: `CC_DATA_ROOT=<private dir> bash collection-office/tests/run-local-cluster.sh`.

**Tally: 84 checks, 84 pass, 0 fail.** Rollback scripts were then applied and
verified to leave zero `collection_*` functions.

## Restricted-role proofs (Finding 0 closed)

Every functional check runs under `SET LOCAL ROLE authenticated` (or `anon`)
with `request.jwt.claims` set inside the transaction, so RLS, table `REVOKE`s
and function `EXECUTE` grants are in force — the candidate's own suite never did
this. Proven under those roles: `authenticated` cannot `INSERT` or `SELECT` the
grant table, cannot write the audit or the batch table, cannot execute
`ck_is_tenant_hq` / `ck_is_office_owner`; `anon` cannot execute the grant RPC;
the append-only audit trigger blocks `UPDATE`/`DELETE` even for the superuser.

## Finding → correction → check

| finding | correction | checks |
|---|---|---|
| 0 privileged suite | restricted-role suite, second-connection audit read | G14a–e, G15a–c, S1, S2 |
| C1-1 `member_id` was a user_id | column + param renamed `member_user_id`; membership resolved per call on the ACTIVE row | G19a–c, G8 |
| C1-2 audit pollution | validate before audit; unvalidated ids stored NULL; non-members of the tenant write no audit row in it | G5c, G6b, G6c, S2 |
| C1-3 no-op revoke audited as revoked | `changed:false`, outcome `no_op` | G10b, G10c |
| C1-4 revoke validated nothing | office-in-tenant + membership row required | G4c |
| C1-5 re-grant wiped revocation | partial unique index on the ACTIVE key; revoked rows preserved | G17a, G17b |
| C1-6 assignment implied any `p_need` | owner office keeps read **and manage on its own office** (intake preserved); any need outside `read`/`manage` is false for everyone; metrics is a separate helper reading a separate store | G20a–f, G16a, G16b, G12b |
| C1-7 `ok` shape | `{ success, changed, reason }` | G1, G2, G10a |
| C1-8 append-only claim | `BEFORE UPDATE OR DELETE` + `BEFORE TRUNCATE` triggers | G14d, G14e |
| C1-9 missing R1 cases | disabled member, duplicate membership, unknown/inactive/foreign office, concurrent regrant | G8, G18, G19a–c, G7, G7b, G6, CC1, CC1b |
| C1-10 codes revealed which id resolved | single `denied`; specific reason only in the audit row | G6, G7, G8b |
| C2-1 no payload hash | sha256 of canonical jsonb; same key+same payload replays, same key+different payload → `replay_conflict` | C2, C3, CC2, CC3 |
| C2-2 inert paging, null on offset | paging in a subquery; `total`; `p_search` added and LIKE-escaped | C9, C10, C10b |
| C2-3 partial row blanked name | only supplied fields are written; empty supplied name invalid | C7a–c, C6a |
| C2-4 no limits | rows 1..500, key ≤128, field limits; whole batch refused (atomic) | C5, C6a, C6b |
| C2-5 accidental concurrency | claim-first `INSERT … ON CONFLICT DO NOTHING`; blocked caller replays or conflicts, no exception path | CC2, CC2b, CC3, CC3b |
| C2-6 normalization unstated | stated in the file header; `ck_norm_phone` + expression index | C8 |
| C2-8 inactive contact modified | inactive external_ref match skipped and reported | C13a, C13b |
| C2-9 drop/add unique key | guarded, additive; CONCURRENTLY plan noted for any live target | applied cleanly |
| zero-ops | orders + tape_direct_records md5 before/after | C12 |

## Owner intake vs bypass — the distinction made

`ck_collection_contact_allowed(tenant, office, need)`:
1. `need` must be `read` or `manage`, otherwise **false for everyone** (the
   bypass that answered `admin`/`metrics` is closed);
2. caller must be an active member of the tenant and the office must be active
   in that tenant;
3. HQ → true;
4. **owning office** (active membership with `assigned_partner_id = office`) →
   true for read and manage **on that office only** — the legitimate
   contact-creation/import path, preserved and tested (G20a/b), with nothing on
   any other office (G20d);
5. otherwise an explicit active grant; manage implies read, read never implies
   manage.

Metrics has its own helper over its own table and reads no contact grant
(G16a/b, G20e/f).

## Declared decisions and residual gaps

* **`members.assigned_partner_id` does not appear in any local repo SQL.** It is
  the candidate's assumed owner-office link; the stand-in schema carries it so
  the rule is testable. Verifying the real column is a target-gate item.
* **Audit scoping:** refusals are audited under tenant T only for actors who are
  active members of T. A caller with no membership in T gets the generic denial
  and no audit row in T. Whether such probes belong in a separate global
  security log is a target-gate question, not decided here.
* **Phone normalization** keeps a leading `+` and digits; `+1 555…` and `555…`
  are different strings by that rule. Country-code inference is a product/i18n
  decision and is not made.
* **Address validation** is still not reused: imported rows land as
  `coordinate_status='missing'` with client coordinates ignored. Stated, not hidden.
* Stand-in schema, not production schema. Real column types, existing RLS on
  `members`/`partners`/`address_book`, and the `partners_id_tenant_uk` build on
  a live table (CONCURRENTLY) all remain target-gate work.
* R1's "normal commit with a second connection" is proven (S1); the O1 caveat
  stands — an outer rollback still takes the audit row with it.
* Unresolved product items unchanged: P1 grade bands, P3 dormancy, P4 campaign
  alerts, P6 snapshot precedence. Not invented.
