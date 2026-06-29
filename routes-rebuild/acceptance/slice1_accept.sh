#!/bin/bash
cd ~/casabe-v3
ANON=$(grep -oE 'SUPABASE_ANON_KEY = "[^"]+"' index.html | grep -oE 'sb_publishable_[A-Za-z0-9_-]+')
PROJ="https://exayifxbqduhsxmmsnxr.supabase.co"
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
DBURL=$(grep -E "^DATABASE_URL=" .env.local | sed 's/^DATABASE_URL=//' | tr -d '"')
OID=$(psql "$DBURL" -t -c "SELECT id FROM orders WHERE tenant_id='casabe-xpress' LIMIT 1;" 2>/dev/null | tr -d ' ')
echo "test order_id: $OID"
echo ""
echo "TEST 1 - Bronx geocode (expect confidence:high, persists to order):"
AUTH="Authorization: Bearer ${ANON}"
curl -s -X POST "$PROJ/functions/v1/geocode-address" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d "{\"order_id\":\"$OID\",\"address\":\"3801 White Plains Rd, Bronx, NY 10467\"}" --max-time 30
echo ""
echo ""
echo "TEST 1b - verify it persisted to the order row:"
psql "$DBURL" -t -c "SELECT geocoded_lat, geocoded_lng, address_confidence, address_confirmed_at IS NOT NULL AS confirmed FROM orders WHERE id='$OID';" 2>&1
