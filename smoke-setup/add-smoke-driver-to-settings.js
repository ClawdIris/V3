#!/usr/bin/env node
// SMOKE TEST ONLY — remove Smoke Driver A from tenant_settings after R1 testing completes
//
// Purpose: patch tenant_settings.main.data.drivers for the casabe-xpress tenant
// so that Smoke Driver A appears in the legacy tenant_settings blob.
// This is required because some older smoke scenarios fall back to tenant_settings
// if the members query returns no results (e.g. RLS not yet applied, dev env edge cases).
//
// Canonical Fix (already implemented in index.html):
//   The New Order driver selector now queries public.members directly.
//   Smoke Driver A's UUID appears in the dropdown as soon as the member row exists.
//   This script is an additional safety net / belt-and-suspenders for the smoke run.
//
// Usage:
//   SUPABASE_URL=<url> \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
//   SMOKE_DRIVER_A_UUID=<uuid> \
//   SMOKE_DRIVER_A_NAME="Smoke Driver A" \
//   node add-smoke-driver-to-settings.js

'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL            = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SMOKE_DRIVER_A_UUID     = process.env.SMOKE_DRIVER_A_UUID;
const SMOKE_DRIVER_A_NAME     = process.env.SMOKE_DRIVER_A_NAME || 'Smoke Driver A';
const TENANT_SLUG             = process.env.SMOKE_TENANT_SLUG   || 'casabe-xpress';

if (!SUPABASE_URL)             { console.error('ERROR: SUPABASE_URL not set');             process.exit(1); }
if (!SUPABASE_SERVICE_ROLE_KEY){ console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1); }
if (!SMOKE_DRIVER_A_UUID)      { console.error('ERROR: SMOKE_DRIVER_A_UUID not set');       process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log(`[add-smoke-driver-to-settings] tenant=${TENANT_SLUG}`);
  console.log(`[add-smoke-driver-to-settings] driver name="${SMOKE_DRIVER_A_NAME}" uuid=${SMOKE_DRIVER_A_UUID}`);

  // 1. Fetch current tenant_settings row
  const { data: rows, error: fetchErr } = await supabase
    .from('tenant_settings')
    .select('id, tenant_id, settings')
    .eq('tenant_id', TENANT_SLUG)
    .limit(1);

  if (fetchErr) {
    console.error('[add-smoke-driver-to-settings] fetch error:', fetchErr.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.error(`[add-smoke-driver-to-settings] no tenant_settings row found for tenant_id="${TENANT_SLUG}"`);
    process.exit(1);
  }

  const row = rows[0];
  console.log(`[add-smoke-driver-to-settings] found settings row id=${row.id}`);

  // 2. Parse the existing drivers list (structure: settings.main.data.drivers)
  const settings = row.settings || {};
  const main     = settings.main  || {};
  const data     = main.data      || {};
  const drivers  = Array.isArray(data.drivers) ? data.drivers : [];

  console.log(`[add-smoke-driver-to-settings] current drivers count: ${drivers.length}`);
  drivers.forEach((d, i) => console.log(`  [${i}]`, JSON.stringify(d)));

  // 3. Check if Smoke Driver A already exists (by uuid or name)
  const alreadyExists = drivers.some(
    d => d.user_id === SMOKE_DRIVER_A_UUID || d.name === SMOKE_DRIVER_A_NAME
  );

  if (alreadyExists) {
    console.log('[add-smoke-driver-to-settings] Smoke Driver A already present — no change needed.');
    process.exit(0);
  }

  // 4. Append Smoke Driver A
  // SMOKE TEST ONLY — remove Smoke Driver A from tenant_settings after R1 testing completes
  const newDriverEntry = {
    name:    SMOKE_DRIVER_A_NAME,
    user_id: SMOKE_DRIVER_A_UUID,
    active:  true,
    _smoke:  true   // marker: this entry was added by smoke setup — safe to purge post-test
  };

  const updatedDrivers = [...drivers, newDriverEntry];
  const updatedSettings = {
    ...settings,
    main: {
      ...main,
      data: {
        ...data,
        drivers: updatedDrivers
      }
    }
  };

  // 5. Write back
  const { error: upsertErr } = await supabase
    .from('tenant_settings')
    .update({ settings: updatedSettings })
    .eq('id', row.id);

  if (upsertErr) {
    console.error('[add-smoke-driver-to-settings] upsert error:', upsertErr.message);
    process.exit(1);
  }

  console.log(`[add-smoke-driver-to-settings] ✓ Smoke Driver A appended to tenant_settings.`);
  console.log(`[add-smoke-driver-to-settings] Updated drivers count: ${updatedDrivers.length}`);
  console.log('[add-smoke-driver-to-settings] REMINDER: remove this entry after R1 smoke testing completes.');
  // SMOKE TEST ONLY — remove Smoke Driver A from tenant_settings after R1 testing completes
}

main().catch(err => {
  console.error('[add-smoke-driver-to-settings] fatal:', err);
  process.exit(1);
});
