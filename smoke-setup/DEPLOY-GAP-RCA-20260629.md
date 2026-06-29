
## RESOLUTION (executed 2026-06-29, under standing deploy permission)
- GitHub origin/main is PROTECTED (PR-only) AND Netlify watches a different repo
  (hgit.../casabekonnect-app) — so `git push origin main` does NOT deploy. The
  real deploy path is the authenticated Netlify CLI.
- Promoted ONLY the 4 safe display/status fix commits to main via cherry-pick
  (promote-fixes branch, ff-merged to main):
    a951a06 CK-L1-004 | 1873c6f Tier1 x4 | 7699b5c Tier2+Path2 | 5a0220f CK-L1-007
- HELD BACK (needs Jeffrey sign-off — touches SMS/A2P/consent):
    86e6fdd "A2P 10DLC fix: public SMS opt-in compliance"  ← NOT deployed
- Skipped the typo plant/fix pair (bd23d2a/15e709e) — main never had the typo;
  verified 0 rendered "In Wareouse" on live prod regardless.
- PROD DEPLOY: netlify deploy --prod → https://casabekonnect-app.netlify.app
  (deploy 6a42657016e1b3667ed52d0e). Verified live: CK-L1-010=1, ZONE_COLORS=2,
  CK-L1-017=2, BRAND_NAME(A2P)=0, rendered "In Wareouse"=0. Clean.
