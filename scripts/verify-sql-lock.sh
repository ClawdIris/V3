#!/usr/bin/env bash
# SQL deploy guard (SQL-LOCK, R-2 follow-up): refuse to proceed when a deployed
# SQL function body drifts from the ratified hash in SQL-LOCK.json.
#
# Counterpart to scripts/verify-function-lock.sh, which locks edge-function
# SOURCE BYTES in the repo. This one locks DEPLOYED SQL BODIES in a database —
# the layer that had no drift protection until now.
#
# STRICTLY READ-ONLY. It issues one SELECT inside a read-only transaction and
# creates, replaces, or alters nothing. It never uses the service_role key.
#
# Usage:
#   SQL_LOCK_DB_URL='postgresql://...' scripts/verify-sql-lock.sh
#   scripts/verify-sql-lock.sh --db-url 'postgresql://...'
# Exit 0 = every locked function matches. Exit 1 = BLOCKED.
set -euo pipefail

LOCK="supabase/sql-artifacts/SQL-LOCK.json"
DB_URL="${SQL_LOCK_DB_URL:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --db-url) DB_URL="${2:-}"; shift 2 ;;
    --lock)   LOCK="${2:-}";   shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -f "$LOCK" ] || { echo "BLOCKED: lock manifest not found at $LOCK" >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "BLOCKED: psql not on PATH" >&2; exit 1; }
[ -n "$DB_URL" ] || { echo "BLOCKED: no database URL. Set SQL_LOCK_DB_URL or pass --db-url." >&2; exit 1; }

# Build the probe from the manifest. Read-only enforced at session level so a
# malformed manifest can never turn this into a write.
QUERY=$(python3 - "$LOCK" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
rows = []
for f in m["functions"]:
    rows.append("(" + ",".join(
        "$q$" + str(v) + "$q$" for v in [
            f["key"], f["schema"], f["proname"], f["argtypes"],
            f["identity_arguments"], f["returns"], f["volatility"],
            "true" if f["security_definer"] else "false",
            f["proconfig"], f["execute_grantees"], f["raw_sha256"],
        ]) + ")")
print("SET default_transaction_read_only = on;")
print("""
WITH expected(key, sch, proname, argtypes, ident_args, ret, vol, secdef, cfg, grants, raw_sha) AS (
  VALUES """ + ",\n         ".join(rows) + """
), actual AS (
  SELECT e.*,
         p.oid AS found_oid,
         pg_get_function_identity_arguments(p.oid)      AS a_ident,
         array_to_string(p.proargtypes::regtype[], ',') AS a_argtypes,
         pg_catalog.pg_get_function_result(p.oid)       AS a_ret,
         p.provolatile::text                            AS a_vol,
         p.prosecdef::text                              AS a_secdef,
         coalesce(array_to_string(p.proconfig, ','), '') AS a_cfg,
         coalesce((SELECT string_agg(DISTINCT rp.grantee, ',' ORDER BY rp.grantee)
                     FROM information_schema.routine_privileges rp
                    WHERE rp.routine_schema = e.sch AND rp.routine_name = e.proname
                      AND rp.privilege_type = 'EXECUTE'), '') AS a_grants,
         encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex') AS a_raw_sha
    FROM expected e
    LEFT JOIN pg_namespace n ON n.nspname = e.sch
    LEFT JOIN pg_proc p ON p.pronamespace = n.oid
                       AND p.proname = e.proname
                       AND array_to_string(p.proargtypes::regtype[], ',') = e.argtypes
)
SELECT CASE
  WHEN found_oid IS NULL
    THEN 'BLOCKED: ' || key || ' NOT FOUND in schema ' || sch
  WHEN a_ident IS DISTINCT FROM ident_args
    THEN 'BLOCKED: ' || key || ' signature is (' || a_ident || ') expected (' || ident_args || ')'
  WHEN a_ret IS DISTINCT FROM ret
    THEN 'BLOCKED: ' || key || ' returns ' || a_ret || ' expected ' || ret
  WHEN a_raw_sha IS DISTINCT FROM raw_sha
    THEN 'BLOCKED: ' || key || ' raw pg_get_functiondef sha256 ' || a_raw_sha || ' does not match lock ' || raw_sha
  WHEN a_vol IS DISTINCT FROM vol
    THEN 'BLOCKED: ' || key || ' volatility ' || a_vol || ' expected ' || vol
  WHEN a_secdef IS DISTINCT FROM secdef
    THEN 'BLOCKED: ' || key || ' security_definer ' || a_secdef || ' expected ' || secdef
  WHEN a_cfg IS DISTINCT FROM cfg
    THEN 'BLOCKED: ' || key || ' proconfig [' || a_cfg || '] expected [' || cfg || ']'
  WHEN a_grants IS DISTINCT FROM grants
    THEN 'BLOCKED: ' || key || ' EXECUTE grantees [' || a_grants || '] expected [' || grants || ']'
  ELSE 'OK: ' || key || ' matches lock (' || a_raw_sha || ')'
END AS line
FROM actual ORDER BY key;
""")
PY
)

OUT=$(printf '%s\n' "$QUERY" | psql "$DB_URL" -Atq -v ON_ERROR_STOP=1 2>&1) || {
  echo "BLOCKED: psql failed" >&2; printf '%s\n' "$OUT" >&2; exit 1; }

printf '%s\n' "$OUT"
if printf '%s\n' "$OUT" | grep -q '^BLOCKED:'; then exit 1; fi
exit 0
