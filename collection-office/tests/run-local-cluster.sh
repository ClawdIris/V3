#!/usr/bin/env bash
# collection-office/tests/run-local-cluster.sh
# Initialises a FRESH, DISPOSABLE PostgreSQL cluster in a private directory,
# Unix socket only (listen_addresses=''), explicit port name, synthetic data;
# applies the corrected C1/C2 candidates; runs the restricted-role hostile
# suite and the two-session concurrency checks; inspects audit via a second
# connection; stops ONLY this cluster. Never touches any other instance.
set -euo pipefail
export LC_ALL=C LANG=C   # macOS: avoids "postmaster became multithreaded during startup"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CO="$REPO/collection-office"
DATA_ROOT="${CC_DATA_ROOT:?set CC_DATA_ROOT to a private temp dir}"
PORT="${CC_PORT:-54329}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PGDATA="$DATA_ROOT/ccpg-$STAMP"
SOCK="$(mktemp -d /tmp/ccsock.XXXXXX)"        # short path: unix sockets cap ~104 chars
EVID="$CO/tests/evidence/$STAMP"; mkdir -p "$EVID"
PGBIN=/opt/homebrew/bin
export PSQL="$PGBIN/psql -v ON_ERROR_STOP=1 -h $SOCK -p $PORT -U ccadmin -d ccreview"

cleanup() {
  set +e
  echo "── stopping the disposable cluster (only this one) ──" | tee -a "$EVID/run.log"
  "$PGBIN/pg_ctl" -D "$PGDATA" -m fast -w stop >> "$EVID/run.log" 2>&1
  "$PGBIN/pg_ctl" -D "$PGDATA" status >> "$EVID/run.log" 2>&1 || echo "cluster stopped (status: not running)" >> "$EVID/run.log"
  cp "$PGDATA/server.log" "$EVID/server.log" 2>/dev/null
  rm -rf "$SOCK"
  echo "PGDATA left at: $PGDATA (disposable, session temp)" >> "$EVID/run.log"
}
trap cleanup EXIT

{
echo "DISPOSABLE LOCAL CLUSTER — collection-office C1/C2 local proofs — $STAMP"
echo "PGDATA=$PGDATA  socket=$SOCK  port=$PORT  (no TCP)"
[ -e "/tmp/.s.PGSQL.$PORT" ] && { echo "REFUSING: /tmp/.s.PGSQL.$PORT exists (another instance uses this port name)"; exit 2; }
"$PGBIN/initdb" -D "$PGDATA" -U ccadmin --auth=trust --no-locale -E UTF8 > "$EVID/initdb.log" 2>&1
echo "initdb ok: $("$PGBIN/postgres" --version)"
"$PGBIN/pg_ctl" -D "$PGDATA" -w -l "$PGDATA/server.log" \
  -o "-c listen_addresses='' -c unix_socket_directories='$SOCK' -c port=$PORT" start
"$PGBIN/psql" -h "$SOCK" -p "$PORT" -U ccadmin -d postgres -qc "CREATE DATABASE ccreview"
echo "listen_addresses: $($PSQL -qAt -c "SHOW listen_addresses")  (empty = no TCP)"
echo
echo "── base schema + fixtures ──";                 $PSQL -q -f "$CO/tests/00_base.sql"
echo "── apply C1 candidate ──";                    $PSQL -q -f "$CO/01_collection_grants.CANDIDATE.sql"
echo "── apply C2 candidate ──";                    $PSQL -q -f "$CO/02_collection_contacts.CANDIDATE.sql"
echo "sha256 of applied files:"; shasum -a 256 "$CO/01_collection_grants.CANDIDATE.sql" "$CO/02_collection_contacts.CANDIDATE.sql" "$CO/tests/00_base.sql" "$CO/tests/10_hostile.sql" "$CO/tests/20_concurrency.sh"
echo
echo "── hostile suite (SET LOCAL ROLE authenticated / anon) ──"
$PSQL -f "$CO/tests/10_hostile.sql" 2>&1 | grep -oE "(PASS|FAIL)  .*|ERROR:.*" | sed 's/^/  /'
echo
echo "── second connection: committed audit inspection ──"
$PSQL -qAt -c "SELECT outcome||'/'||COALESCE(reason,'-')||' = '||count(*) FROM public.collection_grant_audit GROUP BY outcome, reason ORDER BY 1" | sed 's/^/   audit /'
$PSQL -qAt -c "SELECT public.__ck('S1 second connection sees committed refusal audit rows', (SELECT count(*) FROM public.collection_grant_audit WHERE outcome='refused') >= 8, 'n='||(SELECT count(*) FROM public.collection_grant_audit WHERE outcome='refused'))" 2>&1 | grep -oE "(PASS|FAIL)  .*" | sed 's/^/  /'
$PSQL -qAt -c "SELECT public.__ck('S2 second connection: no audit row carries a foreign/unknown office or member id', (SELECT count(*) FROM public.collection_grant_audit a WHERE (a.collection_office_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.partners p WHERE p.id=a.collection_office_id AND p.tenant_id=a.tenant_id)) OR (a.member_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.members m WHERE m.user_id=a.member_user_id AND m.tenant_id=a.tenant_id)))=0)" 2>&1 | grep -oE "(PASS|FAIL)  .*" | sed 's/^/  /'
echo
echo "── concurrency: two real sessions ──"
bash "$CO/tests/20_concurrency.sh" "$EVID/conc"
A=$(grep -c '"changed": true'  "$EVID/conc/cc1_a.txt" || true); B=$(grep -c '"changed": false' "$EVID/conc/cc1_b.txt" || true)
$PSQL -qAt -c "SELECT public.__ck('CC1 concurrent regrant: session A changed:true, session B (blocked, then) changed:false', $A=1 AND $B=1, 'a='||$A||' b='||$B)" 2>&1 | grep -oE "(PASS|FAIL)  .*" | sed 's/^/  /'
$PSQL -qAt -c "SELECT public.__ck('CC1b exactly ONE active manage grant row exists', (SELECT count(*) FROM public.collection_contact_grants WHERE action='manage' AND collection_office_id='aaaaaaaa-0000-4000-a000-00000000000a' AND member_user_id='00000000-0000-4000-a000-00000000bbb1' AND revoked_at IS NULL)=1)" 2>&1 | grep -oE "(PASS|FAIL)  .*" | sed 's/^/  /'
A=$(grep -c '"replayed": false' "$EVID/conc/cc2_a.txt" || true); B=$(grep -c '"replayed": true' "$EVID/conc/cc2_b.txt" || true)
$PSQL -qAt -c "SELECT public.__ck('CC2 concurrent same-key import: A imported, B blocked on the claim then replayed', $A=1 AND $B=1, 'a='||$A||' b='||$B)" 2>&1 | grep -oE "(PASS|FAIL)  .*" | sed 's/^/  /'
$PSQL -qAt -c "SELECT public.__ck('CC2b the two rows exist exactly once', (SELECT count(*) FROM public.address_book WHERE name IN ('Conc One','Conc Two'))=2)" 2>&1 | grep -oE "(PASS|FAIL)  .*" | sed 's/^/  /'
B=$(grep -c 'replay_conflict' "$EVID/conc/cc3_b.txt" || true)
$PSQL -qAt -c "SELECT public.__ck('CC3 concurrent same-key DIFFERENT payload: B gets replay_conflict', $B=1, 'b='||$B)" 2>&1 | grep -oE "(PASS|FAIL)  .*" | sed 's/^/  /'
$PSQL -qAt -c "SELECT public.__ck('CC3b only Payload A landed', (SELECT count(*) FROM public.address_book WHERE name='Payload A')=1 AND (SELECT count(*) FROM public.address_book WHERE name='Payload B')=0)" 2>&1 | grep -oE "(PASS|FAIL)  .*" | sed 's/^/  /'
echo
echo "── rollback scripts apply cleanly (then re-verified absent) ──"
$PSQL -q -f "$CO/rollback/02_collection_contacts_rollback.sql" && $PSQL -q -f "$CO/rollback/01_collection_grants_rollback.sql" && echo "rollbacks: OK"
$PSQL -qAt -c "SELECT 'functions remaining: '||count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'collection_%'"
echo
echo "════════════════ TALLY ════════════════"
$PSQL -qAt -c "SELECT 'checks='||count(*)||' pass='||count(*) FILTER (WHERE pass)||' fail='||count(*) FILTER (WHERE NOT pass) FROM public.__ck_results"
$PSQL -qAt -c "SELECT 'FAILED: '||name||' -> '||COALESCE(detail,'') FROM public.__ck_results WHERE NOT pass"
$PSQL -qAt -c "COPY (SELECT n, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END, name, COALESCE(detail,'') FROM public.__ck_results ORDER BY n) TO STDOUT" > "$EVID/ck_results.tsv"
} 2>&1 | tee "$EVID/run.log"
echo "evidence: $EVID"
