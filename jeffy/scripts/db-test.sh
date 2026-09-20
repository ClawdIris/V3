#!/usr/bin/env bash
# Boot a throwaway Postgres, apply every migration, run the SQL test suite.
#
#   ./scripts/db-test.sh            # migrations + tests
#   ./scripts/db-test.sh --keep     # leave the cluster running for poking at
#
# Needs postgresql-16 server binaries locally. It never touches a real project.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGPORT="${PGPORT:-54329}"
RUNDIR="${RUNDIR:-/tmp/jeffy-pgtest}"
PGDATA="$RUNDIR/data"
DBNAME=jeffy_test
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

# Postgres refuses to run as root, so the cluster runs as an unprivileged user.
RUNAS="${PGTEST_USER:-pgtest}"
as_pg() { if [[ "$(id -u)" -eq 0 ]]; then su "$RUNAS" -c "$1"; else bash -c "$1"; fi; }

cleanup() {
  if [[ $KEEP -eq 0 ]]; then
    as_pg "$PGBIN/pg_ctl -D $PGDATA -m immediate stop" >/dev/null 2>&1 || true
    rm -rf "$RUNDIR"
  fi
}
trap cleanup EXIT

rm -rf "$RUNDIR"; mkdir -p "$RUNDIR"
if [[ "$(id -u)" -eq 0 ]]; then chown -R "$RUNAS" "$RUNDIR"; fi

echo "==> initdb"
as_pg "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust -E UTF8" >/dev/null

echo "==> start postgres on :$PGPORT"
as_pg "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k $RUNDIR -c listen_addresses=' -l $RUNDIR/pg.log -w start" >/dev/null

export PGHOST="$RUNDIR" PGPORT PGUSER=postgres
psql -qX -c "create database $DBNAME" postgres >/dev/null
export PGDATABASE="$DBNAME"

run_sql() {
  # ON_ERROR_STOP so a failed statement fails the script, not just the file.
  psql -qX -v ON_ERROR_STOP=1 -f "$1"
}

echo "==> bootstrap (Supabase stubs)"
run_sql "$HERE/supabase/test/00_bootstrap.sql"

echo "==> migrations"
for f in "$HERE"/supabase/migrations/*.sql; do
  echo "    $(basename "$f")"
  run_sql "$f"
done

if [[ -d "$HERE/supabase/test" ]]; then
  shopt -s nullglob
  tests=("$HERE"/supabase/test/[1-9]*_*.sql)
  if [[ ${#tests[@]} -gt 0 ]]; then
    echo "==> tests"
    for f in "${tests[@]}"; do
      echo "    $(basename "$f")"
      run_sql "$f"
    done
  fi
fi

echo "==> OK"
if [[ $KEEP -eq 1 ]]; then
  echo "cluster kept: psql -h $RUNDIR -p $PGPORT -U postgres $DBNAME"
  echo "stop with:    $PGBIN/pg_ctl -D $PGDATA stop"
fi
