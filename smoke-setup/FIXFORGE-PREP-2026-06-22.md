# FIXFORGE PREP — P3 + P4 WIRED

**Agent:** FixForge (Jeffrey's Mac)
**Timestamp:** 2026-06-22 ~17:40 EDT
**Scope:** Precondition prep only. NO app code touched, NO migration, NO deploy.
NOT on a debug branch yet — this is tooling/config on `main` working tree.

---

## ✅ P4 — Test harness repointed + machine-readable (DONE)

**Problem (flagged earlier today):** `tests/runtime-full.spec.js` pointed at a
stale April copy `file:///Users/joshua/Desktop/Cursor/index.html` (1.32 MB) —
not the repo build (1.89 MB). Every result was meaningless. `npm test` ran Jest
only; no machine-readable pass/fail tied to the real code.

**Fix:**
- New `playwright.config.js` — `testMatch: **/*.spec.js` (Jest keeps `*.test.js`,
  no collision), JSON reporter → `test-results/results.json`.
- Spec repointed to repo `index.html` via `path.resolve(__dirname,'..','index.html')`,
  overridable with `CASABE_TARGET_URL` (for debug-branch Netlify previews).
- Each case carries a stable **test_id** as the first title token:
  `RUNTIME-DESKTOP-001`, `RUNTIME-MOBILE-001`. ShipmentTester references these;
  FixForge re-runs one with `npx playwright test --grep "<test_id>"`.
- Added a real pass/fail gate: **uncaught JS exceptions → hard fail**
  (`expect(pageErrors).toEqual([])`). Console/request noise is reported, not fatal.
- npm scripts: `test:e2e`, `test:e2e:json`, `verify`.

**Verified (actually ran it):** `npx playwright test` → **2 passed (7.8s)**,
`target: file:///Users/joshua/casabe-v3/index.html`, title "Casabe Konnect",
0 page errors. `test-results/results.json` written with per-spec `ok` +
top-level `stats {expected:2, unexpected:0}`.

**⚠️ Note for ShipmentTester:** `file://` load surfaces only the login/landing
view (`clickableFound: 1`). A deep authenticated sweep needs a served build
(`CASABE_TARGET_URL=<debug preview>`) + login fixtures. The harness contract is
correct; coverage is intentionally shallow until a debug deploy + creds exist.

---

## ✅ P3 — Independent reviewer on PATH (DONE)

- `claude` (Claude Code **2.1.186**) existed at `~/.local/bin/claude` but that
  dir was NOT on PATH → not bare-callable.
- Symlinked into a PATH dir: `/opt/homebrew/bin/claude → ~/.local/bin/claude`.
- Now callable bare for the §3 diff cross-check. `codex` / `opencode` still
  absent — one reviewer satisfies P3, but a second would add redundancy.

---

## 🔴 STILL BLOCKING (FixForge cannot run the loop)

- **P1 — no `debug` branch.** Still on `main` with a live push path to
  `origin/main`. This is the spec's ABORT condition. Needs: `git checkout -b debug`
  + a push config that cannot reach `main`.
- **P2 — Honcho not wired.** `~/.hermes/config.yaml` has `honcho: {}` (empty).
  No shared backlog channel → no valid bug entries → no trigger. (Jefe working on
  this or an alternate shared note.)

**Posture:** 2 of 4 preconditions now green (P3, P4). 2 remain (P1, P2).
FixForge stays IDLE until P1 + P2 close and a ShipmentTester bug entry exists.
