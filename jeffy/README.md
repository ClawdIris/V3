# Jeffy

A closet app for people who own good clothes and wear the same three things.
Catalogue what you own, let AI *and* a friend with taste suggest outfits, buy
the right pieces within a budget, and keep the conversation in one place.

iOS, React Native + Expo (SDK 57), Supabase, Claude.

---

## How it fits together

```
Expo app (TypeScript strict)
  │  anon key only — every secret lives server-side
  ▼
Supabase ── Postgres + RLS ── private Storage ── Auth ── Realtime
  │
  └── Edge Functions ── Anthropic · product lookup · web search
```

**One idea shapes the whole codebase: Claude never sees your closet.**
`src/domain/outfit-engine.ts` filters and scores the wardrobe down to a
shortlist, the shortlist goes to the model as plain text fields, and
`validateProposal()` checks the reply against that same shortlist. So "outfits
only use things I actually own" is a structural guarantee rather than a
politely worded prompt — an invented id fails validation and never reaches you.
It also means the outfit rules are pure functions you can unit-test without a
network, a database, or a model.

### Roles

A closet has one **owner** and any number of **stylists**. One account can own
its own closet and be a stylist on someone else's; the data model has always
been many-to-many, so "just me and my friend" scales to any number of pairs
without a migration.

---

## Setup

### 1. Requirements

- Node 22+, npm 10+
- A [Supabase](https://supabase.com) project
- An [Anthropic API key](https://console.anthropic.com) — only needed for the
  AI features; everything else works without one
- For device builds: an Expo account and a **paid** Apple Developer account
  ($99/yr). Sign in with Apple, push notifications, and TestFlight all require
  it.

### 2. Install and configure

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Where to find it |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | same page (safe to ship: everything is behind RLS) |
| `EXPO_PUBLIC_BUNDLE_ID` | optional, defaults to `com.jeffy.app` |
| `EAS_PROJECT_ID` | set by `eas init` |

Server-side keys are **never** in `.env.local`. They go to Supabase:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Apply the schema

One command, from your machine, after `npx supabase login`:

```bash
./scripts/setup-supabase.sh <project-ref>
```

It links the project, pushes every migration, deploys every Edge Function,
regenerates the types, and prints the dashboard steps that cannot be scripted.
By hand, it is:

```bash
supabase link --project-ref <your-project-ref>
supabase db push          # applies supabase/migrations in order
supabase functions deploy ai-tag-item
```

Then, in the Supabase dashboard:

- **Authentication → Providers → Apple**: enable it and add your Services ID
  and key. Without this, Sign in with Apple fails at runtime.
- **Authentication → URL Configuration**: add `jeffy://reset-password` to the
  redirect allow-list, or password resets dead-end.

Regenerate the typed schema once the project exists:

```bash
SUPABASE_PROJECT_ID=<ref> npm run gen:types
```

### 4. Seed a closet (optional)

Sign up in the app first, copy your user id from the dashboard, then:

```bash
psql "$DATABASE_URL" -v owner_id=<your-user-uuid> -f supabase/seed/seed.sql
```

15 items, budget ranges, a style rule, and some wear history — enough to
exercise filtering, suggestions and stats. Photos are not seeded (Storage
objects can't be created from SQL), so tiles show placeholders until you add
some through the app.

### 4b. Keep the free project awake

Free-tier Supabase pauses a project after about a week with no traffic, and
un-pausing is a manual dashboard step. `.github/workflows/jeffy-keepalive.yml`
makes one real request every three days. Give it two repository secrets:

| Secret | Value |
|---|---|
| `JEFFY_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `JEFFY_SUPABASE_ANON_KEY` | the anon key |

### 5. Run it — on the web (primary)

Jeffy ships as a **PWA**. No Apple Developer account, no Mac, no TestFlight:

```bash
npm run web            # dev server in your browser
npm run build:web      # static export to dist/
```

**Hosting: Cloudflare Pages.** Free, no idle pausing, and a faster CDN than
the alternatives. Connect the repo in the Cloudflare dashboard (Workers &
Pages → Create → Pages → Connect to Git):

| Setting | Value |
|---|---|
| Production branch | the branch you deploy from |
| Root directory | `jeffy` |
| Build command | `npm run build:web` |
| Build output directory | `dist` |
| Environment variables | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` |

`public/_redirects` and `public/_headers` ride along into `dist/` and give
Pages the SPA rewrite, no-cache on the service worker, and immutable caching
on hashed assets. `.node-version` pins Node 22 for the build. From a laptop,
`npx wrangler pages deploy` works too. (`netlify.toml` is kept as a fallback
host; both read the same `dist/`.)

Then tell Supabase where the app lives — Authentication → URL Configuration:
Site URL = your Pages URL, and add `https://<your-site>.pages.dev/**` to the
redirect allow-list, or password resets and Apple sign-in cannot return.

On your phone, open the URL in Safari → Share → **Add to Home Screen**. From
then on it launches full-screen like an app, works offline for browsing the
closet, and (iOS 16.4+) can receive push notifications.

The service worker (`public/sw.js`) caches only the app shell and hashed
build assets. Supabase responses are never cached by it: they are per-user
and RLS-scoped, and caching them would be a privacy bug. Closet data is
cached by the app itself through the TanStack persister.

**What's different on the web** — be aware before you pick this path:

| | Native | Web |
|---|---|---|
| Biometric lock | Face ID on launch and after a timeout | Not available; the phone's own lock screen is the lock |
| Session storage | iOS keychain | `localStorage` — bounded by short-lived tokens |
| Calendar context | reads today's events | no web API exists; weather + occasion still work |
| Sign in with Apple | native sheet | OAuth redirect through Supabase |
| Camera | in-app | opens the real camera, or the photo library |

The native target still builds, and is the way back if the lock or calendar
matter to you.

### 5b. Run it — native (optional)

**Expo Go will not work.** The native build uses the camera, barcode
scanning, biometrics, and Sign in with Apple, all of which need a
development build:

```bash
npx eas login
npx eas init
npx eas build --profile development --platform ios   # once, ~15 min
npx expo start --dev-client
```

Install the resulting build on your device, then the dev server drives it. Use
`--profile simulator` for a simulator build (no Apple account needed, but no
Apple Sign-In or push). A device build needs a paid Apple Developer account.

---

## Inviting a stylist

1. **Owner** → Settings → *Generate an invite code*. An eight-character code
   appears, and the Share sheet sends it however you like.
2. **Stylist** signs up for their own Jeffy account.
3. **Stylist** → Settings → *Enter an invite code*, types it in.
4. They now appear under the owner's *Your stylist*, and their closet switcher
   shows both closets.

The owner can **Revoke** at any time; access stops on the stylist's next
request, with no sign-out required.

Codes are single-use, expire after seven days, and are **stored only as a
SHA-256 hash** — the plaintext is returned exactly once, by `create_invite()`,
and never persisted. Dashes and case are ignored, so a code read aloud over the
phone still works. What a stylist can and cannot do is enforced by RLS, not by
the UI: they can build outfits, write style rules, chat, and recommend
purchases, but they cannot add, edit, or delete the owner's items.

---

## Development

```bash
npm run verify       # typecheck + schema drift + unit tests + RLS suite
npm test             # unit tests only
npm run typecheck
npm run db:test      # throwaway Postgres: migrations + 40-assertion RLS suite
npm run verify:schema
```

`npm run db:test` boots a local Postgres, stubs the objects a hosted Supabase
provides (`supabase/test/00_bootstrap.sql`), applies every migration, and runs
the RLS suite — no cloud project and no network required. It needs the
`postgresql-16` server binaries locally.

### Layout

```
app/                 Expo Router routes (under src/app)
src/domain/          pure logic: outfit engine, budget, invites — all unit-tested
src/features/        feature slices: auth, closet, profile, stylist
src/lib/             supabase client, secure session, images, query cache, AI client
src/components/ui/   design primitives (light + dark, no hardcoded hex)
src/theme/           tokens
supabase/migrations/ schema, RLS, RPCs, storage policies
supabase/functions/  Edge Functions — the only place an API key exists
supabase/test/       RLS suite + local bootstrap
```

### Security notes

- **RLS on every table.** Policies route through `is_closet_member()` /
  `is_closet_owner()`, which are `SECURITY DEFINER` (so policies on
  `closet_members` don't recurse) and `language sql` (so the planner inlines
  them instead of paying a call per row).
- **Storage is private.** Object paths start with the closet id, which is what
  the bucket policy reads; a path whose first segment isn't a uuid fails
  closed. The app reads through signed URLs with a one-hour lifetime.
- **Sessions live in the iOS keychain**, not AsyncStorage, chunked across
  entries because the keychain rejects values over ~2 KB and a real Supabase
  session exceeds that.
- **Edge Functions act as the caller**, forwarding their JWT, so RLS still
  applies to everything a function reads. `closet_id` from a request body is
  verified with `requireClosetMember()`, never trusted.

### Milestones

| | Scope | State |
|---|---|---|
| 1 | Auth, profile, budget, invites, capture, closet library | **in progress** |
| 2 | AI outfits with weather, season, calendar | next |
| 3 | Stylist tools, style rules, chat, push | |
| 4 | Rack mode, barcode scan, store finds, wishlist | |
| 5 | Inspiration board, budget shopping, stats | |

### Known gaps

- `src/types/database.ts` is hand-maintained until a Supabase project exists;
  `npm run verify:schema` fails the build if it drifts from the migrations.
- Sign in with Apple is implemented on both targets but untested: native needs
  a paid Apple Developer account, and the web OAuth path needs the Apple
  provider configured in Supabase.
- The web build has been smoke-tested headlessly (renders, routes, manifest,
  service worker, error states) but not yet on a real iPhone.
- The PWA icons are the 1024px source icon at every declared size; real 192
  and 512 px renders are a follow-up.
- `seasonForDate()` assumes the northern hemisphere.
- Apparel UPC coverage in product databases is poor, so the AI tag-reading
  fallback (feature 7c) is the primary scan path, not the backup.
- Shopping results come from web search and go stale; the UI shows when a price
  was checked rather than implying it is live.
