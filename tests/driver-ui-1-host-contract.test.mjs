/* DRIVER-UI-1 — HOST CONTRACT regression tests.
   Executes the REAL index.html saveOrder and changeStatus function bodies,
   sliced out of the file by exact anchors and run with injected stubs.
   Nothing here touches a network, a database, Supabase, Stripe, Twilio or SMS:
   _db.upsert and _supabase.rpc are scripted in-memory promises and the only
   recorded side effects are pushes onto local arrays.

   These tests exist because the driver UI cannot be fixed by "awaiting the
   save": both host writers resolve on failure, so the tests pin down exactly
   what each one resolves in each outcome.

   Run: node --test tests/driver-ui-1-host-contract.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { extractHostFunction, _toConsumableArray } from "./helpers/driver-ui-1-harness.mjs";

const SAVE_SRC = extractHostFunction(
  "var saveOrder = useCallback(function (order) {",
  "}, [notify, orders, shipments]);"
);
/* the end anchor has to reach past the literal to be unique; trim it back off */
const DB_SRC = extractHostFunction("var _db = {", "\n};\nvar LoginScreen =")
  .replace(/var LoginScreen\s*=\s*$/, "");
const STATUS_SRC = extractHostFunction(
  "var changeStatus = useCallback(function (id, newStatus, newDriver, reason, newDriverUserId, boxSubId, reasonCode, reasonNote) {",
  "}, [dispatchCommittedStatusNotifications, notify, orders, roleKey, session]);"
);

/* Build the REAL _db from index.html against a scripted supabase chain.
   Nothing leaves the process: every from()/upsert()/select() is in-memory. */
function buildDb(script) {
  const log = { upserts: [], selects: [] };
  const chain = table => {
    const q = { table, filters: {} };
    q.upsert = (rows, opts) => { log.upserts.push({ table, rows, opts }); q._op = "upsert"; return q; };
    q.select = cols => { q._cols = cols; return q; };
    q.eq = (k, v) => { q.filters[k] = v; return q; };
    q.maybeSingle = () => {
      log.selects.push({ table, filters: q.filters });
      return Promise.resolve(script.readBack ? script.readBack(q) : { data: null, error: null });
    };
    /* an unterminated upsert().select() resolves like a PostgREST response */
    q.then = (res, rej) => Promise.resolve(
      q._op === "upsert"
        ? (script.upsert ? script.upsert(q) : { data: [{ id: q.rows_id, tenant_id: "T1" }], error: null })
        : { data: null, error: null }
    ).then(res, rej);
    return q;
  };
  const deps = {
    _supabase: { from: chain },
    normalizeOrderForUi: x => x,
    console: { error() {}, warn() {}, info() {}, log() {} }
  };
  const names = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  const factory = new Function(...names, DB_SRC + "\nreturn _db;");
  const db = factory(...names.map(n => deps[n]));
  db.init("T1");
  return { db, log };
}

function order(over) {
  return Object.assign({
    id: "ORD-1", name: "Ana", status: "ready_pickup",
    payment: { amount: 100, paid: 0, status: "unpaid" },
    boxes: [{ subId: "ORD-1-1", status: "ready_pickup" }],
    history: [], shipmentId: null
  }, over || {});
}

/* Build the real saveOrder with injected dependencies. */
function buildSaveOrder(opts) {
  const o = opts || {};
  const log = { notify: [], upserts: [], orders: null, rollbacks: 0, confirmed: 0, seq: [],
                setOrdersCalls: 0, setShipmentsCalls: 0, closedNewOrder: 0, closedEditOrder: 0 };
  const orders = o.orders || [order()];
  const deps = {
    useCallback: fn => fn,
    orders,
    shipments: o.shipments || [],
    tenant: o.tenant || {},
    session: o.session === undefined ? { tenantId: "T1" } : o.session,
    notify: m => log.notify.push(m),
    setShipments: () => { log.setShipmentsCalls++; },
    setOrders: fn => { log.setOrdersCalls++; log.rollbacks++; log.orders = typeof fn === "function" ? fn(orders) : fn; },
    setShowNewOrder: () => { log.closedNewOrder++; },
    setEditOrder: () => { log.closedEditOrder++; },
    setNewOrderConfirm: () => { log.confirmed++; },
    computeShipmentMetrics: () => ({ boxCount: 0, revenue: 0 }),
    getCommissionBoxes: () => [],
    AUTOMATION_RULES: [],
    today: () => "2026-09-20",
    now: () => "2026-09-20T00:00:00.000Z",
    _toConsumableArray,
    _db: {
      init() {},
      upsert(table, id, data) {
        log.upserts.push({ table, id, data });
        log.seq.push("upsert");
        return o.upsert ? o.upsert() : Promise.resolve();
      },
      upsertOrderReturning(id, data) {
        log.upserts.push({ table: "orders", id, data });
        log.seq.push("upsert");
        if (o.upsert) return o.upsert(id, data);
        /* default: a server that stored exactly what was sent */
        return Promise.resolve(Object.assign({}, data));
      }
    }
  };
  const names = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  const factory = new Function(...names, SAVE_SRC + "\nreturn saveOrder;");
  return { saveOrder: factory(...names.map(n => deps[n])), log };
}

/* Build the real changeStatus with injected dependencies. */
function buildChangeStatus(opts) {
  const o = opts || {};
  const log = { notify: [], rpc: [], orders: null, committed: [] };
  const orders = o.orders || [order()];
  const deps = {
    useCallback: fn => fn,
    orders,
    roleKey: o.roleKey === undefined ? "driver" : o.roleKey,
    session: o.session === undefined ? { tenantId: "T1" } : o.session,
    notify: m => log.notify.push(m),
    setOrders: fn => { log.orders = typeof fn === "function" ? fn(orders) : fn; },
    setBackwardGate: g => { log.backwardGate = g; },
    dispatchCommittedStatusNotifications: (c, s, b) => log.committed.push({ c, s, b }),
    normalizeOrderForUi: x => x,
    AUTOMATION_RULES: [],
    STATUS_CFG: { picked_up: { label: "Picked up" }, box_dropped_off: { label: "Box delivered" } },
    STATUS_FLOW: ["order_placed", "need_box", "box_dropped_off", "ready_pickup", "picked_up", "in_warehouse", "delivered"],
    now: () => "2026-09-20T00:00:00.000Z",
    _db: { init() {}, upsert() { return Promise.resolve(); } },
    _supabase: {
      rpc(name, args) {
        log.rpc.push({ name, args });
        return o.rpc ? o.rpc() : Promise.resolve({ data: { success: true, changed: true, order_data: {} } });
      }
    }
  };
  const names = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  const factory = new Function(...names, STATUS_SRC + "\nreturn changeStatus;");
  return { changeStatus: factory(...names.map(n => deps[n])), log };
}

/* ═════════════════ saveOrder — the payment writer ═════════════════ */

test("saveOrder resolves explicit persistence proof after the confirmed row comes back", async () => {
  let release;
  const row = order({ payment: { amount: 100, paid: 100, status: "paid" } });
  const gate = new Promise(r => { release = () => r(row); });
  const { saveOrder, log } = buildSaveOrder({ upsert: () => gate });
  const p = saveOrder(row);
  let settled = false;
  p.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, "must not resolve before the write lands");
  assert.equal(log.upserts.length, 1, "exactly one orders upsert");
  assert.equal(log.upserts[0].table, "orders");
  release();
  const res = await p;
  assert.equal(res.success, true);
  assert.equal(res.persisted, true, "persisted is the positive proof the driver UI gates on");
  assert.equal(res.confirmedRow.payment.paid, 100, "the SERVER's row is carried back, not a boolean");
});

test("saveOrder refuses to call an unconfirmable write persisted", async () => {
  const { saveOrder, log } = buildSaveOrder({ upsert: () => Promise.resolve(null) });
  const res = await saveOrder(order());
  assert.equal(res.persisted, false, "no confirmed row => not persisted");
  assert.equal(res.success, false);
  assert.equal(res.reason, "not_confirmed");
  assert.equal(res.confirmedRow, null);
  assert.equal(log.confirmed, 0, "no 'Order created' confirmation");
  assert.ok(log.rollbacks > 0, "the optimistic row is rolled back");
  assert.ok(log.notify.some(m => /did NOT save/.test(m)));
});

test("saveOrder carries the SERVER's row, not the object it was handed", async () => {
  /* a trigger clamps the recorded payment */
  const { saveOrder } = buildSaveOrder({
    upsert: (id, data) => Promise.resolve(Object.assign({}, data, {
      payment: { amount: 100, paid: 50, status: "deposit" }
    }))
  });
  const res = await saveOrder(order({ payment: { amount: 100, paid: 100, status: "paid" } }));
  assert.equal(res.persisted, true);
  assert.equal(res.confirmedRow.payment.paid, 50, "the confirmed row wins over the payload");
});

/* ═══════════ the real _db.upsertOrderReturning, against a stub PostgREST ═══════════ */

test("_db.upsertOrderReturning returns the server representation when the upsert yields one", async () => {
  const { db, log } = buildDb({
    upsert: () => ({ data: [{ id: "ORD-1", tenant_id: "T1", data: { id: "ORD-1", payment: { amount: 100, paid: 70 } }, office_id: null, partner_id: null, route_id: null, route_sequence: null }], error: null })
  });
  const row = await db.upsertOrderReturning("ORD-1", order(), "T1");
  assert.equal(row.payment.paid, 70, "server value, not the payload");
  assert.equal(log.upserts.length, 1);
  assert.equal(log.selects.length, 0, "no read-back");
});

/* PM rev 4: readable existence is NOT write confirmation. */
test("_db.upsertOrderReturning: zero-row write + EXISTING unchanged row => NOT confirmed, no read-back", async () => {
  /* the server applied nothing (RLS filtered the upsert), but the row exists
     and reads back perfectly well with its OLD payment */
  const { db, log } = buildDb({
    upsert: () => ({ data: [], error: null }),
    readBack: () => ({ data: { id: "ORD-1", tenant_id: "T1", data: { id: "ORD-1", status: "ready_pickup", payment: { amount: 100, paid: 0 } } }, error: null })
  });
  const row = await db.upsertOrderReturning("ORD-1", order({ status: "picked_up", payment: { amount: 100, paid: 100 } }), "T1");
  assert.equal(row, null, "an existing unchanged row must not be reported as this write");
  assert.equal(log.selects.length, 0, "no read-back is attempted at all — existence proves nothing");
});

test("_db.upsertOrderReturning resolves NULL on any zero-row write", async () => {
  const { db } = buildDb({ upsert: () => ({ data: [], error: null }) });
  assert.equal(await db.upsertOrderReturning("ORD-1", order(), "T1"), null, "a suppressed write is not a save");
});

test("saveOrder: a suppressed write over an existing row does NOT complete anything", async () => {
  /* through the real saveOrder: the writer resolves null => not persisted */
  const { saveOrder, log } = buildSaveOrder({ upsert: () => Promise.resolve(null) });
  const res = await saveOrder(order({ status: "picked_up", payment: { amount: 100, paid: 100 } }));
  assert.equal(res.persisted, false);
  assert.equal(res.confirmedRow, null);
  assert.equal(res.reason, "not_confirmed");
  assert.equal(log.confirmed, 0);
  assert.ok(log.rollbacks > 0, "the optimistic picked_up is rolled back");
});

test("_db.upsertOrderReturning captures the tenant at entry: a tenant switch mid-flight cannot alter the check", async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { db, log } = buildDb({
    upsert: () => gate.then(() => ({ data: [{ id: "ORD-1", tenant_id: "T1", data: { id: "ORD-1", payment: { amount: 100, paid: 100 } } }], error: null }))
  });
  const p = db.upsertOrderReturning("ORD-1", order(), "T1");
  db.init("T2");                       // the user switched tenant while the request was pending
  release();
  const row = await p;
  assert.equal(row.payment.paid, 100, "the row written under T1 is still accepted for T1");
  assert.equal(log.upserts[0].rows[0].tenant_id, "T1", "the request carried the captured tenant");
});

test("_db.upsertOrderReturning: after a tenant switch, a row from the NEW tenant is rejected for the old call", async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { db } = buildDb({
    upsert: () => gate.then(() => ({ data: [{ id: "ORD-1", tenant_id: "T2", data: { id: "ORD-1" } }], error: null }))
  });
  const p = db.upsertOrderReturning("ORD-1", order(), "T1");
  db.init("T2");                       // mutable _db._tenantId now says T2 — must not be consulted
  release();
  await assert.rejects(() => p, /row_mismatch/);
});

test("_db.upsertOrderReturning refuses to run without a tenant", async () => {
  const { db, log } = buildDb({});
  db.init(null);
  await assert.rejects(() => db.upsertOrderReturning("ORD-1", order()), /no_tenant/);
  assert.equal(log.upserts.length, 0, "no request is sent");
});

test("_db.upsertOrderReturning REJECTS a row for another id or tenant", async () => {
  const wrongId = buildDb({
    upsert: () => ({ data: [{ id: "ORD-OTHER", tenant_id: "T1", data: {} }], error: null })
  });
  await assert.rejects(() => wrongId.db.upsertOrderReturning("ORD-1", order()), /row_mismatch/);

  const wrongTenant = buildDb({
    upsert: () => ({ data: [{ id: "ORD-1", tenant_id: "T2", data: {} }], error: null })
  });
  await assert.rejects(() => wrongTenant.db.upsertOrderReturning("ORD-1", order()), /row_mismatch/);
});

test("_db.upsertOrderReturning REJECTS an ambiguous multi-row response", async () => {
  const { db } = buildDb({
    upsert: () => ({ data: [{ id: "ORD-1", tenant_id: "T1", data: {} }, { id: "ORD-1", tenant_id: "T1", data: {} }], error: null })
  });
  await assert.rejects(() => db.upsertOrderReturning("ORD-1", order()), /ambiguous/);
});

test("_db.upsertOrderReturning propagates a denied write", async () => {
  const { db } = buildDb({
    upsert: () => ({ data: null, error: { message: "new row violates row-level security policy" } })
  });
  /* supabase rejects with a plain error OBJECT, not an Error instance */
  await assert.rejects(
    () => db.upsertOrderReturning("ORD-1", order()),
    e => /row-level security/.test(e && e.message)
  );
});

test("saveOrder carries the collected payment payload through to the row it writes", async () => {
  const { saveOrder, log } = buildSaveOrder();
  await saveOrder(order({
    payment: { amount: 100, paid: 60, status: "deposit", method: "cash" },
    stopCompletion: { collected: 60, method: "Cash", owed: 40 }
  }));
  const written = log.upserts[0].data;
  assert.equal(written.payment.paid, 60);
  assert.equal(written.payment.method, "cash");
  assert.equal(written.payment.status, "deposit");
  assert.deepEqual(written.stopCompletion, { collected: 60, method: "Cash", owed: 40 });
});

test("saveOrder RESOLVES on a failed write and reports success:false (the trap)", async () => {
  const { saveOrder, log } = buildSaveOrder({
    upsert: () => Promise.reject(new Error("new row violates row-level security policy"))
  });
  const res = await saveOrder(order());          // resolves, does NOT reject
  assert.equal(res.success, false);
  assert.equal(res.persisted, false);
  assert.equal(res.reason, "write_failed");
  assert.match(res.error.message, /row-level security/);
  assert.ok(log.notify.some(m => /did NOT save/.test(m)), "host surfaces the failure");
  assert.ok(log.rollbacks > 0, "host rolls the optimistic row back");
});

test("saveOrder FAILS CLOSED without a tenant session — no write, no optimistic state, no success UI", async () => {
  const { saveOrder, log } = buildSaveOrder({ session: null });
  const res = await saveOrder(order());
  assert.equal(log.upserts.length, 0, "no database write is attempted");
  assert.equal(log.setOrdersCalls, 0, "no optimistic local order mutation");
  assert.equal(log.setShipmentsCalls, 0, "no shipment mutation");
  assert.equal(log.closedNewOrder, 0, "the new-order form is NOT closed");
  assert.equal(log.closedEditOrder, 0, "the edit form is NOT closed");
  assert.equal(log.confirmed, 0, "no 'Order created' confirmation");
  assert.ok(log.notify.every(m => !/updated|created/i.test(m)), "no success notification: " + JSON.stringify(log.notify));
  assert.ok(log.notify.some(m => /did NOT save/.test(m)), "the refusal is surfaced");
  assert.equal(res.success, false);
  assert.equal(res.persisted, false);
  assert.equal(res.reason, "no_session");
});

test("saveOrder with a session DOES run the normal success UI (the fail-closed guard is narrow)", async () => {
  const { saveOrder, log } = buildSaveOrder();
  const res = await saveOrder(order());
  assert.equal(res.persisted, true);
  assert.equal(log.upserts.length, 1);
  assert.equal(log.closedNewOrder, 1, "the form closes on a real persisted save");
  assert.ok(log.notify.some(m => /updated/.test(m)));
});

test("saveOrder rolls back and shows no success UI when the write is denied", async () => {
  const { saveOrder, log } = buildSaveOrder({
    upsert: () => Promise.reject(new Error("permission denied for table orders"))
  });
  const res = await saveOrder(order());
  assert.equal(res.persisted, false);
  assert.equal(log.confirmed, 0);
  assert.ok(log.notify.every(m => !/\u2713 Order/.test(m)), "no success confirmation");
  assert.ok(log.rollbacks > 0, "optimistic row rolled back");
});

/* ══════════════ changeStatus — the authorized driver RPC ══════════════ */

test("changeStatus driver path calls driver_update_order_status with no payment field", async () => {
  const { changeStatus, log } = buildChangeStatus();
  const res = await changeStatus("ORD-1", "picked_up", undefined, undefined, undefined, null, null, null);
  assert.equal(log.rpc.length, 1);
  assert.equal(log.rpc[0].name, "driver_update_order_status");
  assert.deepEqual(Object.keys(log.rpc[0].args).sort(),
    ["p_box_sub_id", "p_new_status", "p_order_id", "p_reason_code", "p_reason_note"]);
  assert.equal(res.success, true);
  assert.equal(res.changed, true);
});

test("changeStatus driver path: RPC error resolves success:false, never throws", async () => {
  const { changeStatus, log } = buildChangeStatus({
    rpc: () => Promise.resolve({ error: { code: "42501", message: "driver_status_denied" } })
  });
  const res = await changeStatus("ORD-1", "picked_up", undefined, undefined, undefined, null, null, null);
  assert.equal(res.success, false);
  assert.equal(res.changed, false);
  assert.ok(log.notify.some(m => /failed/i.test(m)));
  assert.equal(log.committed.length, 0, "no customer notification on a rejected call");
});

test("changeStatus driver path: payload success:false is a failure", async () => {
  const { changeStatus } = buildChangeStatus({
    rpc: () => Promise.resolve({ data: { success: false, changed: false } })
  });
  const res = await changeStatus("ORD-1", "picked_up", undefined, undefined, undefined, null, null, null);
  assert.equal(res.success, false);
});

test("changeStatus driver path: changed:false is the RPC's idempotent no-op", async () => {
  const { changeStatus, log } = buildChangeStatus({
    rpc: () => Promise.resolve({ data: { success: true, changed: false, order_data: {} } })
  });
  const res = await changeStatus("ORD-1", "picked_up", undefined, undefined, undefined, null, null, null);
  assert.equal(res.success, true);
  assert.equal(res.changed, false);
  assert.equal(log.committed.length, 0, "a no-op must not re-notify the customer");
  assert.equal(log.orders, null, "a no-op must not rewrite local orders");
});

test("changeStatus returns UNDEFINED from the backward-status gate (why success must be checked)", async () => {
  const { changeStatus, log } = buildChangeStatus({
    orders: [order({ status: "in_warehouse" })]
  });
  const res = changeStatus("ORD-1", "picked_up", undefined, undefined, undefined, null, null, null);
  assert.equal(res, undefined, "no promise at all — awaiting this resolves undefined");
  assert.ok(log.backwardGate, "the gate opened instead");
  assert.equal(log.rpc.length, 0, "nothing was written");
});

test("changeStatus driver path without a tenant session resolves success:false", async () => {
  const { changeStatus, log } = buildChangeStatus({ session: null });
  const res = await changeStatus("ORD-1", "picked_up", undefined, undefined, undefined, null, null, null);
  assert.equal(res.success, false);
  assert.equal(res.changed, false);
  assert.equal(log.rpc.length, 0);
});
