#!/usr/bin/env bash
# One-shot setup of a fresh Supabase project for Jeffy, run from YOUR machine.
#
#   ./scripts/setup-supabase.sh <project-ref>
#
# Needs the Supabase CLI (https://supabase.com/docs/guides/cli) and a login:
#   npx supabase login
#
# What it does, in order:
#   1. links this directory to the project
#   2. pushes every migration in supabase/migrations
#   3. deploys every Edge Function in supabase/functions
#   4. prints the URL + anon key for .env.local and the dashboard steps that
#      cannot be scripted (Apple provider, redirect URL, secrets)
#
# Safe to re-run: `db push` applies only migrations it has not seen.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

REF="${1:-}"
if [[ -z "$REF" ]]; then
  echo "usage: $0 <project-ref>   (Dashboard -> Project Settings -> General -> Reference ID)" >&2
  exit 1
fi

SB="npx --yes supabase"

echo "==> link $REF"
$SB link --project-ref "$REF"

echo "==> push migrations"
$SB db push

echo "==> deploy edge functions"
for dir in supabase/functions/*/; do
  name="$(basename "$dir")"
  [[ "$name" == _* ]] && continue
  echo "    $name"
  $SB functions deploy "$name"   # JWT verification stays on (the default)
done

echo "==> generate types"
$SB gen types typescript --project-id "$REF" --schema public > src/types/database.generated.ts
echo "    wrote src/types/database.generated.ts (review, then replace src/types/database.ts)"

echo
echo "==> project keys (for .env.local)"
$SB projects api-keys --project-ref "$REF" 2>/dev/null || \
  echo "    (open Dashboard -> Project Settings -> API for the URL and anon key)"

cat <<'EOF'

==> Finish in the dashboard (cannot be scripted):

  Authentication -> Providers -> Email
      Keep "Confirm email" ON. Jeffy expects the confirmation step.

  Authentication -> Providers -> Apple
      Enable. Needs a Services ID + key from the Apple Developer account.
      Skip until that account exists; email sign-in works without it.

  Authentication -> URL Configuration -> Redirect URLs
      Add:  jeffy://reset-password

  Edge Functions -> Secrets
      ANTHROPIC_API_KEY = sk-ant-...      (AI tagging is off until this is set)

  Then copy the URL + anon key into jeffy/.env.local and, for the keep-alive
  workflow, into the GitHub repo secrets JEFFY_SUPABASE_URL and
  JEFFY_SUPABASE_ANON_KEY.
EOF
