#!/usr/bin/env node
/*
 * Phase 1 live Supabase verifier.
 *
 * Read-only checks against the deployed Supabase REST API. This does not apply
 * migrations and does not write data. It proves whether the production schema
 * already contains the Phase 1 foundations that Phase 2/3 depend on.
 */

'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://exayifxbqduhsxmmsnxr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_vqS6u4BduAw6fYYaLP-2aA_gfETHuH1';

const checks = [
  {
    name: 'orders.pickup_location column',
    path: '/rest/v1/orders?select=id,pickup_location&limit=1',
    pass: (r) => r.ok
  },
  {
    name: 'public.box_orders table',
    path: '/rest/v1/box_orders?select=id,order_id,office_id,driver_id,status,created_at&limit=1',
    pass: (r) => r.ok
  },
  {
    name: 'public.activity_log table',
    path: '/rest/v1/activity_log?select=id,order_id,box_id,user_id,activity_type,action,created_at&limit=1',
    pass: (r) => r.ok
  },
  {
    name: 'control: public.offices reachable',
    path: '/rest/v1/offices?select=id,name,tenant_id&limit=1',
    pass: (r) => r.ok
  }
];

async function request(path) {
  const res = await fetch(SUPABASE_URL + path, {
    headers: {
      apikey: SUPABASE_KEY,
      authorization: 'Bearer ' + SUPABASE_KEY,
      accept: 'application/json',
      prefer: 'count=exact'
    }
  });

  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch (_) {
    body = text.slice(0, 500);
  }

  return {
    ok: res.ok,
    status: res.status,
    contentRange: res.headers.get('content-range'),
    body
  };
}

(async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  PHASE 1 LIVE SUPABASE VERIFIER (READ ONLY)');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('Project:', SUPABASE_URL);

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const check of checks) {
    const result = await request(check.path);
    const ok = check.pass(result);
    if (ok) {
      passed += 1;
      console.log('  ✓', check.name, `(HTTP ${result.status})`);
    } else {
      failed += 1;
      failures.push({ check, result });
      console.log('  ✗', check.name, `(HTTP ${result.status})`);
      if (result.body && typeof result.body === 'object') {
        console.log('    ', result.body.code || '', result.body.message || JSON.stringify(result.body));
      } else {
        console.log('    ', String(result.body).slice(0, 180));
      }
    }
  }

  console.log('\nSummary:', `${passed}/${passed + failed} passed`);

  if (failures.length) {
    console.log('\nLive Phase 1 is NOT applied/verified. Do not run Phase 2/3 production smoke against this database yet.');
    process.exit(1);
  }

  console.log('\nLive Phase 1 foundations are present.');
})().catch(function(err) {
  console.error('Verifier failed:', err && err.stack ? err.stack : err);
  process.exit(2);
});
