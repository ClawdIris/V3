# DELTA — Migration 03 Preflight Report

**Date:** 2026-06-10
**Author:** Delta (QA/Debugger)
**Purpose:** Read-only inspection of production `members` table indexes prior to applying Migration 03

---

## Query Executed

```sql
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'members'
  AND schemaname = 'public'
ORDER BY indexname;
```

**Database:** `aws-1-us-east-1.pooler.supabase.com` (production Supabase)

---

## Results: Existing Indexes on `public.members`

| Index Name | Definition |
|---|---|
| `idx_members_office` | `CREATE INDEX idx_members_office ON public.members USING btree (office_id) WHERE ((office_id IS NOT NULL) AND (active = true))` |
| `idx_members_user_active` | `CREATE INDEX idx_members_user_active ON public.members USING btree (user_id) WHERE (active = true)` |
| `idx_members_user_tenant_role` | `CREATE INDEX idx_members_user_tenant_role ON public.members USING btree (user_id, tenant_id, app_role) WHERE (active = true)` |
| `members_pkey` | `CREATE UNIQUE INDEX members_pkey ON public.members USING btree (id)` |
| `members_tenant_id_user_id_key` | `CREATE UNIQUE INDEX members_tenant_id_user_id_key ON public.members USING btree (tenant_id, user_id)` |

---

## Migration 03 Target Indexes — Status

| Target Index | Exists? | Notes |
|---|---|---|
| `idx_members_user_id` | ❌ **NO** | Not found. A plain `user_id` btree index (no WHERE clause) does not exist. Note: `idx_members_user_active` covers `user_id WHERE active = true` — a partial index only. |
| `idx_members_tenant_user` | ❌ **NO** | Not found. A composite `(tenant_id, user_id)` *non-unique* index does not exist. Note: `members_tenant_id_user_id_key` is a **UNIQUE** index on those same columns — functionally it covers uniqueness enforcement but may differ from the intended non-unique lookup index. |

---

## Analysis

### `idx_members_user_id`
- **Missing.** No unconditional index on `user_id` exists.
- `idx_members_user_active` only covers `user_id WHERE active = true` — queries for inactive members (e.g., audit lookups, offboarding flows) will do a seq scan.
- **Recommendation:** Create `idx_members_user_id`.

### `idx_members_tenant_user`
- **Missing as a dedicated lookup index.**
- `members_tenant_id_user_id_key` (UNIQUE) on `(tenant_id, user_id)` exists, which the planner *may* use for lookups — but it is a unique constraint index, not an explicit lookup index, and the column order is `(tenant_id, user_id)`. If Migration 03 defines `idx_members_tenant_user` with the same column order, this is borderline-redundant but harmless. If Migration 03 defines it as `(user_id, tenant_id)`, it would be a genuinely new index.
- **Recommendation:** Inspect Migration 03's exact DDL before apply. If column order matches `members_tenant_id_user_id_key`, the index is redundant (still safe to create, just wasteful). If different order or different predicate, create it.

---

## Recommendation

**⚠️ APPLY Migration 03 during a low-traffic window.**

Both target indexes (`idx_members_user_id` and `idx_members_tenant_user`) are **absent** from production. This is not a no-op. The migration should proceed.

### Pre-apply checklist:
- [ ] Review Migration 03 DDL to confirm exact column order for `idx_members_tenant_user` vs existing `members_tenant_id_user_id_key` — flag if redundant
- [ ] Use `CREATE INDEX CONCURRENTLY` if the migration supports it, to avoid table locks on production
- [ ] Run during low-traffic window (off-peak hours)
- [ ] Confirm indexes exist post-apply with this same query

---

## Action 2 — API Key Placement (Jeffrey's Corrected Decision)

**Recorded for all future migration and RPC reviews:**

| Key Type | Correct Location | Variable Name |
|---|---|---|
| **Browser key** (Maps JS + Places) | Netlify build env var | `GOOGLE_MAPS_API_KEY` |
| **Server key** (Geocoding + Routes) | Supabase Edge Function secrets | `GOOGLE_GEOCODING_KEY`, `GOOGLE_ROUTES_KEY` |

### 🚩 Flag immediately if:
- Browser key (`GOOGLE_MAPS_API_KEY`) appears in **Supabase secrets** → **wrong placement**
- Server key (`GOOGLE_GEOCODING_KEY` / `GOOGLE_ROUTES_KEY`) appears in **Netlify env or `index.html`** → **wrong placement**

**Key placement noted: ✅ YES**

---

*Report prepared by Delta — QA/Debugger, Casabe Konnect*
