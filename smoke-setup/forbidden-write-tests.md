# Forbidden Write Tests — Post-Migration + RPC

**Scope:** Run after `orders-driver-rls-migration.sql` and `update-driver-status-rpc.sql` are applied.  
**Goal:** Confirm that drivers cannot directly write sensitive order fields, and that cross-driver / cross-tenant isolation holds.

Prerequisites:
- Smoke account Driver A: `driver_a@casabe-xpress.test` — assigned to SMOKE-001
- Smoke account Driver B: `driver_b@casabe-xpress.test` — NOT assigned to SMOKE-001
- SMOKE-001 must exist and be assigned to Driver A (via `assignedDriverUserId`)

---

## Test A — Driver cannot write payment field

**Threat:** Driver rewrites payment method or status to mark themselves as paid without collecting.

```js
// Logged in as Driver A (authenticated, driver role)
const { error } = await supabase
  .from('orders')
  .update({ data: { payment: { method: 'HACKED', status: 'paid' } } })
  .eq('id', 'SMOKE-001');

// Expected: error (RLS blocks — no driver UPDATE policy exists)
// error.code should be '42501' (insufficient_privilege) or equivalent
// data should be null / 0 rows affected
console.assert(error !== null, 'Test A FAILED: driver wrote payment field');
```

**Pass condition:** `error` is non-null. No rows updated.

---

## Test B — Driver cannot write assignment field

**Threat:** Driver reassigns themselves to more orders, or steals another driver's order.

```js
// Logged in as Driver A (authenticated, driver role)
const { error } = await supabase
  .from('orders')
  .update({ assignedDriver: 'HACKER', assignedDriverUserId: 'fake-uuid-0000-0000' })
  .eq('id', 'SMOKE-001');

// Expected: error (RLS blocks — no driver UPDATE policy)
console.assert(error !== null, 'Test B FAILED: driver wrote assignment field');
```

**Pass condition:** `error` is non-null. No rows updated.

---

## Test C — Driver cannot write customer data

**Threat:** Driver edits customer name, phone, or address to redirect a package.

```js
// Logged in as Driver A (authenticated, driver role)
const { error } = await supabase
  .from('orders')
  .update({ customerName: 'HACKED', phone: '+10000000000' })
  .eq('id', 'SMOKE-001');

// Expected: error (RLS blocks — no driver UPDATE policy)
console.assert(error !== null, 'Test C FAILED: driver wrote customer data');
```

**Pass condition:** `error` is non-null. No rows updated.

---

## Test D — Driver B cannot read Driver A's orders

**Threat:** Driver B queries orders they are not assigned to (broken `can_access_order` gate).

```js
// Logged in as Driver B (authenticated, driver role, NOT assigned to SMOKE-001)
const { data, error } = await supabase
  .from('orders')
  .select('id')
  .eq('id', 'SMOKE-001');

// Expected: data = [] (zero rows — orders_driver_select policy uses
// can_access_order() which checks assignedDriverUserId = auth.uid())
// error may be null (RLS silently filters, not an error)
console.assert(
  Array.isArray(data) && data.length === 0,
  'Test D FAILED: Driver B can read Driver A orders. Rows returned: ' + JSON.stringify(data)
);
```

**Pass condition:** `data` is an empty array (`[]`). No error required (RLS filters silently).

---

## Test E — Cross-tenant read blocked

**Threat:** A user from a different tenant reads casabe-xpress orders.

```js
// Logged in as any authenticated user whose tenant_id != 'casabe-xpress'
// (e.g. a user from 'other-tenant')
const { data, error } = await supabase
  .from('orders')
  .select('id');

// Expected: data = [] (is_member(tenant_id) returns false for every casabe-xpress row)
// error may be null (RLS silently filters)
console.assert(
  Array.isArray(data) && data.length === 0,
  'Test E FAILED: cross-tenant read returned rows: ' + JSON.stringify(data)
);
```

**Pass condition:** `data` is an empty array (`[]`).

---

## Test F — Status reloads correctly after RPC call

**Goal:** Confirm the RPC updates `data.status` inside the JSONB column and that a subsequent read returns the new status.

```js
// Logged in as Driver A, SMOKE-001 is in 'ready_pickup' state
const { data, error } = await supabase.rpc('update_driver_status', {
  p_order_id:   'SMOKE-001',
  p_new_status: 'in_warehouse'
});

// Expected: { success: true, order_id: 'SMOKE-001', new_status: 'in_warehouse' }
console.assert(!error,             'Test F FAILED: RPC threw error: ' + (error && error.message));
console.assert(data && data.success === true,        'Test F FAILED: unexpected RPC shape');
console.assert(data && data.new_status === 'in_warehouse', 'Test F FAILED: wrong new_status in response');

// Then verify the JSONB data column was actually updated:
const { data: order } = await supabase
  .from('orders')
  .select('data')
  .eq('id', 'SMOKE-001')
  .single();

console.assert(
  order && order.data && order.data.status === 'in_warehouse',
  'Test F FAILED: order.data.status not updated in DB. Got: ' + (order && order.data && order.data.status)
);
```

**Pass condition:** RPC returns `{ success: true, new_status: 'in_warehouse' }` AND a subsequent `SELECT data FROM orders WHERE id = 'SMOKE-001'` shows `data.status === 'in_warehouse'`.

**Note:** This test confirms the JSONB-path patch is working. The old top-level `status` column approach would have failed silently (no column exists); `data->>'status'` is the correct read path.

---

## Test G — RPC error reverts optimistic UI (no false local state)

**Goal:** Confirm that when the RPC throws an invalid-transition error, the driver UI does NOT update local state to the rejected status.

```js
// Precondition: SMOKE-001 is in 'in_warehouse' state (terminal for drivers).
// Logged in as Driver A. Attempt invalid transition: in_warehouse → need_box.
const { data, error } = await supabase.rpc('update_driver_status', {
  p_order_id:   'SMOKE-001',
  p_new_status: 'need_box'
});

// Expected: error thrown with message containing 'invalid transition: in_warehouse -> need_box'
console.assert(error !== null,  'Test G FAILED: RPC did not throw for invalid transition');
console.assert(
  error && error.message && error.message.includes('invalid transition'),
  'Test G FAILED: wrong error message. Got: ' + (error && error.message)
);

// UI must NOT have updated local state. Re-fetch to confirm DB is unchanged:
const { data: order } = await supabase
  .from('orders')
  .select('data')
  .eq('id', 'SMOKE-001')
  .single();

console.assert(
  order && order.data && order.data.status === 'in_warehouse',
  'Test G FAILED: DB status was mutated. Got: ' + (order && order.data && order.data.status)
);
```

**Pass condition:** RPC throws, error message contains `'invalid transition'`, and `order.data.status` remains `'in_warehouse'` (unchanged).

> **Test G requires that the driver UI calls `rpc('update_driver_status')` and only updates local state AFTER a successful response. If RPC throws, local state must not be mutated. This is enforced by the `catch` block in `index.html` — Delta must verify the catch is present at review.**

---

## Bonus — RPC happy path (confirm status update works)

After confirming the above 5 tests pass, verify the RPC works for its intended case:

```js
// Logged in as Driver A, SMOKE-001 in status 'ready_pickup'
const { data, error } = await supabase.rpc('update_driver_status', {
  p_order_id:   'SMOKE-001',
  p_new_status: 'in_warehouse'
});

// Expected: { success: true, order_id: 'SMOKE-001', new_status: 'in_warehouse' }
// Verify in pg: SELECT status FROM orders WHERE id = 'SMOKE-001';
console.assert(!error, 'RPC happy path FAILED: ' + (error && error.message));
console.assert(data && data.success === true, 'RPC returned unexpected shape');
```

---

## Notes

- Tests A–C confirm no driver UPDATE policy exists (the `orders_driver_update` policy was intentionally removed in this migration).
- Tests D–E confirm read isolation via `can_access_order()` and `is_member()`.
- All 5 tests must pass before R1 launch clearance.
- Run with real Supabase client using driver smoke account JWTs (not service role).
