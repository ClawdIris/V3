#!/usr/bin/env bash
# Casabe Konnect — pre-deploy gate. Run from ~/casabe-v3 BEFORE `netlify deploy --prod`.
# Blocks the deploy if any check fails. Zero external services required (Node only).
#
#   chmod +x preflight.sh   # once
#   ./preflight.sh          # before every deploy
#
# Exit 0 = safe to deploy. Exit 1 = DO NOT DEPLOY (a check failed).
set -u
FAIL=0
say()  { printf "  %s\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31m✗ %s\033[0m\n" "$1"; FAIL=1; }

echo "── Casabe preflight ──────────────────────────────"

# 0. files present
[ -f index.html ] || { bad "index.html not found — run from ~/casabe-v3"; exit 1; }

# 1. JS syntax of every inline <script> block (catches the paren/brace class)
node -e '
  const fs=require("fs");
  const h=fs.readFileSync("index.html","utf8");
  const js=[...h.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(m=>!/\bsrc\s*=/.test(m[1])).map(m=>m[2]).join("\n;\n");
  fs.writeFileSync("/tmp/ck_inline.js", js);
' && node --check /tmp/ck_inline.js 2>/tmp/ck_syn.txt \
  && ok "index.html inline JS: syntax OK" \
  || { bad "index.html inline JS: SYNTAX ERROR"; cat /tmp/ck_syn.txt; }

# 2. external modules syntax
if [ -f route-optimizer.js ]; then
  node --check route-optimizer.js 2>/tmp/ck_ro.txt && ok "route-optimizer.js: syntax OK" \
    || { bad "route-optimizer.js: SYNTAX ERROR"; cat /tmp/ck_ro.txt; }
fi
if [ -f phase5-receipts-components.js ]; then
  node --check phase5-receipts-components.js 2>/dev/null && ok "phase5-receipts-components.js: syntax OK" \
    || bad "phase5-receipts-components.js: SYNTAX ERROR"
fi

# 3. no self-terminating </style> inside a <style> block (the inert-CSS bug)
node -e '
  const fs=require("fs");const h=fs.readFileSync("index.html","utf8");
  const blocks=[...h.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
  let bad=0;
  for(const b of blocks){ if(/<\/style/i.test(b[1])) bad++; }
  process.exit(bad?2:0);
' && ok "no nested </style> in style blocks" || bad "a <style> block contains a literal </style> (CSS will be inert)"

# 4. Google Maps browser key present and not a placeholder
if grep -q 'AIzaSy' index.html; then ok "Google Maps key present"
  else bad "Google Maps key missing"; fi
grep -q '%%TURNSTILE_SITE_KEY%%' index.html \
  && say "  note: Turnstile still a placeholder (opt-in captures unverified — expected until provisioned)"

# 5. no server secrets leaked into the client bundle
if grep -Eq 'sk_(live|test)_[A-Za-z0-9]{20}|whsec_[A-Za-z0-9]{20}|eyJ[A-Za-z0-9_-]{20}\\.[A-Za-z0-9_-]{20}' index.html; then
  bad "possible SECRET leaked in index.html — inspect before deploy"
else ok "no server secrets in client bundle"; fi

# 6. brand hygiene: no platform brand in customer-facing SMS copy
if grep -q 'managed by Casabe Konnect' index.html; then
  bad "customer-facing copy still says 'managed by Casabe Konnect' (A2P brand mismatch)"
else ok "customer SMS copy is single-brand"; fi

# 7. error tracking wired
grep -q '__logClientError' index.html && ok "client error tracking present" \
  || say "  note: client error tracking not found (optional)"

# 8. git vs deploy drift reminder (informational)
if command -v git >/dev/null && [ -d .git ]; then
  if [ -n "$(git status --porcelain index.html route-optimizer.js 2>/dev/null)" ]; then
    say "  note: index.html/route-optimizer.js have uncommitted changes — commit before deploy so git matches production"
  fi
fi

echo "──────────────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  printf "  \033[32mPREFLIGHT PASSED — safe to deploy.\033[0m\n"
  echo "  Next: git add -A && git commit && git push && netlify deploy --prod"
  exit 0
else
  printf "  \033[31mPREFLIGHT FAILED — do NOT deploy until fixed.\033[0m\n"
  exit 1
fi
