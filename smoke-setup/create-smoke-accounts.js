#!/usr/bin/env node
/**
 * create-smoke-accounts.js
 * ========================
 * Casabe Konnect — Smoke Test Account Setup
 *
 * Creates 4 smoke test accounts via Supabase Admin API and inserts
 * matching `members` rows. Passwords are random per run and printed
 * ONCE to stdout (never written to disk, never hardcoded).
 *
 * USAGE:
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
 *   node smoke-setup/create-smoke-accounts.js
 *
 * PREREQUISITES (Delta must verify these before running):
 *   1. members table constraints confirmed (see DELTA-PREFLIGHT.md)
 *   2. app_role vs role column confirmed
 *   3. A real office_id exists in the offices table — OR the sentinel
 *      'SMOKE-OFFICE-001' approach is confirmed acceptable
 *   4. tenant_id for the target tenant is known
 *
 * IDEMPOTENCY / STALE ACCOUNT HANDLING:
 *   Before creating each account, the script checks whether the email
 *   already exists in auth.users via the Admin API. If it does, the
 *   existing auth.users record (and its cascading members row, via the
 *   FK ON DELETE CASCADE) is deleted first, then the account is
 *   recreated fresh. This ensures idempotent re-runs without manual
 *   cleanup. Chosen approach: pre-run deleteUser() cleanup rather than
 *   ON CONFLICT upsert, because we also need a fresh auth.users entry
 *   (new UUID, new identity) not just an updated members row.
 *
 * SECURITY NOTES:
 *   - Never run with a hardcoded password
 *   - Never pipe stdout to a file when credentials are live
 *   - Credential output is one-time; re-run to rotate passwords
 *   - Do NOT commit this script's output anywhere
 */

'use strict';

// ⚠️  SECURITY: Run this script MANUALLY in a trusted local terminal only.
// Do NOT execute via OpenClaw, Codex, or any agent session.
// Credentials are printed to stdout — agent sessions retain stdout in logs.
// After running: immediately save credentials to your password manager and
// clear your terminal history.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — Read from environment; fail fast if missing
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// TENANT_ID: set to actual tenant slug for this smoke run.
// Delta must confirm the real tenant_id from the live DB before running.
// Example: 'casabe-xpress'
const TENANT_ID = process.env.SMOKE_TENANT_ID || 'casabe-xpress';

// OFFICE_ID: Must be a real UUID from the offices table.
// Delta preflight step 7 must confirm this value.
// If no offices exist yet, use the sentinel and document it.
const OFFICE_ID = process.env.SMOKE_OFFICE_ID || 'SMOKE-OFFICE-SENTINEL';
// NOTE: If SMOKE_OFFICE_ID is the sentinel string above, the members insert
// will use NULL for office_id on the office account and log a warning.
// Delta must resolve this before the office account will pass RLS checks.

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('');
  console.error('ERROR: Required environment variables not set.');
  console.error('  SUPABASE_URL            — e.g. https://exayifxbqduhsxmmsnxr.supabase.co');
  console.error('  SUPABASE_SERVICE_ROLE_KEY — from Supabase dashboard > Settings > API');
  console.error('');
  console.error('Optional:');
  console.error('  SMOKE_TENANT_ID   — default: casabe-xpress');
  console.error('  SMOKE_OFFICE_ID   — real UUID from offices table (Delta preflight step 7)');
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
// ACCOUNT DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Both `role` and `app_role` must be written to every members row.
 * The app login reads `members.role` directly; the RLS helper uses
 * COALESCE(app_role, role). Omitting either column breaks login or RLS.
 * Both columns receive the same value on every insert.
 */
const ROLE_COLUMN = 'role';
const APP_ROLE_COLUMN = 'app_role';

const ACCOUNTS = [
  {
    email: 'smoke-hq@casabe-test.internal',
    role: 'hq',
    displayName: 'Smoke HQ',
    officeId: null,        // HQ has no office affiliation
    label: 'HQ',
  },
  {
    email: 'smoke-office@casabe-test.internal',
    role: 'office',
    displayName: 'Smoke Office',
    officeId: OFFICE_ID === 'SMOKE-OFFICE-SENTINEL' ? null : OFFICE_ID,
    label: 'OFFICE',
    officeSentinel: OFFICE_ID === 'SMOKE-OFFICE-SENTINEL',
  },
  {
    email: 'smoke-driver-a@casabe-test.internal',
    role: 'driver',
    displayName: 'Smoke Driver A',
    officeId: null,
    label: 'DRIVER-A',
  },
  {
    email: 'smoke-driver-b@casabe-test.internal',
    role: 'driver',
    displayName: 'Smoke Driver B',
    officeId: null,
    label: 'DRIVER-B',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a cryptographically random 32-character hex password. */
function generatePassword() {
  return crypto.randomBytes(16).toString('hex');
}

/** Sleep helper for rate-limit courtesy between API calls. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pre-run stale account cleanup.
 *
 * Strategy: deleteUser() rather than ON CONFLICT upsert.
 * Rationale: We need a fresh auth.users row (new UUID + identity) on
 * each smoke run so that session tokens don't carry over between runs.
 * A members ON CONFLICT upsert alone would leave a stale auth identity
 * that could cause login surprises. deleteUser() + recreate is cleaner
 * and ensures a fully fresh state.
 *
 * Side effect: members.user_id FK is ON DELETE CASCADE, so deleting
 * the auth.users row also removes the stale members row automatically.
 * No separate members cleanup needed.
 *
 * @param {string} email
 * @returns {Promise<{deleted: boolean, userId: string|null}>}
 */
async function deleteStaleAccountIfExists(email) {
  // Supabase Admin API does not support lookup by email directly,
  // but listUsers() accepts a filter. We page through to find the match.
  const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });

  if (listError) {
    // Non-fatal: log and continue; createUser will surface the duplicate error
    console.warn(`  ⚠️  Could not list auth.users to check for stale account: ${listError.message}`);
    return { deleted: false, userId: null };
  }

  const existingUser = (listData.users || []).find(
    (u) => u.email && u.email.toLowerCase() === email.toLowerCase()
  );

  if (!existingUser) {
    return { deleted: false, userId: null };
  }

  console.log(`  🗑️  Stale account found: ${email} (id: ${existingUser.id})`);
  console.log(`     Deleting stale auth.users record (members row will cascade)...`);

  const { error: deleteError } = await supabase.auth.admin.deleteUser(existingUser.id);
  if (deleteError) {
    console.error(`  ❌ Failed to delete stale account ${email}: ${deleteError.message}`);
    // Return the id anyway — createUser will fail and surface the error properly
    return { deleted: false, userId: existingUser.id };
  }

  console.log(`  ✅ Stale account deleted: ${email}`);
  // Brief pause to let the cascade propagate before inserting a fresh row
  await sleep(200);
  return { deleted: true, userId: existingUser.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  Casabe Konnect — Smoke Account Setup');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`  Supabase URL : ${SUPABASE_URL}`);
  console.log(`  Tenant ID    : ${TENANT_ID}`);
  console.log(`  Office ID    : ${OFFICE_ID}`);
  console.log(`  Role column  : ${ROLE_COLUMN}`);
  console.log('');

  if (OFFICE_ID === 'SMOKE-OFFICE-SENTINEL') {
    console.warn('  ⚠️  WARNING: SMOKE_OFFICE_ID not set. Office account members row');
    console.warn('     will have office_id = NULL. RLS visibility may be broken.');
    console.warn('     Run Delta preflight step 7 to resolve a real office_id.');
    console.warn('');
  }

  const credentials = [];
  const errors = [];

  for (const account of ACCOUNTS) {
    console.log(`──────────────────────────────────────────`);
    console.log(`  Creating: ${account.email}  [${account.label}]`);

    // ── Step 0: Pre-run stale account cleanup ──
    // If a smoke account with this email already exists from a prior run,
    // delete it (+ cascading members row) before recreating fresh.
    // See deleteStaleAccountIfExists() for rationale on deleteUser vs upsert.
    await deleteStaleAccountIfExists(account.email);

    // ── Step 1: Generate random password ──
    const password = generatePassword();

    // ── Step 2: Create Auth user via Admin API ──
    // This creates the auth.users + auth.identities records correctly.
    // Direct SQL INSERT into auth.users does NOT create identity records
    // and WILL break password login — hence this approach.
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,  // Skip email verification; this is a smoke account
      user_metadata: {
        display_name: account.displayName,
        smoke_test: true,
      },
    });

    if (authError) {
      // Check if this is a duplicate — give a clear message
      // (Should not happen after deleteStaleAccountIfExists(), but guard defensively)
      if (authError.message && authError.message.toLowerCase().includes('already registered')) {
        console.error(`  ❌ DUPLICATE: ${account.email} still exists after stale cleanup attempt.`);
        console.error(`     Stale user deletion may have failed. Delete manually and re-run.`);
      } else {
        console.error(`  ❌ Auth createUser failed: ${authError.message}`);
      }
      errors.push({ email: account.email, step: 'createUser', error: authError.message });
      continue;
    }

    const userId = authData.user.id;
    console.log(`  ✅ Auth user created: ${userId}`);

    // ── Step 3: Insert members row ──
    // Uses the UUID returned by createUser — not a guessed or hardcoded value.
    // Both `role` and `app_role` are always written so that:
    //   • app login (reads members.role) works
    //   • RLS helper COALESCE(app_role, role) resolves correctly
    const membersRow = {
      user_id: userId,
      tenant_id: TENANT_ID,
      [ROLE_COLUMN]: account.role,
      [APP_ROLE_COLUMN]: account.role,
      display_name: account.displayName,
      active: true,
      metadata: {},  // NOT NULL column — required by R1 schema
    };

    // Only set office_id if this role needs it and we have a real value
    if (account.officeId) {
      membersRow.office_id = account.officeId;
    }

    try {
      const { error: membersError } = await supabase
        .from('members')
        .insert(membersRow);

      if (membersError) {
        throw membersError;
      }
    } catch (membersError) {
      // ── ROLLBACK: Delete the Auth user to avoid an orphaned account ──
      console.error(`  ❌ members insert failed: ${membersError.message}`);
      console.error(`     Code: ${membersError.code} | Details: ${membersError.details || 'none'}`);
      console.error(`     Hint: ${membersError.hint || 'none'}`);
      console.error(`  🔄 Rolling back Auth user ${account.email} ...`);
      await supabase.auth.admin.deleteUser(userId);
      console.error(`  [ROLLBACK] Auth user ${account.email} deleted after members insert failure`);
      errors.push({ email: account.email, step: 'membersInsert', error: membersError.message });
      throw membersError;
    }

    if (true) {  // members insert succeeded (errors throw above)
      console.log(`  ✅ members row inserted (role: ${account.role}${account.officeId ? ', office_id: ' + account.officeId : ''})`);
      if (account.officeSentinel) {
        console.warn(`  ⚠️  office_id is NULL — preflight step 7 required`);
      }
    }

    credentials.push({
      label: account.label,
      email: account.email,
      password,
      userId,
      role: account.role,
    });

    // Brief pause between API calls (courtesy, not required)
    await sleep(300);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ONE-TIME CREDENTIAL SUMMARY — Print to stdout ONLY
  // ─────────────────────────────────────────────────────────────────────────

  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  ⚠️  ONE-TIME CREDENTIAL SUMMARY — DO NOT SAVE TO FILE');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  These passwords are generated fresh each run.');
  console.log('  Copy them to your password manager NOW.');
  console.log('  They are NOT stored anywhere and cannot be recovered.');
  console.log('');

  for (const cred of credentials) {
    console.log(`  [${cred.label}]`);
    console.log(`    Email    : ${cred.email}`);
    console.log(`    Password : ${cred.password}`);
    console.log(`    User ID  : ${cred.userId}`);
    console.log(`    Role     : ${cred.role}`);
    console.log('');
  }

  if (errors.length > 0) {
    console.log('════════════════════════════════════════════════════════════════');
    console.log(`  ❌ ERRORS ENCOUNTERED (${errors.length})`);
    console.log('════════════════════════════════════════════════════════════════');
    for (const err of errors) {
      console.log(`  • ${err.email} [${err.step}]: ${err.error}`);
    }
    console.log('');
    console.log('  Resolve errors above, clean up partial state,');
    console.log('  and re-run. Do not proceed to smoke test with');
    console.log('  incomplete account setup.');
    console.log('');
    process.exit(1);
  }

  console.log('════════════════════════════════════════════════════════════════');
  console.log('  ✅ All accounts created successfully.');
  console.log(`  Next: Run Delta preflight (DELTA-PREFLIGHT.md)`);
  console.log(`        Then create orders via HQ UI (HQ-ORDER-CREATION.md)`);
  console.log('════════════════════════════════════════════════════════════════');
  console.log('');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
