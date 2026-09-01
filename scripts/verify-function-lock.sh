#!/usr/bin/env bash
# Deploy guard (TICKET-DEPLOY-RECONCILE): refuse any edge-function deploy when
# repo bytes do not match the ratified canonical hashes in FUNCTION-LOCK.json.
# Usage: scripts/verify-function-lock.sh  (run from repo root; exit 1 = BLOCKED)
set -euo pipefail
LOCK="supabase/functions/FUNCTION-LOCK.json"
fail=0
for fn in stripe-checkout sms-send payment-receipt stripe-webhook; do
  want=$(python3 -c "import json;print(json.load(open('$LOCK'))['$fn/index.ts'])")
  have=$(shasum -a 256 "supabase/functions/$fn/index.ts" 2>/dev/null | cut -d' ' -f1 || sha256sum "supabase/functions/$fn/index.ts" | cut -d' ' -f1)
  if [ "$want" != "$have" ]; then
    echo "BLOCKED: supabase/functions/$fn/index.ts sha256 $have does not match lock $want" >&2
    fail=1
  else
    echo "OK: $fn/index.ts matches lock ($have)"
  fi
done
exit $fail
