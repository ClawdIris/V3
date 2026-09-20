#!/usr/bin/env bash
# Two real sessions against the disposable cluster. $PSQL is set by the runner.
set -u
HQ=00000000-0000-4000-a000-00000000aaa1; OWNA=00000000-0000-4000-a000-00000000ccc1
A=aaaaaaaa-0000-4000-a000-00000000000a; ST=00000000-0000-4000-a000-00000000bbb1
OUT="$1"; mkdir -p "$OUT"

# CC1 concurrent regrant: A holds its transaction open after granting.
$PSQL -qAt <<SQL > "$OUT/cc1_a.txt" 2>&1 &
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as('$HQ');
SELECT public.collection_contact_grant('t1','$A','$ST','manage');
SELECT pg_sleep(2); COMMIT;
SQL
sleep 0.6
$PSQL -qAt <<SQL > "$OUT/cc1_b.txt" 2>&1
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as('$HQ');
SELECT public.collection_contact_grant('t1','$A','$ST','manage');
COMMIT;
SQL
wait
# CC2 concurrent import, same key, same payload: A open, B blocks on the claim then replays.
ROWS='[{"name":"Conc One","phone":"555-000-0001"},{"name":"Conc Two"}]'
$PSQL -qAt <<SQL > "$OUT/cc2_a.txt" 2>&1 &
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as('$OWNA');
SELECT public.collection_contacts_import('t1','$A','conc-1','$ROWS'::jsonb);
SELECT pg_sleep(2); COMMIT;
SQL
sleep 0.6
$PSQL -qAt <<SQL > "$OUT/cc2_b.txt" 2>&1
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as('$OWNA');
SELECT public.collection_contacts_import('t1','$A','conc-1','$ROWS'::jsonb);
COMMIT;
SQL
wait
# CC3 concurrent import, same key, DIFFERENT payload: B must get replay_conflict.
$PSQL -qAt <<SQL > "$OUT/cc3_a.txt" 2>&1 &
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as('$OWNA');
SELECT public.collection_contacts_import('t1','$A','conc-2','[{"name":"Payload A"}]'::jsonb);
SELECT pg_sleep(2); COMMIT;
SQL
sleep 0.6
$PSQL -qAt <<SQL > "$OUT/cc3_b.txt" 2>&1
BEGIN; SET LOCAL ROLE authenticated; SELECT public.__as('$OWNA');
SELECT public.collection_contacts_import('t1','$A','conc-2','[{"name":"Payload B"}]'::jsonb);
COMMIT;
SQL
wait
