#!/bin/bash
cd ~/casabe-v3
ANON=$(grep -oE 'SUPABASE_ANON_KEY = "[^"]+"' index.html | grep -oE 'sb_publishable_[A-Za-z0-9_-]+')
PROJ="https://exayifxbqduhsxmmsnxr.supabase.co"
GKEY_BROWSER=$(grep -oE 'AIza[A-Za-z0-9_-]+' index.html | head -1)
AUTH="Authorization: Bearer ${ANON}"

echo "=== FINAL CHECK A — key-leak scan across all 3 Edge responses ==="
R1=$(curl -s -X POST "$PROJ/functions/v1/geocode-address" -H "$AUTH" -H "Content-Type: application/json" -d '{"order_id":"CC20260615DB6C","address":"3801 White Plains Rd, Bronx, NY"}' --max-time 30)
R2=$(curl -s -X POST "$PROJ/functions/v1/optimize-route" -H "$AUTH" -H "Content-Type: application/json" -d '{"route_id":"00000000-0000-0000-0000-000000000000","origin":{"lat":40.88,"lng":-73.86},"stops":[{"order_id":"x","lat":40.75,"lng":-73.98}]}' --max-time 30)
R3=$(curl -s -X POST "$PROJ/functions/v1/assign-route" -H "$AUTH" -H "Content-Type: application/json" -d '{"route_id":"00000000-0000-0000-0000-000000000000","ordered_stops":[{"order_id":"x","sequence":1}],"origin":{"lat":40.88,"lng":-73.86}}' --max-time 30)

# scan for ANY AIza-pattern key in responses
for name in "geocode:$R1" "optimize:$R2" "assign:$R3"; do
  label="${name%%:*}"; body="${name#*:}"
  if echo "$body" | grep -qE 'AIza[A-Za-z0-9_-]{20}'; then echo "  ❌ $label: KEY LEAK"; else echo "  ✅ $label: no key in response"; fi
done
echo ""
echo "geocode resp:  $R1"
echo "optimize resp: $R2"
echo "assign resp:   $R3"
