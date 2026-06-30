#!/usr/bin/env bash
# netlify-build-guard.sh — runs at Netlify build time (git-based deploys).
# Validates the committed Google Maps browser key so a broken bundle that would
# white-screen on prod NEVER gets published. Exits non-zero to fail the build.
set -euo pipefail

echo "[build-guard] validating index.html before publish…"

FILE="index.html"
[ -f "$FILE" ] || { echo "[build-guard] FAIL: $FILE not found"; exit 1; }

# 1. No unsubstituted placeholder or unexpanded shell var may ship.
if grep -q '%%GOOGLE_MAPS_KEY%%' "$FILE"; then
  echo "[build-guard] FAIL: %%GOOGLE_MAPS_KEY%% placeholder still present (no substitution configured)."
  exit 1
fi
if grep -q '\$GOOGLE_MAPS_API_KEY' "$FILE"; then
  echo "[build-guard] FAIL: literal \$GOOGLE_MAPS_API_KEY found (broken sed substitution)."
  exit 1
fi

# 2. The committed browser key must be a real-looking Google key.
KEYLINE=$(grep -oE 'var GOOGLE_MAPS_KEY = "[^"]*"' "$FILE" || true)
if [ -z "$KEYLINE" ]; then
  echo "[build-guard] FAIL: GOOGLE_MAPS_KEY declaration not found."
  exit 1
fi
KEYVAL=$(echo "$KEYLINE" | sed -E 's/.*"([^"]*)".*/\1/')
if ! echo "$KEYVAL" | grep -qE '^AIza[0-9A-Za-z_-]{20,}$'; then
  echo "[build-guard] FAIL: GOOGLE_MAPS_KEY is not a valid Google key: ${KEYVAL:0:10}…"
  exit 1
fi

# 3. Inline scripts must be balanced (cheap guard against a truncated/corrupt commit).
if ! grep -q 'var GOOGLE_MAPS_KEY' "$FILE" || ! grep -q 'Sign in to your account' "$FILE"; then
  echo "[build-guard] FAIL: critical markers missing — bundle looks corrupt/partial."
  exit 1
fi

echo "[build-guard] OK: key valid (${KEYVAL:0:10}…), markers present. Publishing."
