SQL-LOCK — deployed-SQL drift guard

NOTE ON THIS FILE'S EXTENSION: this runbook is .txt, not .md, because the
repo's .gitignore carries a repo-wide `*.md` rule (line 44). Markdown files are
silently skipped by `git add -A` and `git status` reports clean, so a .md
runbook would look committed while being absent from the tree. Narrowing that
rule is out of scope for this pack; if it is ever narrowed, this file can be
renamed back.

Counterpart to `scripts/verify-function-lock.sh`. That guard locks edge-function
SOURCE BYTES in the repo. This one locks DEPLOYED SQL BODIES in a database —
the layer that had no drift protection until now, and the layer that carries
the money and consent semantics.

## Files
  supabase/sql-artifacts/SQL-LOCK.json   the manifest
  scripts/verify-sql-lock.sh             the verifier (READ-ONLY)
  supabase/sql-artifacts/*.sql           the reviewed source-truth artifacts (R-2)

## Hash convention — read before touching anything
    raw_sha256 = encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')
with NO post-processing. This is the ONLY enforced value.

This matters because one unchanged function legitimately produces different
digests under different conventions. For `merge_stripe_payment_completed`:
    raw pg_get_functiondef         cbbaacc8...   <- ENFORCED
    rtrim(pg_get_functiondef,'\n') 4d8ee67e...   <- historical, F-C1 evidence chain
    inner $function$ body          e16623f3...   <- historical
All three are correct readings of the same healthy function. Recording a bare
hash without naming its convention is what makes a checker false-fail. The
manifest records the historical values under `_notes` so the older F-C1
evidence stays readable, and the verifier ignores them.

## Usage
    SQL_LOCK_DB_URL='postgresql://...' scripts/verify-sql-lock.sh
    scripts/verify-sql-lock.sh --db-url 'postgresql://...'
Exit 0 = all locked functions match. Exit 1 = BLOCKED, with a line per failure.

Run it before any SQL apply that touches a locked function, and after, to prove
the applied body is the reviewed one.

## Safety
Strictly read-only. It issues one SELECT inside a session with
`default_transaction_read_only = on`, creates/replaces/alters nothing, and never
uses the service_role key. A connection with plain SELECT on catalogs and
`information_schema` is sufficient.

## What it checks, per entry
  function exists at schema + proname + argtypes   -> else NOT FOUND
  identity arguments match                         -> else signature mismatch
  return type matches
  raw pg_get_functiondef sha256 matches            -> the primary pin
  volatility, security_definer, proconfig match
  EXECUTE grantees match exactly

Grants are enforced because a body can be correct while its exposure is not.
`get_public_payment_receipt` is intentionally callable by anon (it is the public
receipt surface); `merge_stripe_payment_completed` is intentionally NOT — only
postgres and service_role. A drift in either direction is a finding.

## Adding an entry
1. Land the reviewed artifact under supabase/sql-artifacts/.
2. Capture the live identity on BOTH projects:
     SELECT pg_get_function_identity_arguments(p.oid),
            array_to_string(p.proargtypes::regtype[], ','),
            pg_catalog.pg_get_function_result(p.oid),
            p.provolatile, p.prosecdef, array_to_string(p.proconfig,','),
            encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='<name>';
3. Add the entry in the SAME reviewed commit that changes the artifact, with the
   new hash in the commit message. Never update the manifest to match a database
   you have not reviewed — that converts a drift alarm into a rubber stamp.

## Negative test method
Copy the manifest, corrupt one field, and confirm the verifier blocks. Proven
against production on 2026-09-02 with four corruptions:
  tampered hash        -> BLOCKED on raw sha256 mismatch
  tampered signature   -> BLOCKED on signature mismatch
  wrong argtypes       -> BLOCKED as NOT FOUND
  rtrim hash as a pin  -> BLOCKED (the exact false-pin this convention prevents)

## Scope and limits
Initial coverage is the two R-2 artifacts. Extend deliberately; every entry
needs a matching artifact file. The verifier proves a body is what was
reviewed — it does not prove the body is correct, and it does not cover RLS
policies, which remain guarded by their own per-lane verify scripts.
