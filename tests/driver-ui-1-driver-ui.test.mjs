/* DRIVER-UI-1 — DRIVER UI regression tests against the REAL component.
   route-optimizer.js is executed as-is in a vm sandbox and window.DriverRouteLite
   is rendered with a minimal React shim, then driven through its OWN buttons —
   so all three real callers (Already paid / Confirm collect / Box delivered) are
   exercised, not an extracted copy of completeStop.

   LOCAL-MOCK ONLY. window.open is recorded, never performed; there is no
   network, no Supabase, no WhatsApp, no SMS, no database. This proves control
   flow and the host result contract. It does NOT prove real persistence,
   RLS behaviour or a genuine page reload — those stay staged for an approved
   target run.

   Run: node --test tests/driver-ui-1-driver-ui.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { loadRouteOptimizer, buttons, walk } from "./helpers/driver-ui-1-harness.mjs";

const unhandled = [];
process.on("unhandledRejection", r => unhandled.push(r));

function pickupOrder(over) {
  return Object.assign({
    id: "ORD-1", name: "Ana Diaz", phone: "+15551230000", status: "ready_pickup",
    assignedDriver: "Luis", boxType: "Medium", destination: "Santiago",
    address: "10 Main St", city: "Bronx", state: "NY", zip: "10467",
    payment: { amount: 100, paid: 0, status: "unpaid" },
    boxes: [{ subId: "ORD-1-1", status: "ready_pickup" }], history: []
  }, over || {});
}
function paidOrder(over) {
  return Object.assign(pickupOrder(), { payment: { amount: 100, paid: 100, status: "paid" } }, over || {});
}
function dropBoxOrder(over) {
  return Object.assign(pickupOrder(), { id: "ORD-2", name: "Box Co", status: "need_box" }, over || {});
}

/* Mount the real DriverRouteLite with scripted host writers. */
function mount(opts) {
  const o = opts || {};
  const env = loadRouteOptimizer();
  const log = { notify: [], save: [], status: [], seq: [] };
  const props = {
    orders: o.orders || [pickupOrder()],
    driverName: "Luis",
    notify: m => { log.notify.push(m); log.seq.push("notify"); },
    onSave: order => {
      log.save.push(order);
      log.seq.push("save");
      if (o.onSave) return o.onSave(order);
      /* the host resolves the SERVER's row; the default models a server that
         stored exactly what was sent */
      return Promise.resolve({
        success: true, changed: true, persisted: true,
        confirmedRow: JSON.parse(JSON.stringify(order))
      });
    },
    onStatusChange: (...args) => {
      log.status.push(args);
      log.seq.push("status");
      if (o.onStatusChange) return o.onStatusChange(...args);
      /* The real RPC returns the committed row in order_data; the driver UI reads
         its payment to decide whether a PAID receipt is justified. */
      const row = (props.orders || []).find(x => x.id === args[0]) || null;
      return Promise.resolve({ success: true, changed: true, order_data: row });
    }
  };
  env.react.mount(env.DriverRouteLite, props);
  const api = {
    env, log, props,
    setPopupBlocked(v) { env.setPopupBlocked(v); },
    get tree() { return env.react.tree; },
    get opened() { return env.opened; },
    btn(text) {
      const hit = buttons(env.react.tree).filter(b => b.label === text);
      if (hit.length !== 1) {
        throw new Error(`expected 1 button labelled "${text}", found ${hit.length}: ` +
          JSON.stringify(buttons(env.react.tree).map(b => b.label)));
      }
      return hit[0];
    },
    btnContaining(text) {
      const hit = buttons(env.react.tree).filter(b => b.label.includes(text));
      if (hit.length !== 1) {
        throw new Error(`expected 1 button containing "${text}", found ${hit.length}: ` +
          JSON.stringify(buttons(env.react.tree).map(b => b.label)));
      }
      return hit[0];
    },
    input() {
      const hit = walk(env.react.tree).filter(n => n.type === "input");
      assert.equal(hit.length, 1, "exactly one amount input while collecting");
      return hit[0];
    },
    type(value) { this.input().props.onChange({ target: { value: String(value) } }); }
  };
  return api;
}
/* The component's onClick wrappers discard the promise (as real DOM handlers
   do), so every interaction is followed by a full macrotask drain. */
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); };
async function tap(btn) {
  if (btn.props.disabled) throw new Error(`button "${btn.label}" is disabled`);
  btn.props.onClick();
  await settle();
}
function click(btn) {
  if (btn.props.disabled) throw new Error(`button "${btn.label}" is disabled`);
  return btn.props.onClick();
}

/* ═══════════════════ alreadyPaid — status-only caller ═══════════════════ */

test("Already paid uses the authorized status RPC path, never the orders writer", async () => {
  const ui = mount({ orders: [paidOrder()] });
  await tap(ui.btnContaining("Already paid"));
  assert.equal(ui.log.status.length, 1, "one onStatusChange call");
  assert.equal(ui.log.save.length, 0, "props.onSave is NOT used for a status-only stop");
  const [id, status, driver, reason, driverUserId, boxSubId, reasonCode, reasonNote] = ui.log.status[0];
  assert.equal(id, "ORD-1");
  assert.equal(status, "picked_up");
  assert.equal(driver, undefined, "driver assignment must not be touched");
  assert.equal(reason, undefined);
  assert.equal(driverUserId, undefined);
  assert.equal(boxSubId, null, "order-level stop: every box moves together");
  assert.equal(reasonCode, null, "the RPC rejects a reason on picked_up");
  assert.equal(reasonNote, null);
  assert.equal(ui.opened.length, 1, "exactly one receipt");
  assert.match(ui.opened[0].url, /^https:\/\/wa\.me\//);
  assert.ok(ui.log.notify.some(m => m.includes("picked up")));
  assert.deepEqual(ui.log.seq, ["status", "notify"], "receipt/notify strictly after the write resolved");
});

test("Already paid: a pending write leaves the stop pending — no receipt, no notify, button disabled", async () => {
  const ui = mount({ onStatusChange: () => new Promise(() => {}) });
  click(ui.btnContaining("Already paid"));
  await settle();
  assert.equal(ui.opened.length, 0, "no receipt while the write is outstanding");
  assert.equal(ui.log.notify.length, 0, "no success message while pending");
  assert.equal(ui.btnContaining("Saving").props.disabled, true, "action is disabled while pending");
});

test("Already paid: a rejected write surfaces failure, opens no receipt and leaks no unhandled rejection", async () => {
  const before = unhandled.length;
  const ui = mount({ onStatusChange: () => Promise.reject(new Error("driver_status_denied")) });
  await tap(ui.btnContaining("Already paid"));
  await settle();
  assert.equal(ui.opened.length, 0);
  assert.ok(ui.log.notify.some(m => /NOT saved/.test(m)), "failure is surfaced to the driver");
  assert.ok(ui.log.notify.every(m => !m.includes("✅")), "no success message");
  assert.equal(unhandled.length, before, "no unhandled rejection");
});

test("Already paid: a resolved failure result is a failure, not a success", async () => {
  const ui = mount({ onStatusChange: () => Promise.resolve({ success: false, changed: false }) });
  await tap(ui.btnContaining("Already paid"));
  assert.equal(ui.opened.length, 0);
  assert.ok(ui.log.notify.some(m => /NOT saved/.test(m)));
});

test("Already paid: undefined (the host backward-status gate) is a failure, not a success", async () => {
  const ui = mount({ onStatusChange: () => undefined });
  await tap(ui.btnContaining("Already paid"));
  await settle();
  assert.equal(ui.opened.length, 0, "awaiting undefined must not produce a receipt");
  assert.ok(ui.log.notify.some(m => /NOT saved/.test(m)));
});

test("Already paid: the RPC no-op (changed:false) sends no receipt and no success", async () => {
  const ui = mount({ onStatusChange: () => Promise.resolve({ success: true, changed: false }) });
  await tap(ui.btnContaining("Already paid"));
  assert.equal(ui.opened.length, 0, "an idempotent no-op must not re-issue a receipt");
  assert.ok(ui.log.notify.some(m => /nothing changed/.test(m)));
  assert.ok(ui.log.notify.every(m => !m.includes("✅")));
});

test("Already paid: a second tap while in flight issues exactly ONE write and ONE receipt", async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const ui = mount({
    orders: [paidOrder()],
    onStatusChange: () => gate.then(() => ({ success: true, changed: true, order_data: paidOrder() }))
  });
  const first = ui.btnContaining("Already paid");
  const p1 = first.props.onClick();
  await settle();
  assert.equal(ui.btnContaining("Saving").props.disabled, true, "UI blocks the second tap");
  const p2 = first.props.onClick();            // stale handler, as a real double-tap would be
  release();
  await Promise.all([p1, p2]);
  await settle();
  assert.equal(ui.log.status.length, 1, "exactly one write reached the host");
  assert.equal(ui.opened.length, 1, "exactly one receipt");
});

/* ══════ PM review (1): a completed status is NOT proof of payment ══════ */

test("Already paid on an UNPAID order: status change succeeds, paid receipt is WITHHELD", async () => {
  const ui = mount({ orders: [pickupOrder()] });        // amount 100, paid 0
  await tap(ui.btnContaining("Already paid"));
  assert.equal(ui.log.status.length, 1, "the status change was issued");
  assert.equal(ui.log.status[0][1], "picked_up");
  assert.equal(ui.opened.length, 0, "NO paid receipt for an outstanding balance");
  assert.ok(ui.log.notify.some(m => /picked up/.test(m)), "the pickup is still confirmed");
  assert.ok(ui.log.notify.some(m => /\$100 outstanding/.test(m)), "the balance is reported: " + JSON.stringify(ui.log.notify));
  assert.ok(ui.log.notify.some(m => /NO paid receipt/.test(m)));
});

test("Already paid on a partially paid order: paid receipt is WITHHELD for the remainder", async () => {
  const ui = mount({ orders: [pickupOrder({ payment: { amount: 100, paid: 60, status: "deposit" } })] });
  await tap(ui.btnContaining("Already paid"));
  assert.equal(ui.opened.length, 0);
  assert.ok(ui.log.notify.some(m => /\$40 outstanding/.test(m)), JSON.stringify(ui.log.notify));
});

test("Already paid: no confirmed row at all fails CLOSED (no receipt, no claim)", async () => {
  const ui = mount({
    orders: [paidOrder()],
    onStatusChange: () => Promise.resolve({ success: true, changed: true })   // no order_data
  });
  await tap(ui.btnContaining("Already paid"));
  assert.equal(ui.opened.length, 0, "unconfirmed payment must not produce a paid receipt");
  assert.ok(ui.log.notify.some(m => /not confirmed by the server/.test(m)), JSON.stringify(ui.log.notify));
});

/* ═══ PM rev 3: strict money parsing, and the CONFIRMED row as the only proof ═══ */

const MALFORMED = [
  ["a numeric prefix", "100oops"],
  ["Infinity (string)", "Infinity"],
  ["Infinity (number)", Infinity],
  ["NaN", NaN],
  ["a negative total", -100],
  ["a negative string", "-100"],
  ["exponent notation", "1e2"],
  ["three decimals", "100.005"],
  ["leading whitespace", " 100"],
  ["a thousands separator", "1,000"],
  ["a currency symbol", "$100"],
  ["an empty string", ""],
  ["null", null],
  ["a boolean", true],
  ["an object", { v: 100 }],
  ["an array", [100]]
];

for (const [label, amount] of MALFORMED) {
  test(`Already paid: ${label} as the confirmed amount fails CLOSED`, async () => {
    const ui = mount({
      orders: [paidOrder()],
      onStatusChange: () => Promise.resolve({
        success: true, changed: true,
        order_data: { payment: { amount: amount, paid: amount } }
      })
    });
    await tap(ui.btnContaining("Already paid"));
    assert.equal(ui.opened.length, 0, `"${String(amount)}" must never read as a settled balance`);
    assert.ok(ui.log.notify.some(m => /NO paid receipt was sent/.test(m)), JSON.stringify(ui.log.notify));
  });
}

test("Already paid: a malformed `paid` is not silently read as zero", async () => {
  const ui = mount({
    orders: [pickupOrder({ payment: { amount: 0, paid: 0 } })],
    onStatusChange: () => Promise.resolve({
      success: true, changed: true,
      order_data: { payment: { amount: 0, paid: "oops" } }
    })
  });
  await tap(ui.btnContaining("Already paid"));
  assert.equal(ui.opened.length, 0, "unreadable paid must not settle a zero-amount order");
});

test("Already paid: canonical decimal STRINGS are accepted (the documented form)", async () => {
  const ui = mount({
    orders: [pickupOrder({ payment: { amount: "100.00", paid: "100.00" } })],
    onStatusChange: () => Promise.resolve({
      success: true, changed: true,
      order_data: { payment: { amount: "100.00", paid: "100.00" } }
    })
  });
  await tap(ui.btnContaining("Already paid"));
  assert.equal(ui.opened.length, 1, "the documented string form must still work");
});

test("Confirm collect: the receipt figures come from the CONFIRMED row, not the payload", async () => {
  /* the client sent paid:100; the server stored 100 — the receipt must quote the
     server's numbers, and the URL carries them */
  const ui = mount();
  await tap(startCollect(ui, 100));
  assert.equal(ui.opened.length, 1);
  const url = decodeURIComponent(ui.opened[0].url);
  assert.match(url, /Paid today: \$100/);
  assert.match(url, /paid in full/);
});

test("Confirm collect: a server-ADJUSTED amount withholds the receipt instead of quoting the payload", async () => {
  const ui = mount({
    onSave: row => Promise.resolve({
      success: true, changed: true, persisted: true,
      /* a trigger clamped the credit to 50 of the 100 the driver entered */
      confirmedRow: Object.assign({}, row, { payment: { amount: 100, paid: 50, status: "deposit" } })
    })
  });
  await tap(startCollect(ui, 100));
  assert.equal(ui.opened.length, 0, "no receipt for a figure the server did not confirm");
  assert.ok(ui.log.notify.some(m => /\$100 recorded/.test(m)), "what the driver entered is still reported");
  assert.ok(ui.log.notify.some(m => /\$50 outstanding/.test(m)),
    "the SERVER's balance is quoted, not the payload's: " + JSON.stringify(ui.log.notify));
});

test("Confirm collect: a PARTIAL balance is quoted from the confirmed row, not local arithmetic", async () => {
  const ui = mount({
    /* local subtraction says 100 - 60 = 40; the server's row says 30 remains */
    onSave: row => Promise.resolve({
      success: true, changed: true, persisted: true,
      confirmedRow: Object.assign({}, row, { payment: { amount: 100, paid: 70, status: "deposit" } })
    })
  });
  await tap(startCollect(ui, 60));
  assert.equal(ui.opened.length, 0, "a partial collection is never a receipt");
  assert.ok(ui.log.notify.some(m => /balance \$30 on the saved order/.test(m)),
    "the server's balance, not $40: " + JSON.stringify(ui.log.notify));
});

test("Confirm collect: a partial whose confirmed balance is unreadable says so", async () => {
  const ui = mount({
    onSave: row => Promise.resolve({
      success: true, changed: true, persisted: true,
      confirmedRow: Object.assign({}, row, { payment: { amount: "oops", paid: 60 } })
    })
  });
  await tap(startCollect(ui, 60));
  assert.ok(ui.log.notify.some(m => /could not be confirmed on the saved order/.test(m)), JSON.stringify(ui.log.notify));
});

test("Confirm collect: a persisted write with NO confirmed row sends no receipt", async () => {
  const ui = mount({
    onSave: () => Promise.resolve({ success: true, changed: true, persisted: true })
  });
  await tap(startCollect(ui, 100));
  assert.equal(ui.opened.length, 0);
  assert.ok(ui.log.notify.some(m => /not confirmed by the server/.test(m)), JSON.stringify(ui.log.notify));
});

test("Confirm collect: a server row that settles MORE than asked still withholds (mismatch)", async () => {
  const ui = mount({
    onSave: row => Promise.resolve({
      success: true, changed: true, persisted: true,
      confirmedRow: Object.assign({}, row, { payment: { amount: 100, paid: 140, status: "paid" } })
    })
  });
  await tap(startCollect(ui, 100));
  assert.equal(ui.opened.length, 0, "an unexplained over-credit is not a receipt");
  assert.ok(ui.log.notify.some(m => /does not match/.test(m)));
});

test("Already paid: a confirmed settlement that this action did not cause is a MISMATCH", async () => {
  const ui = mount({
    orders: [pickupOrder()],   // local row shows 100 due; server shows paid 100
    onStatusChange: () => Promise.resolve({
      success: true, changed: true,
      /* settled, but `paid` moved by 100 while this action recorded 0 */
      order_data: { payment: { amount: 100, paid: 100, status: "paid" } }
    })
  });
  await tap(ui.btnContaining("Already paid"));
  assert.equal(ui.opened.length, 0, "a prepaid claim whose confirmed paid jumped by 100 is a mismatch, not proof");
  assert.ok(ui.log.notify.some(m => /does not match the amount recorded here/.test(m)), JSON.stringify(ui.log.notify));
  assert.ok(ui.log.notify.some(m => /picked up/.test(m)), "the pickup is still confirmed");
});

test("Already paid: a genuinely prepaid order (settled, unchanged by this action) DOES get the receipt", async () => {
  const ui = mount({
    orders: [paidOrder()],   // amount 100, paid 100 already
    onStatusChange: () => Promise.resolve({
      success: true, changed: true,
      order_data: { payment: { amount: 100, paid: 100, status: "paid" } }
    })
  });
  await tap(ui.btnContaining("Already paid"));
  assert.equal(ui.opened.length, 1, "settled and delta 0 — the one case that justifies a prepaid receipt");
  assert.ok(ui.log.notify.some(m => /receipt opened/.test(m)));
});

/* ══════ PM review (3): window.open after an async write can be blocked ══════ */

test("a blocked popup is never reported as a sent receipt", async () => {
  const ui = mount({ orders: [paidOrder()] });
  ui.setPopupBlocked(true);
  await tap(ui.btnContaining("Already paid"));
  assert.equal(ui.opened.length, 1, "the open was attempted");
  assert.ok(ui.log.notify.every(m => !/receipt opened/.test(m)), "no claim that the receipt was sent");
  assert.ok(ui.log.notify.some(m => /WhatsApp was blocked/.test(m)), JSON.stringify(ui.log.notify));
  assert.ok(ui.log.notify.some(m => /picked up/.test(m)), "the completion itself is still confirmed");
});

test("a blocked receipt is parked behind an explicit driver tap, and that tap sends it", async () => {
  const ui = mount({ orders: [paidOrder()] });
  ui.setPopupBlocked(true);
  await tap(ui.btnContaining("Already paid"));
  const send = ui.btn("🧾 Send receipt");
  assert.ok(send, "an explicit user-gesture action is offered");
  const firstUrl = ui.opened[0].url;
  ui.setPopupBlocked(false);                 // the driver allows pop-ups, then taps
  await tap(send);
  assert.equal(ui.opened.length, 2, "the receipt is re-issued from the gesture");
  assert.equal(ui.opened[1].url, firstUrl, "same receipt, not a regenerated one");
  assert.ok(ui.log.notify.some(m => /receipt opened in WhatsApp/.test(m)));
  assert.equal(buttons(ui.tree).filter(b => b.label === "🧾 Send receipt").length, 0, "the banner clears once sent");
});

test("a receipt still blocked on the retry stays parked and says so", async () => {
  const ui = mount({ orders: [paidOrder()] });
  ui.setPopupBlocked(true);
  await tap(ui.btnContaining("Already paid"));
  await tap(ui.btn("🧾 Send receipt"));
  assert.ok(ui.log.notify.some(m => /still blocked/.test(m)), JSON.stringify(ui.log.notify));
  assert.equal(buttons(ui.tree).filter(b => b.label === "🧾 Send receipt").length, 1, "still offered");
});

test("the blocked-receipt action survives the completed stop leaving the route list", async () => {
  const ui = mount({ orders: [paidOrder()] });
  ui.setPopupBlocked(true);
  await tap(ui.btnContaining("Already paid"));
  /* the host commits picked_up, so the stop drops out of the driver's list */
  ui.env.react.setProps(Object.assign({}, ui.props, { orders: [paidOrder({ status: "picked_up" })] }));
  assert.equal(buttons(ui.tree).filter(b => b.label.includes("Already paid")).length, 0, "stop is gone");
  assert.equal(buttons(ui.tree).filter(b => b.label === "🧾 Send receipt").length, 1,
    "the receipt action is page-level, so it is still reachable");
});

test("Confirm collect: a blocked popup does not claim the receipt was sent", async () => {
  const ui = mount();
  ui.setPopupBlocked(true);
  await tap(startCollect(ui, 100));
  assert.equal(ui.log.save.length, 1, "the payment was still written");
  assert.ok(ui.log.notify.some(m => /\$100 recorded/.test(m)), JSON.stringify(ui.log.notify));
  assert.ok(ui.log.notify.some(m => /WhatsApp was blocked/.test(m)));
  assert.ok(ui.log.notify.every(m => !/receipt opened/.test(m)));
  assert.equal(buttons(ui.tree).filter(b => b.label === "🧾 Send receipt").length, 1);
});

/* ═══════════════ confirmCollect — the payment-carrying caller ═══════════════ */

function startCollect(ui, amount) {
  click(ui.btnContaining("Collect"));
  ui.type(amount);
  return ui.btn("✓ Confirm");
}

test("Confirm collect keeps the payment payload on the pre-existing onSave path, intact", async () => {
  const ui = mount();
  await tap(startCollect(ui, 100));
  assert.equal(ui.log.save.length, 1, "payment goes to props.onSave");
  assert.equal(ui.log.status.length, 0, "payment must NEVER be routed through the status RPC");
  const w = ui.log.save[0];
  assert.equal(w.status, "picked_up");
  assert.equal(w.payment.paid, 100);
  assert.equal(w.payment.method, "cash");
  assert.equal(w.payment.status, "paid");
  assert.equal(w.stopCompletion.collected, 100);
  assert.equal(w.stopCompletion.method, "Cash");
  assert.equal(w.stopCompletion.owed, 0);
  assert.equal(w.stopCompletion.completedByDriver, "Luis");
  assert.equal(w.boxes[0].status, "picked_up");
  assert.match(w.history[w.history.length - 1].note, /collected \$100/);
});

test("Confirm collect: persisted success opens exactly one receipt and clears the form", async () => {
  const ui = mount();
  await tap(startCollect(ui, 100));
  assert.equal(ui.opened.length, 1);
  assert.ok(ui.log.notify.some(m => /paid in full/.test(m)));
  assert.deepEqual(ui.log.seq, ["save", "notify"], "receipt/notify strictly after the write resolved");
  assert.equal(walk(ui.tree).filter(n => n.type === "input").length, 0, "collect form closed on success");
});

test("Confirm collect: a denied write records NO receipt and keeps the amount for a retry", async () => {
  const ui = mount({
    onSave: () => Promise.resolve({ success: false, changed: false, persisted: false, reason: "write_failed" })
  });
  await tap(startCollect(ui, 100));
  await settle();
  assert.equal(ui.opened.length, 0, "no receipt for money the database did not record");
  assert.ok(ui.log.notify.some(m => /was NOT recorded/.test(m)));
  assert.ok(ui.log.notify.some(m => /Do not give a receipt/.test(m)));
  assert.equal(ui.input().props.value, "100", "the collected amount stays on screen to retry");
});

test("Confirm collect: a writer that resolves undefined is NOT persistence proof", async () => {
  const ui = mount({ onSave: () => Promise.resolve(undefined) });
  await tap(startCollect(ui, 100));
  await settle();
  assert.equal(ui.opened.length, 0, "resolved-undefined must never be read as a persisted save");
  assert.ok(ui.log.notify.some(m => /was NOT recorded/.test(m)));
});

test("Confirm collect: success:true without persisted:true is NOT persistence proof", async () => {
  const ui = mount({ onSave: () => Promise.resolve({ success: true, changed: true }) });
  await tap(startCollect(ui, 100));
  await settle();
  assert.equal(ui.opened.length, 0);
  assert.ok(ui.log.notify.some(m => /was NOT recorded/.test(m)));
});

test("Confirm collect: a rejected write surfaces failure and leaks no unhandled rejection", async () => {
  const before = unhandled.length;
  const ui = mount({ onSave: () => Promise.reject(new Error("row-level security")) });
  await tap(startCollect(ui, 100));
  await settle();
  assert.equal(ui.opened.length, 0);
  assert.ok(ui.log.notify.some(m => /was NOT recorded/.test(m)));
  assert.equal(unhandled.length, before);
});

test("Confirm collect: a partial payment persists the balance and sends NO receipt", async () => {
  const ui = mount();
  await tap(startCollect(ui, 40));
  assert.equal(ui.log.save.length, 1);
  assert.equal(ui.log.save[0].payment.paid, 40);
  assert.equal(ui.log.save[0].payment.status, "deposit");
  assert.equal(ui.log.save[0].stopCompletion.owed, 60);
  assert.equal(ui.opened.length, 0, "a partial collection is not a paid receipt");
  assert.ok(ui.log.notify.some(m => /balance \$60/.test(m)));
});

test("Confirm collect: a double submit writes the payment exactly once", async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const ui = mount({
    onSave: row => gate.then(() => ({
      success: true, changed: true, persisted: true, confirmedRow: JSON.parse(JSON.stringify(row))
    }))
  });
  const confirm = startCollect(ui, 100);
  const p1 = confirm.props.onClick();
  await settle();
  const p2 = confirm.props.onClick();
  release();
  await Promise.all([p1, p2]);
  await settle();
  assert.equal(ui.log.save.length, 1, "no double charge / double credit");
  assert.equal(ui.opened.length, 1, "no duplicate receipt");
});

/* ═══════════════════ boxDelivered — status-only caller ═══════════════════ */

test("Box delivered uses the status RPC, never a receipt", async () => {
  const ui = mount({ orders: [dropBoxOrder()] });
  await tap(ui.btnContaining("Box delivered"));
  assert.equal(ui.log.save.length, 0, "no orders write from a box drop-off");
  assert.equal(ui.log.status.length, 1);
  assert.equal(ui.log.status[0][0], "ORD-2");
  assert.equal(ui.log.status[0][1], "box_dropped_off");
  assert.equal(ui.log.status[0][5], null, "order-level");
  assert.equal(ui.opened.length, 0, "a box drop-off never opens a receipt");
  assert.ok(ui.log.notify.some(m => /box delivered/.test(m)));
  assert.deepEqual(ui.log.seq, ["status", "notify"]);
});

test("Box delivered: failure keeps the stop open and says so", async () => {
  const ui = mount({ orders: [dropBoxOrder()], onStatusChange: () => Promise.resolve({ success: false, changed: false }) });
  await tap(ui.btnContaining("Box delivered"));
  assert.ok(ui.log.notify.some(m => /NOT saved/.test(m)));
  assert.ok(ui.log.notify.every(m => !m.includes("📦 Box Co")));
});

test("Box delivered: the no-op result reports 'already recorded', not success", async () => {
  const ui = mount({ orders: [dropBoxOrder()], onStatusChange: () => Promise.resolve({ success: true, changed: false }) });
  await tap(ui.btnContaining("Box delivered"));
  assert.ok(ui.log.notify.some(m => /already recorded/.test(m)));
});

test("Box delivered: a second tap while in flight issues exactly ONE write", async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const ui = mount({ orders: [dropBoxOrder()], onStatusChange: () => gate.then(() => ({ success: true, changed: true })) });
  const b = ui.btnContaining("Box delivered");
  const p1 = b.props.onClick();
  await settle();
  const p2 = b.props.onClick();
  release();
  await Promise.all([p1, p2]);
  await settle();
  assert.equal(ui.log.status.length, 1);
});

/* ═══════════════════════════ cross-flow invariants ═══════════════════════════ */

test("no status-RPC call from any driver flow ever carries a payment payload", async () => {
  const flows = [
    async () => { const ui = mount(); await tap(ui.btnContaining("Already paid")); return ui; },
    async () => { const ui = mount({ orders: [dropBoxOrder()] }); await tap(ui.btnContaining("Box delivered")); return ui; },
    async () => { const ui = mount(); await tap(startCollect(ui, 100)); return ui; }
  ];
  for (const flow of flows) {
    const ui = await flow();
    for (const args of ui.log.status) {
      assert.equal(args.length, 8, "the documented changeStatus arity only");
      for (const a of args) {
        assert.ok(a == null || typeof a !== "object",
          "no object argument — a collected amount could hide in one: " + JSON.stringify(a));
      }
    }
  }
});

test("the whole suite leaked no unhandled rejections", () => {
  assert.deepEqual(unhandled.map(String), []);
});
