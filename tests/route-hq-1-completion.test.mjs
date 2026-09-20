/* ROUTE-HQ-1 — the HQ sibling of DRIVER-UI-1, driven through the REAL surface.
   route-optimizer.js is executed as-is; window.RO is hydrated from props and
   RO.completePickup / RO.completeDrop are called exactly as the rendered
   buttons call them (onclick="RO.completePickup()"), with the module's own
   $("#id") lookups resolved by a stub DOM.

   LOCAL-MOCK ONLY: no browser, no network, no Supabase, no WhatsApp/SMS.
   window.open is recorded and can be made to return null, as a blocked popup
   does. This proves completion reporting and the shift-tally consequences, not
   real persistence.

   Run: node --test tests/route-hq-1-completion.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { loadRouteOptimizer, makeDom } from "./helpers/driver-ui-1-harness.mjs";

function order(over) {
  return Object.assign({
    id: "ORD-9", name: "Ana Diaz", phone: "+15551230000", status: "ready_pickup",
    assignedDriver: "Luis", boxType: "Medium", destination: "Santiago",
    address: "10 Main St", city: "Bronx", state: "NY", zip: "10467",
    payment: { amount: 100, paid: 0, status: "unpaid" },
    boxes: [{ subId: "ORD-9-1", status: "ready_pickup" }], history: []
  }, over || {});
}
function dropOrder(over) {
  return Object.assign(order(), { id: "ORD-8", name: "Box Co", status: "need_box" }, over || {});
}

/* Bring up the real HQ module with scripted writers and a stub DOM. */
function hq(opts = {}) {
  const env = loadRouteOptimizer();
  const dom = makeDom();
  const log = { save: [], toasts: [], notify: [] };
  const RO = env.window.RO;
  RO.props = {
    orders: opts.orders || [order()],
    driversList: [{ name: "Luis", userId: "u-1" }],
    notify: m => log.notify.push(m),
    onStatusChange: () => Promise.resolve({ success: true, changed: true }),
    onSave: row => {
      log.save.push(row);
      if (opts.onSave) return opts.onSave(row);
      /* the host resolves the SERVER's row; default models a server that stored
         exactly what was sent */
      return Promise.resolve({
        success: true, changed: true, persisted: true,
        confirmedRow: JSON.parse(JSON.stringify(row))
      });
    }
  };
  RO.pageEl = dom.root;
  /* a fresh shift session per test, so the cash tally assertions are isolated */
  RO.session = { completedTns: {}, completed: [], boxesOut: [] };
  RO.pendingReceipt = null;
  RO.hydrate();
  /* capture toasts: they land in #roToasts as appended children */
  const toasts = dom.el("#roToasts");
  return {
    env, dom, log, RO,
    get toasts() { return toasts.children.map(c => c.innerHTML); },
    get opened() { return env.opened; },
    setPopupBlocked(v) { env.setPopupBlocked(v); },
    /* fill the pickup form the way the real modal would */
    openPickup(tn) {
      RO.openStopAction(tn);
      dom.el("#sa_rname").value = "Ana Diaz";
      dom.el("#sa_dest").value = "Santiago";
      dom.el("#sa_collected").value = "100";
      dom.el("#sa_qty").value = "1";
      dom.el("#sa_box").value = "Medium";
      dom.el("#sa_rphone").value = "+15551230000";
      dom.el("#sa_receipt").classList.add("on");      // driver ticked "send receipt"
    },
    openDrop(tn) {
      RO.openStopAction(tn);
      dom.el("#sa_qty").value = "2";
      dom.el("#sa_box").value = "Medium";
      dom.el("#sa_note").value = "left with super";
    }
  };
}
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); };

/* ═══════════════════════ RO.completePickup ═══════════════════════ */

test("HQ pickup: a persisted write logs the stop, the shift tally and the receipt", async () => {
  const ui = hq();
  ui.openPickup("ORD-9");
  await ui.RO.completePickup();
  assert.equal(ui.log.save.length, 1, "one write");
  assert.equal(ui.log.save[0].payment.paid, 100, "money unchanged by this fix");
  assert.equal(ui.log.save[0].stopCompletion.collected, 100);
  assert.equal(ui.log.save[0].status, "picked_up");
  assert.equal(ui.RO.session.completed.length, 1, "shift tally credited");
  assert.equal(ui.RO.session.completed[0].collected, 100);
  assert.equal(ui.RO.session.completedTns["ORD-9"], 1);
  assert.equal(ui.opened.length, 1, "WhatsApp receipt issued");
  assert.ok(ui.toasts.some(t => /Pickup logged/.test(t)));
});

test("HQ pickup: a REJECTED write logs nothing — no receipt, no shift cash, stop stays open", async () => {
  const ui = hq({ onSave: () => Promise.reject(new Error("permission denied for table orders")) });
  ui.openPickup("ORD-9");
  await ui.RO.completePickup();
  await settle();
  assert.equal(ui.log.save.length, 1, "the write was attempted");
  assert.equal(ui.RO.session.completed.length, 0, "the shift cash tally is NOT inflated");
  assert.equal(ui.RO.session.completedTns["ORD-9"], undefined, "the stop is not struck off");
  assert.equal(ui.opened.length, 0, "no receipt for unrecorded money");
  assert.ok(ui.toasts.some(t => /NOT saved/.test(t)), JSON.stringify(ui.toasts));
  assert.ok(ui.toasts.every(t => !/Pickup logged/.test(t)), "no success toast");
});

test("HQ pickup: a writer that RESOLVES undefined is not persistence proof", async () => {
  const ui = hq({ onSave: () => Promise.resolve(undefined) });
  ui.openPickup("ORD-9");
  await ui.RO.completePickup();
  await settle();
  assert.equal(ui.RO.session.completed.length, 0);
  assert.equal(ui.opened.length, 0);
  assert.ok(ui.toasts.some(t => /NOT saved/.test(t)));
});

test("HQ pickup: success:true without persisted:true is not persistence proof", async () => {
  const ui = hq({ onSave: () => Promise.resolve({ success: true, changed: true }) });
  ui.openPickup("ORD-9");
  await ui.RO.completePickup();
  await settle();
  assert.equal(ui.RO.session.completed.length, 0);
  assert.equal(ui.opened.length, 0);
});

test("HQ pickup: a pending write stays pending — nothing is logged or shown", async () => {
  const ui = hq({ onSave: () => new Promise(() => {}) });
  ui.openPickup("ORD-9");
  ui.RO.completePickup();
  await settle();
  assert.equal(ui.RO.session.completed.length, 0);
  assert.equal(ui.opened.length, 0);
  assert.deepEqual(ui.toasts, []);
});

test("HQ pickup: a double submit writes once and credits the shift once", async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const ui = hq({
    onSave: row => gate.then(() => ({
      success: true, changed: true, persisted: true, confirmedRow: JSON.parse(JSON.stringify(row))
    }))
  });
  ui.openPickup("ORD-9");
  const p1 = ui.RO.completePickup();
  await settle();
  const p2 = ui.RO.completePickup();
  release();
  await Promise.all([p1, p2]);
  await settle();
  assert.equal(ui.log.save.length, 1, "exactly one write");
  assert.equal(ui.RO.session.completed.length, 1, "shift credited once");
  assert.equal(ui.opened.length, 1, "one receipt");
});

test("HQ pickup: the money reaching the writer is untouched by the fix", async () => {
  const ui = hq({ orders: [order({ payment: { amount: 100, paid: 25, status: "deposit" } })] });
  ui.openPickup("ORD-9");
  ui.dom.el("#sa_collected").value = "40";
  await ui.RO.completePickup();
  const w = ui.log.save[0];
  assert.equal(w.payment.paid, 65, "25 already paid + 40 collected");
  assert.equal(w.stopCompletion.collected, 40);
  assert.equal(w.stopCompletion.owed, 35, "due 75 - 40 collected");
  assert.equal(ui.RO.session.completed[0].owed, 35);
});

test("HQ pickup: a blocked receipt popup is not reported as sent and is parked for a tap", async () => {
  const ui = hq();
  ui.openPickup("ORD-9");
  ui.setPopupBlocked(true);
  await ui.RO.completePickup();
  assert.equal(ui.RO.session.completed.length, 1, "the write still stands");
  assert.ok(ui.toasts.some(t => /BLOCKED/.test(t) && /NOT been sent/.test(t)), JSON.stringify(ui.toasts));
  assert.ok(ui.toasts.every(t => !/receipt opened/.test(t)));
  assert.ok(ui.RO.pendingReceipt && ui.RO.pendingReceipt.tn === "ORD-9", "parked");
  assert.ok(ui.toasts.some(t => /RO.sendPendingReceipt\(\)/.test(t)), "an explicit action is offered");

  const url = ui.opened[0].url;
  ui.setPopupBlocked(false);
  assert.equal(ui.RO.sendPendingReceipt(), true, "the user gesture sends it");
  assert.equal(ui.opened.length, 2);
  assert.equal(ui.opened[1].url, url, "same receipt");
  assert.equal(ui.RO.pendingReceipt, null, "cleared once sent");
});

test("HQ pickup: a receipt still blocked on retry stays parked and offers the action again", async () => {
  const ui = hq();
  ui.openPickup("ORD-9");
  ui.setPopupBlocked(true);
  await ui.RO.completePickup();
  assert.equal(ui.RO.sendPendingReceipt(), false);
  assert.ok(ui.RO.pendingReceipt, "still parked");
  assert.ok(ui.toasts.some(t => /still blocked/i.test(t)));
});

test("HQ pickup: the incomplete-form guard still refuses before any write", async () => {
  const ui = hq();
  ui.RO.openStopAction("ORD-9");
  ui.dom.el("#sa_dest").value = "";           // recipient/destination missing
  ui.dom.el("#sa_rname").value = "";
  await ui.RO.completePickup();
  assert.equal(ui.log.save.length, 0, "no write attempted");
  assert.ok(ui.toasts.some(t => /Confirm where/.test(t)));
});

/* ══════ PM rev 3: HQ receipt figures obey the same proof rules ══════ */

test("HQ pickup: the receipt quotes the CONFIRMED row, not the local collected/owed state", async () => {
  const ui = hq({ orders: [order({ payment: { amount: 100, paid: 0, status: "unpaid" } })] });
  ui.openPickup("ORD-9");
  ui.dom.el("#sa_collected").value = "60";       // local owed would be 40
  await ui.RO.completePickup();
  assert.equal(ui.opened.length, 1);
  const url = decodeURIComponent(ui.opened[0].url);
  assert.match(url, /Paid today: \$60/);
  assert.match(url, /Remaining balance: \$40/, "derived from the confirmed row's own numbers");
});

test("HQ pickup: a server-ADJUSTED amount withholds the receipt", async () => {
  const ui = hq({
    onSave: row => Promise.resolve({
      success: true, changed: true, persisted: true,
      /* a trigger recorded 30 of the 100 entered */
      confirmedRow: Object.assign({}, row, { payment: { amount: 100, paid: 30, status: "deposit" } })
    })
  });
  ui.openPickup("ORD-9");
  await ui.RO.completePickup();
  assert.equal(ui.opened.length, 0, "no receipt quoting a figure the server did not confirm");
  assert.ok(ui.toasts.some(t => /NO receipt sent/.test(t)), JSON.stringify(ui.toasts));
  assert.equal(ui.RO.session.completed.length, 1, "the write itself still stands");
});

test("HQ pickup: a persisted write with NO confirmed row sends no receipt", async () => {
  const ui = hq({ onSave: () => Promise.resolve({ success: true, changed: true, persisted: true }) });
  ui.openPickup("ORD-9");
  await ui.RO.completePickup();
  assert.equal(ui.opened.length, 0);
  assert.ok(ui.toasts.some(t => /not confirmed by the server/.test(t)), JSON.stringify(ui.toasts));
});

test("HQ pickup: a malformed confirmed amount withholds the receipt instead of reading as $0", async () => {
  const ui = hq({
    onSave: row => Promise.resolve({
      success: true, changed: true, persisted: true,
      confirmedRow: Object.assign({}, row, { payment: { amount: "100oops", paid: "100oops" } })
    })
  });
  ui.openPickup("ORD-9");
  await ui.RO.completePickup();
  assert.equal(ui.opened.length, 0, "a numeric prefix is not an amount");
  assert.ok(ui.toasts.some(t => /NO receipt sent/.test(t)));
});

test("HQ pickup: 'Already paid' still requires the confirmed row to agree", async () => {
  const ui = hq({ orders: [order({ payment: { amount: 100, paid: 0, status: "unpaid" } })] });
  ui.openPickup("ORD-9");
  ui.RO.saSetMethod("Already paid");
  await ui.RO.completePickup();
  /* nothing was collected and the confirmed row still owes 100: the receipt may
     state that balance, but every figure on it is the server's */
  if (ui.opened.length) {
    const url = decodeURIComponent(ui.opened[0].url);
    assert.match(url, /Remaining balance: \$100/);
  } else {
    assert.ok(ui.toasts.some(t => /NO receipt sent/.test(t)));
  }
});

/* ═══════════════════════ RO.completeDrop ═══════════════════════ */

test("HQ drop-off: a persisted write logs the stop", async () => {
  const ui = hq({ orders: [dropOrder()] });
  ui.openDrop("ORD-8");
  await ui.RO.completeDrop();
  assert.equal(ui.log.save.length, 1);
  assert.equal(ui.log.save[0].status, "box_dropped_off");
  assert.equal(ui.RO.session.completed.length, 1);
  assert.equal(ui.opened.length, 0, "a drop-off never opens a receipt");
  assert.ok(ui.toasts.some(t => /Box dropped/.test(t)));
});

test("HQ drop-off: a rejected write logs nothing and says so", async () => {
  const ui = hq({ orders: [dropOrder()], onSave: () => Promise.reject(new Error("RLS")) });
  ui.openDrop("ORD-8");
  await ui.RO.completeDrop();
  await settle();
  assert.equal(ui.RO.session.completed.length, 0);
  assert.equal(ui.RO.session.boxesOut.length, 0, "no phantom Boxes Out entry");
  assert.ok(ui.toasts.some(t => /NOT saved/.test(t)));
  assert.ok(ui.toasts.every(t => !/Box dropped/.test(t)));
});

test("HQ drop-off: a double submit writes once", async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const ui = hq({
    orders: [dropOrder()],
    onSave: row => gate.then(() => ({
      success: true, changed: true, persisted: true, confirmedRow: JSON.parse(JSON.stringify(row))
    }))
  });
  ui.openDrop("ORD-8");
  const p1 = ui.RO.completeDrop();
  await settle();
  const p2 = ui.RO.completeDrop();
  release();
  await Promise.all([p1, p2]);
  await settle();
  assert.equal(ui.log.save.length, 1);
  assert.equal(ui.RO.session.completed.length, 1);
});
