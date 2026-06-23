#!/usr/bin/env node
/**
 * create-driver-b.js
 * ==================
 * Casabe Konnect — Driver B Test Account Creation
 *
 * Creates `test-driver-b@casabekonnect.test` in auth.users and inserts
 * a matching members row (role=driver, tenant_id=test-tenant, active=true).
 *
 * This account is used to prove Driver B sees ZERO orders (no cross-driver
 * visibility) after the r1-rls-driver-fix.sql migration is applied.
 *
 * USAGE:
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
 *   node smoke-setup/create-driver-b.js
 *
 * OPTIONAL ENV:
 *   SMOKE_TENANT_ID    — tenant slug (default: test-tenant)
 *
 * OUTPUT:
 *   Password printed ONCE to stdout. Copy to password manager immediately.
 *   Never written to disk. Never hardcoded.
 *
 * SECURITY:
 *   Run in a trusted local terminal only. Do NOT run via OpenClaw, Codex,
 *   or any agent session. Credentials are printed to stdout — agent logs
 *   retain stdout. After running: save credentials and clear terminal history.
 *
 * IDEMPOTENCY:
 *   If test-driver-b@casabekonnect.test already exists, the script deletes
 *   the stale auth.users record (cascades members row) then recreates fresh.
 *   Safe to re-run without manual cleanup.
 *
 * PREREQUISITE:
 *   r1-rls-driver-fix.sql must be applied before running driver-b-verification.sql.
 *   This script only creates the account — it does not apply the migration.
 */

'use strict';

// ⚠️  SECURITY: Run this script MANUALLY in a trusted local terminal only.
// Do NOT execute via OpenClaw, Codex, or any agent session.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — Read from environment; fail fast if missing
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TENANT_ID            = process.env.SMOKE_TENANT_ID || 'test-tenant';

const DRIVER_B_EMAIL       = 'test-driver-b@casabekonnect.test';
const DRIVER_B_ROLE        = 'driver';
const DRIVER_B_DISPLAY     = 'Test Driver B';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('');
  console.error('ERROR: Required environment variables not set.');
  console.error('  SUPABASE_URL              — e.g. https://exayifxbqduhsxmmsnxr.supabase.co');
  console.error('  SUPABASE_SERVICE_ROLE_KEY — from Supabase dashboard > Settings > API');
  console.error('');
  console.error('Optional:');
  console.error('  SMOKE_TENANT_ID — default: test-tenant');
  console.error('');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE CLIENT — Service role only; never used in browser
// ─────────────────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a cryptographically random 32-character hex password. */
function generatePassword() {
  return crypto.randomBytes(16).toString('hex');
}

/** Sleep helper for courtesy delay between API calls. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pre-run stale account cleanup.
 *
 * If test-driver-b@casabekonnect.test already exists, delete it first.
 * The members.user_id FK is ON DELETE CASCADE, so deleting auth.users
 * automatically removes the stale members row.
 */
async function deleteStaleAccountIfExists(email) {
  const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });

  if (listError) {
    console.warn(`  ⚠️  Could not list auth.users: ${listError.message}`);
    return { deleted: false, userId: null };
  }

  const existing = (listData.users || []).find(
    (u) => u.email && u.email.toLowerCase() === email.toLowerCase()
  );

  if (!existing) {
    console.log(`  ℹ️  No stale account found for ${email} — fresh create.`);
    return { deleted: false, userId: null };
  }

  console.log(`  🗑️  Stale account found: ${email} (id: ${existing.id})`);
  console.log(`     Deleting (members row will cascade)...`);

  const { error: deleteError } = await supabase.auth.admin.deleteUser(existing.id);
  if (deleteError) {
    console.error(`  ❌ Failed to delete stale account: ${deleteError.message}`);
    return { deleted: false, userId: existing.id };
  }

  console.log(`  ✅ Stale account deleted.`);
  await sleep(300); // let cascade propagate
  return { deleted: true, userId: existing.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  Casabe Konnect — Driver B Test Account Creation');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`  Supabase URL : ${SUPABASE_URL}`);
  console.log(`  Email        : ${DRIVER_B_EMAIL}`);
  console.log(`  Tenant ID    : ${TENANT_ID}`);
  console.log(`  Role         : ${DRIVER_B_ROLE}`);
  console.log('');

  // ── Step 0: Pre-run stale account cleanup ──────────────────────────────
  await deleteStaleAccountIfExists(DRIVER_B_EMAIL);

  // ── Step 1: Generate random password ──────────────────────────────────
  // Password is generated fresh every run. Never hardcoded.
  const password = generatePassword();

  // ── Step 2: Create Auth user via Admin API ─────────────────────────────
  // Direct SQL INSERT into auth.users does NOT create identity records
  // and WILL break password login — hence this approach.
  console.log(`  Creating auth.users record...`);

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: DRIVER_B_EMAIL,
    password,
    email_confirm: true,  // Skip email verification; this is a test account
    user_metadata: {
      display_name: DRIVER_B_DISPLAY,
      test_account: true,
      purpose: 'driver-b-isolation-test',
    },
  });

  if (authError) {
    if (authError.message && authError.message.toLowerCase().includes('already registered')) {
      console.error(`  ❌ DUPLICATE: ${DRIVER_B_EMAIL} still exists after stale cleanup attempt.`);
      console.error(`     Delete manually and re-run.`);
    } else {
      console.error(`  ❌ Auth createUser failed: ${authError.message}`);
    }
    process.exit(1);
  }

  const userId = authData.user.id;
  console.log(`  ✅ auth.users record created: ${userId}`);

  // ── Step 3: Insert members row ─────────────────────────────────────────
  // Both `role` and `app_role` are written so that:
  //   • app login (reads members.role) works
  //   • RLS helper COALESCE(app_role, role) resolves correctly
  console.log(`  Inserting members row...`);

  const membersRow = {
    user_id:      userId,
    tenant_id:    TENANT_ID,
    role:         DRIVER_B_ROLE,
    app_role:     DRIVER_B_ROLE,
    display_name: DRIVER_B_DISPLAY,
    active:       true,
    metadata:     {},
  };

  const { error: membersError } = await supabase
    .from('members')
    .insert(membersRow);

  if (membersError) {
    console.error(`  ❌ members insert failed: ${membersError.message}`);
    console.error(`     Code: ${membersError.code} | Details: ${membersError.details || 'none'}`);
    console.error(`     Hint: ${membersError.hint || 'none'}`);
    console.error(`  🔄 Rolling back auth.users record...`);
    await supabase.auth.admin.deleteUser(userId);
    console.error(`  [ROLLBACK] auth.users record deleted.`);
    process.exit(1);
  }

  console.log(`  ✅ members row inserted (role: ${DRIVER_B_ROLE}, tenant_id: ${TENANT_ID})`);

  // ─────────────────────────────────────────────────────────────────────────
  // ONE-TIME CREDENTIAL SUMMARY — Print to stdout ONLY
  // ─────────────────────────────────────────────────────────────────────────

  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  ⚠️  ONE-TIME CREDENTIAL SUMMARY — DO NOT SAVE TO FILE');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  This password is generated fresh each run.');
  console.log('  Copy it to your password manager NOW.');
  console.log('  It is NOT stored anywhere and cannot be recovered.');
  console.log('');
  console.log(`  [DRIVER-B]`);
  console.log(`    Email    : ${DRIVER_B_EMAIL}`);
  console.log(`    Password : ${password}`);
  console.log(`    User ID  : ${userId}`);
  console.log(`    Role     : ${DRIVER_B_ROLE}`);
  console.log(`    Tenant   : ${TENANT_ID}`);
  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  ✅ Driver B account created successfully.');
  console.log('');
  console.log('  Next steps:');
  console.log('  1. Ensure r1-rls-driver-fix.sql is applied to the DB.');
  console.log('  2. Run driver-b-verification.sql with Driver B JWT to');
  console.log('     confirm zero order visibility.');
  console.log('  3. Run with Driver A JWT to confirm SMOKE-001/002 visible.');
  console.log('  4. Run with HQ JWT to confirm all orders visible.');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
