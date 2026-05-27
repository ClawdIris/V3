# Phase 1 Supabase Migration - Execution Guide

**Status:** Ready for Manual Execution via Supabase Dashboard

**Date:** May 26, 2026  
**Project:** Casabe Konnect R4 (Phase 1 Data Foundations)  
**Supabase Instance:** exayifxbqduhsxmmsnxr

---

## Preflight Check ✅

The Phase 1 Live Supabase Verifier has confirmed:

```
════════════════════════════════════════════════════════════════
  PHASE 1 LIVE SUPABASE VERIFIER (READ ONLY)
════════════════════════════════════════════════════════════════
Project: https://exayifxbqduhsxmmsnxr.supabase.co

  ✗ orders.pickup_location column (HTTP 400)
     42703 column orders.pickup_location does not exist
  ✗ public.box_orders table (HTTP 404)
     PGRST205 Could not find the table 'public.box_orders' in the schema cache
  ✗ public.activity_log table (HTTP 404)
     PGRST205 Could not find the table 'public.activity_log' in the schema cache
  ✓ control: public.offices reachable (HTTP 200)

Summary: 1/4 passed

Live Phase 1 is NOT applied/verified. Do not run Phase 2/3 production smoke against this database yet.
```

**Interpretation:** Phase 1 schema has NOT yet been applied to production. The database is ready for migration.

---

## SQL Schema Review ✅

**File:** `phase1-data-schema.sql` (20 KB)  
**Safety Level:** ✅ SAFE - No destructive operations

**Changes:**
1. ✅ ADD COLUMN `pickup_location` to `orders` table (non-destructive, IF NOT EXISTS)
2. ✅ CREATE TABLE `box_orders` (26 columns, 9 indexes, 10 RLS policies)
3. ✅ CREATE TABLE `activity_log` (14 columns, 8 indexes, 7 RLS policies)
4. ✅ 17 total RLS policies (HQ, Office, Driver, Anonymous roles)
5. ✅ GRANT permissions to authenticated and service_role

**No operations blocked:** ❌ No DROP, DELETE, ALTER COLUMN, or destructive changes

---

## How to Execute

### Option 1: Via Supabase Web Dashboard (Recommended)

1. **Navigate** to: https://app.supabase.com/project/exayifxbqduhsxmmsnxr
2. **Login** with your Supabase account
3. **Go to:** SQL Editor (left sidebar)
4. **Click:** "New Query"
5. **Paste:** The entire contents of `phase1-data-schema.sql` (from ~/casabe-v3/)
6. **Review:** Confirm all CREATE TABLE and ALTER TABLE statements
7. **Click:** "RUN" button
8. **Wait:** For completion (should complete in <5 seconds)
9. **Verify:** Check the output for any errors

**Expected Output:**
```
Query executed successfully (no rows returned)
```

### Option 2: Via Supabase CLI (if installed)

```bash
cd ~/casabe-v3
supabase db push
```

### Option 3: Via Direct PostgreSQL Connection (requires credentials)

```bash
psql -h exayifxbqduhsxmmsnxr.supabase.co \
     -U postgres \
     -d postgres \
     -f phase1-data-schema.sql
```

(Requires PostgreSQL client installed and database password)

---

## Post-Execution Verification

### Step 4a: Verify via REST API

```bash
cd ~/casabe-v3
node test-phase1-live.js
```

**Expected Output:**
```
════════════════════════════════════════════════════════════════
  PHASE 1 LIVE SUPABASE VERIFIER (READ ONLY)
════════════════════════════════════════════════════════════════
Project: https://exayifxbqduhsxmmsnxr.supabase.co
  ✓ orders.pickup_location column (HTTP 200)
  ✓ public.box_orders table (HTTP 200)
  ✓ public.activity_log table (HTTP 200)
  ✓ control: public.offices reachable (HTTP 200)

Summary: 4/4 passed

Live Phase 1 foundations are present.
```

### Step 4b: Verify via RLS Tests

```bash
cd ~/casabe-v3
node test-phase1-rls.js
```

**Expected Output:**
```
Group 1: Schema Syntax & Structure ............ 12/12 ✅
Group 2: Indexes & Performance ............... 12/12 ✅
Group 3: RLS Policies - box_orders ........... 10/10 ✅
Group 4: RLS Policies - activity_log ........ 8/8 ✅
Group 5: Helper Functions ................... 4/4 ✅
Group 6: Permissions & Grants ............... 4/4 ✅
Group 7: Documentation & Comments ........... 5/5 ✅
─────────────────────────────────
TOTAL: 55/55 PASS ✅
```

---

## What Gets Created

### 1. Column Addition
- **Table:** `orders`
- **Column:** `pickup_location`
- **Type:** TEXT (enum: 'office', 'client_house', NULL)
- **Index:** `idx_orders_pickup_location`

### 2. New Table: box_orders
- **Purpose:** Normalized box-level data
- **Columns:** 26 (id, order_id, box_number, office_id, driver_id, status, barcode, etc.)
- **Indexes:** 9 (simple + composite)
- **RLS Policies:** 10 (HQ, Office, Driver access control)
- **Features:**
  - Box lifecycle tracking (created → assigned → picked_up → delivered → completed)
  - Barcode scanning support
  - Driver assignment tracking
  - Audit fields (created_by, updated_by, etc.)
  - Metadata storage (JSONB)

### 3. New Table: activity_log
- **Purpose:** Immutable audit trail
- **Columns:** 14 (id, tenant_id, order_id, box_id, user_id, activity_type, old_data, new_data, etc.)
- **Indexes:** 8 (simple + composite + conditional)
- **RLS Policies:** 7 (HQ, Office, Driver visibility)
- **Features:**
  - Event sourcing capable
  - Immutable (INSERT only, no UPDATE/DELETE)
  - Request correlation (request_id)
  - Old/new data snapshots
  - Activity type classification

### 4. RLS Policies (17 Total)
- **4 policies** on box_orders (HQ, Office, Driver, deny DELETE)
- **7 policies** on activity_log (HQ, Office, Driver, authenticated INSERT, deny UPDATE, deny DELETE)
- **Helper functions:**
  - `get_user_role()` - Determine user's role from user_profiles
  - `get_user_office_ids()` - Get user's accessible office IDs

### 5. Permissions Granted
- `authenticated` role: SELECT, INSERT, UPDATE on box_orders; SELECT, INSERT on activity_log
- `service_role`: Full access (ALL privileges)

---

## Rollback (if needed)

If execution fails or needs to be undone:

```sql
-- Rollback Phase 1
DROP TABLE IF EXISTS activity_log CASCADE;
DROP TABLE IF EXISTS box_orders CASCADE;
ALTER TABLE orders DROP COLUMN IF EXISTS pickup_location CASCADE;
DROP FUNCTION IF EXISTS get_user_role() CASCADE;
DROP FUNCTION IF EXISTS get_user_office_ids() CASCADE;
```

---

## Pass Criteria

Phase 1 Migration is **COMPLETE** when:

- ✅ `test-phase1-live.js` returns 4/4 PASS
- ✅ `test-phase1-rls.js` returns 55/55 PASS
- ✅ orders.pickup_location column exists
- ✅ box_orders table exists with 26 columns
- ✅ activity_log table exists with 14 columns
- ✅ 17 RLS policies present
- ✅ RLS enabled on both new tables
- ✅ Helper functions created successfully

---

## Notes

- **Safety:** SQL contains only CREATE TABLE, ALTER TABLE ADD COLUMN, CREATE INDEX, CREATE FUNCTION, and GRANT statements. No data loss risk.
- **Performance:** Migration should complete in <5 seconds. No downtime needed.
- **RLS:** Automatically enforced by Supabase auth. No application changes needed yet.
- **Next Step:** Phase 2 (box operations) and Phase 3 (delivery workflow) depend on this schema.

---

**Generated:** May 26, 2026  
**Prepared By:** Casabe Phase 1 Migration Agent  
**Status:** ✅ Ready for Execution
