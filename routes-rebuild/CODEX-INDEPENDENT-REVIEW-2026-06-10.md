# Codex Independent Review — Routes Rebuild Prep

**Date:** 2026-06-10  
**Scope:** Latest Forge/Delta routes rebuild prep files  
**Status:** NEEDS REVISION before routes apply/deploy; Migration 03 closed

## Cleared

- Owner desktop mockups are now present:
  - `reference-images/owner-desktop-routes-endpoint-entry.jpg`
  - `reference-images/owner-desktop-routes-overview.jpg`
- `mobile-driver-status.html` only exposes Delivered and No Answer. Address Issue and Skip are deferred in a comment.
- Migration 03 correctly removes the redundant `(tenant_id, user_id)` index and uses `CREATE INDEX CONCURRENTLY`.
- Migration 03 was applied at 2026-06-10 21:52 EDT and independently reviewed from Delta's apply evidence. The live index is valid, there are no invalid `members` indexes, and row count remained unchanged.
- Migration 02 records Jeffrey's final lazy-population decision.
- The routes plan consistently states browser key via Netlify build-time substitution and server keys via Supabase Edge Function secrets.

## Blocking Corrections

### 1. Netlify browser-key substitution is broken

`netlify.toml` uses:

```sh
sed -i.bak 's/%%GOOGLE_MAPS_KEY%%/$GOOGLE_MAPS_API_KEY/g' index.html
```

The single-quoted sed expression prevents shell expansion, so it writes the literal text `$GOOGLE_MAPS_API_KEY` instead of the key.

Required:

- Use a substitution method that expands the environment variable safely.
- Fail the build when `GOOGLE_MAPS_API_KEY` is missing.
- Fail the build when the placeholder is absent before substitution or remains after substitution.
- Do not publish `index.html.bak`.
- Add a dummy-key build test that proves exactly one placeholder becomes the dummy value.

Current `index.html` has no `%%GOOGLE_MAPS_KEY%%` placeholder yet, so a build would silently do nothing.

### 2. Migration 02 does not satisfy the approved schema plan

Migration 02 adds only `delivery_address`, but the approved plan and test suite require:

- `geocoded_lat`
- `geocoded_lng`
- `address_confidence`
- `address_confirmed_at`
- `address_confirmed_by`
- `route_id`
- `route_sequence`

Either expand Migration 02 or add explicitly ordered follow-up migrations before any RPC/test that references these columns.

### 3. Lazy geocoding controls are comments only

Migration 02 names throttling, retries, cost monitoring, and address-hash caching, but no `geocode_cache` or `geocode_audit` schema exists in the current migration drafts.

Required before implementation:

- Decide whether audit is a table or Edge Function logging.
- Add a concrete cache/audit migration if tables are selected.
- Put throttling, retry, and Google API-call behavior in the Edge Function design, not `confirm_order_address`; the RPC only persists validated results.
- Add tests proving cache hits avoid Google calls and tenant rate limits are enforced.

### 4. Remove all production test-tenant anonymous policies

The current `test-tenant-policy-fix.sql` only changes `test_tenant_anon_read`
from `public` to `anon`. It intentionally leaves anonymous SELECT, INSERT, and
UPDATE access to `test-tenant` data.

The production `?debug=1` login flow uses real Supabase Auth test accounts and
does not require anonymous order writes. Before R1, replace the targeted fix
with a cleanup migration that drops all three:

- `test_tenant_anon_read`
- `test_tenant_anon_insert`
- `test_tenant_anon_update`

Post-commit verification must return zero rows for those policy names, then
prove authenticated smoke accounts still work through normal tenant-scoped RLS.

## Additional Release Gates

- Do not deploy `netlify.toml` until the substitution fix and dummy-key test pass.
- Migration 03 is complete and requires no further action.
- Do not apply Migrations 01/02 until the complete orders geocoding-column sequence is explicit.
- Do not apply the current narrow `test-tenant-policy-fix.sql`; replace it with the full three-policy cleanup and have Delta review it.
- Supabase CLI authorization and Google Cloud billing/API/key setup still require Jeffrey authorization.
