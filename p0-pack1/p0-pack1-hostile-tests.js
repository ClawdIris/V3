#!/usr/bin/env node
"use strict";

/*
 * P0 Pack 1 N1-N14 hostile tests.
 *
 * All hostile calls use a normal Supabase client created with the public anon
 * key and a real signed-in user's JWT. The service-role client is used only to
 * create disposable fixtures, take authoritative before/after snapshots, and
 * remove those fixtures in finally.
 *
 * Required environment:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   P0_TEST_TENANT (must not be casabe-xpress unless explicitly overridden)
 *   P0_OTHER_TENANT (must be a real non-production tenant with members)
 *   P0_ORIGIN_EMAIL, P0_ORIGIN_PASSWORD
 *   P0_DEST_EMAIL, P0_DEST_PASSWORD
 *   P0_HYBRID_EMAIL, P0_HYBRID_PASSWORD
 *   P0_UNASSIGNED_EMAIL, P0_UNASSIGNED_PASSWORD
 *
 * Optional:
 *   P0_ALLOW_PRODUCTION_FIXTURES=YES
 *   P0_ENFORCEMENT_LIVE=YES   (enables N6 after the final migration)
 */

const assert = require("assert/strict");
const { createClient } = require("@supabase/supabase-js");

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const url = env("SUPABASE_URL");
const anonKey = env("SUPABASE_ANON_KEY");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const tenant = env("P0_TEST_TENANT");
const otherTenant = env("P0_OTHER_TENANT");

if ([tenant, otherTenant].includes("casabe-xpress") && process.env.P0_ALLOW_PRODUCTION_FIXTURES !== "YES") {
  throw new Error("Refusing any production fixture tenant without P0_ALLOW_PRODUCTION_FIXTURES=YES");
}
if (otherTenant === tenant) throw new Error("P0_OTHER_TENANT must differ from P0_TEST_TENANT");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function login(prefix) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: env(`P0_${prefix}_EMAIL`),
    password: env(`P0_${prefix}_PASSWORD`)
  });
  if (error) throw new Error(`${prefix} login failed: ${error.message}`);
  return { client, user: data.user };
}

async function requireRealTenant(tenantId) {
  const { count, error } = await admin
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) throw error;
  if (!count) throw new Error(`Fixture tenant does not exist or has no members: ${tenantId}`);
}

const rpc = (client, orderId, status, options = {}) => client.rpc(
  "driver_update_order_status",
  {
    p_order_id: orderId,
    p_new_status: status,
    p_box_sub_id: options.boxSubId || null,
    p_reason_code: options.reasonCode || null,
    p_reason_note: options.reasonNote || null
  }
);

async function readOrder(id, rowTenant = tenant) {
  const { data, error } = await admin
    .from("orders")
    .select("id, tenant_id, data, updated_at, office_id, partner_id, route_id, route_sequence")
    .eq("id", id)
    .eq("tenant_id", rowTenant)
    .single();
  if (error) throw error;
  return data;
}

async function putOrder(id, data, rowTenant = tenant) {
  const { error } = await admin.from("orders").upsert({
    id,
    tenant_id: rowTenant,
    data,
    updated_at: new Date().toISOString()
  }, { onConflict: "id,tenant_id" });
  if (error) throw error;
}

function box(subId, status = "ready_pickup") {
  return {
    subId,
    status,
    orderStatus: status,
    boxType: "Small",
    destinationCountry: "Guatemala",
    notifyOnStatusChange: false,
    untouched: `sentinel-${subId}`
  };
}

function fixture(id, assignments, options = {}) {
  const status = options.status || "ready_pickup";
  const boxes = options.boxes || [box(`${id}-01`, status), box(`${id}-02`, status)];
  return {
    id,
    name: "P0 Pack 1 QA",
    status,
    boxes,
    history: [],
    payment: { amount: 100, paid: 0, status: "unpaid", method: "cash", sentinel: "keep" },
    customer: { sentinel: "keep" },
    address: "1 QA Way",
    officeId: "qa-office-sentinel",
    route_sequence: 77,
    assignedDriverUserId: assignments.origin || "",
    assignedDeliveryDriverUserId: assignments.destination || "",
    boxDeposit: Boolean(options.boxDeposit),
    depositCredited: false,
    ...(options.snapshot === undefined ? {} : { depositAmountSnapshot: options.snapshot })
  };
}

function publicError(result) {
  return result.error && `${result.error.code}:${result.error.message}`;
}

function protectedProjection(data) {
  const copy = JSON.parse(JSON.stringify(data));
  delete copy.status;
  delete copy.boxes;
  delete copy.history;
  delete copy.depositCredited;
  delete copy.depositAmountSnapshot;
  if (copy.payment) delete copy.payment.paid;
  return copy;
}

function historyCount(row) {
  return Array.isArray(row.data.history) ? row.data.history.length : 0;
}

async function expectDenied(result, label) {
  assert(result.error, `${label}: expected denial`);
  return publicError(result);
}

(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const ids = {
    origin: `P0-ORIGIN-${stamp}`,
    dest: `P0-DEST-${stamp}`,
    hybridOrigin: `P0-HYB-O-${stamp}`,
    hybridDest: `P0-HYB-D-${stamp}`,
    unassigned: `P0-NONE-${stamp}`,
    race: `P0-RACE-${stamp}`,
    legacyDeposit: `P0-DEP-${stamp}`,
    orderLevelValid: `P0-ALL-OK-${stamp}`,
    orderLevelInvalid: `P0-ALL-BLOCK-${stamp}`,
    attemptedWrongLane: `P0-ATTEMPT-LANE-${stamp}`,
    cross: `P0-CROSS-${stamp}`
  };
  const cleanup = [];
  let originalSettings = null;

  try {
    await requireRealTenant(tenant);
    await requireRealTenant(otherTenant);
    const origin = await login("ORIGIN");
    const dest = await login("DEST");
    const hybrid = await login("HYBRID");
    const unassigned = await login("UNASSIGNED");

    const rows = [
      [ids.origin, fixture(ids.origin, { origin: origin.user.id })],
      [ids.dest, fixture(ids.dest, { destination: dest.user.id }, { status: "out_for_delivery" })],
      [ids.hybridOrigin, fixture(ids.hybridOrigin, { origin: hybrid.user.id })],
      [ids.hybridDest, fixture(ids.hybridDest, { destination: hybrid.user.id }, { status: "out_for_delivery" })],
      [ids.unassigned, fixture(ids.unassigned, { origin: origin.user.id })],
      [ids.race, fixture(ids.race, { origin: origin.user.id }, { status: "picked_up", boxDeposit: true, snapshot: 10 })],
      [ids.legacyDeposit, fixture(ids.legacyDeposit, { origin: origin.user.id }, { status: "picked_up", boxDeposit: true })],
      [ids.orderLevelValid, fixture(ids.orderLevelValid, { destination: dest.user.id }, {
        status: "out_for_delivery",
        boxes: [box(`${ids.orderLevelValid}-01`, "out_for_delivery"), box(`${ids.orderLevelValid}-02`, "out_for_delivery")]
      })],
      [ids.orderLevelInvalid, fixture(ids.orderLevelInvalid, { destination: dest.user.id }, {
        status: "mixed",
        boxes: [box(`${ids.orderLevelInvalid}-01`, "out_for_delivery"), box(`${ids.orderLevelInvalid}-02`, "sorting")]
      })],
      [ids.attemptedWrongLane, fixture(ids.attemptedWrongLane, { origin: origin.user.id }, {
        status: "out_for_delivery",
        boxes: [box(`${ids.attemptedWrongLane}-01`, "out_for_delivery")]
      })]
    ];
    for (const [id, data] of rows) {
      await putOrder(id, data);
      cleanup.push([id, tenant]);
    }
    await putOrder(ids.cross, fixture(ids.cross, { origin: origin.user.id }), otherTenant);
    cleanup.push([ids.cross, otherTenant]);

    // N1: wrong capability lane.
    await expectDenied(await rpc(origin.client, ids.origin, "delivered"), "N1 origin->delivered");
    await expectDenied(await rpc(dest.client, ids.dest, "picked_up"), "N1 destination->picked_up");
    await expectDenied(await rpc(origin.client, ids.origin, "box_dropped_off"), "N1 illegal ready_pickup->box_dropped_off");
    await expectDenied(await rpc(origin.client, ids.attemptedWrongLane, "attempted", {
      boxSubId: `${ids.attemptedWrongLane}-01`,
      reasonCode: "no_answer"
    }), "N1 origin assignment cannot authorize destination-phase attempted");
    console.log("PASS N1 wrong capability lane and illegal transition denied");

    // N2: structured reason validation.
    await expectDenied(await rpc(dest.client, ids.dest, "attempted"), "N2 attempted missing reason");
    await expectDenied(await rpc(dest.client, ids.dest, "attempted", { reasonCode: "other" }), "N2 Other missing note");
    await expectDenied(await rpc(dest.client, ids.dest, "rerouted", { reasonCode: "rerouted" }), "N2 rerouted missing note");
    console.log("PASS N2 reason rules enforced");

    // N3/N4/N5: identical public denial shape.
    const n3 = await expectDenied(await rpc(unassigned.client, ids.unassigned, "picked_up"), "N3 unassigned");
    const n4 = await expectDenied(await rpc(origin.client, ids.cross, "picked_up"), "N4 cross-tenant");
    const n5 = await expectDenied(await rpc(origin.client, `P0-MISSING-${stamp}`, "picked_up"), "N5 nonexistent");
    assert.equal(n3, n4);
    assert.equal(n4, n5);
    console.log("PASS N3-N5 no existence oracle");

    // N7 and N10: rejected call is byte-identical; successful call changes
    // only the explicitly allowed projection.
    const beforeReject = await readOrder(ids.origin);
    await rpc(origin.client, ids.origin, "delivered");
    const afterReject = await readOrder(ids.origin);
    assert.deepEqual(afterReject.data, beforeReject.data);

    const beforeSuccess = await readOrder(ids.origin);
    const success = await rpc(origin.client, ids.origin, "picked_up", { boxSubId: `${ids.origin}-01` });
    assert.equal(success.error, null);
    assert.equal(success.data.changed, true);
    const afterSuccess = await readOrder(ids.origin);
    assert.deepEqual(protectedProjection(afterSuccess.data), protectedProjection(beforeSuccess.data));
    console.log("PASS N7/N10 rejected byte diff empty; protected success diff empty");

    // N12: one scanned box changes, sibling is byte-identical, parent mixed.
    assert.equal(afterSuccess.data.status, "mixed");
    assert.equal(afterSuccess.data.boxes[0].status, "picked_up");
    assert.deepEqual(afterSuccess.data.boxes[1], beforeSuccess.data.boxes[1]);
    console.log("PASS N12 per-box scope and parent mixed");

    // N14a: if any child cannot make an order-level transition, the entire
    // order remains byte-identical.
    const beforeAllBlocked = await readOrder(ids.orderLevelInvalid);
    await expectDenied(
      await rpc(dest.client, ids.orderLevelInvalid, "delivered"),
      "N14a one child has an invalid transition"
    );
    const afterAllBlocked = await readOrder(ids.orderLevelInvalid);
    assert.deepEqual(afterAllBlocked.data, beforeAllBlocked.data);

    // N14b: a valid order-level Delivery Queue action updates every child.
    const allValid = await rpc(dest.client, ids.orderLevelValid, "delivered");
    assert.equal(allValid.error, null);
    assert.equal(allValid.data.changed, true);
    const afterAllValid = await readOrder(ids.orderLevelValid);
    assert.equal(afterAllValid.data.status, "delivered");
    assert.equal(afterAllValid.data.boxes.length, 2);
    assert(afterAllValid.data.boxes.every((item) => item.status === "delivered"));
    assert(afterAllValid.data.boxes.every((item) => item.orderStatus === "delivered"));
    console.log("PASS N14 order-level all-or-nothing scope");

    // N13: exact same target is a strict no-op.
    const beforeNoOp = await readOrder(ids.origin);
    const noOp = await rpc(origin.client, ids.origin, "picked_up", { boxSubId: `${ids.origin}-01` });
    const afterNoOp = await readOrder(ids.origin);
    assert.equal(noOp.error, null);
    assert.equal(noOp.data.changed, false);
    assert.deepEqual(afterNoOp.data, beforeNoOp.data);
    console.log("PASS N13 strict no-op");

    // N8: race under row lock => one change, one no-op, one credit/history.
    const raceBefore = await readOrder(ids.race);
    const [raceA, raceB] = await Promise.all([
      rpc(origin.client, ids.race, "in_warehouse", { boxSubId: `${ids.race}-01` }),
      rpc(origin.client, ids.race, "in_warehouse", { boxSubId: `${ids.race}-01` })
    ]);
    assert.equal(raceA.error, null);
    assert.equal(raceB.error, null);
    assert.deepEqual([raceA.data.changed, raceB.data.changed].sort(), [false, true]);
    const raceAfter = await readOrder(ids.race);
    assert.equal(historyCount(raceAfter) - historyCount(raceBefore), 1);
    assert.equal(raceAfter.data.payment.paid - raceBefore.data.payment.paid, 10);
    assert.equal(raceAfter.data.depositCredited, true);
    console.log("PASS N8 concurrent idempotency and one deposit credit");

    // N9: legacy fallback snapshots once and survives a config change.
    const settingsResult = await admin.from("tenant_settings")
      .select("id, data").eq("tenant_id", tenant).eq("config_key", "main").single();
    if (settingsResult.error) throw settingsResult.error;
    originalSettings = settingsResult.data;
    const setting17 = { ...originalSettings.data, depositAmount: 17 };
    let update = await admin.from("tenant_settings").update({ data: setting17 }).eq("id", originalSettings.id);
    if (update.error) throw update.error;
    const firstCredit = await rpc(origin.client, ids.legacyDeposit, "in_warehouse", { boxSubId: `${ids.legacyDeposit}-01` });
    assert.equal(firstCredit.error, null);
    const setting31 = { ...originalSettings.data, depositAmount: 31 };
    update = await admin.from("tenant_settings").update({ data: setting31 }).eq("id", originalSettings.id);
    if (update.error) throw update.error;
    const repeatCredit = await rpc(origin.client, ids.legacyDeposit, "in_warehouse", { boxSubId: `${ids.legacyDeposit}-01` });
    assert.equal(repeatCredit.error, null);
    assert.equal(repeatCredit.data.changed, false);
    const depositAfter = await readOrder(ids.legacyDeposit);
    assert.equal(depositAfter.data.depositAmountSnapshot, 17);
    assert.equal(depositAfter.data.payment.paid, 17);
    console.log("PASS N9 legacy fallback snapshot is stable");

    // N11: hybrid has both capabilities but still needs matching assignment.
    let result = await rpc(hybrid.client, ids.hybridOrigin, "picked_up", { boxSubId: `${ids.hybridOrigin}-01` });
    assert.equal(result.error, null);
    result = await rpc(hybrid.client, ids.hybridDest, "delivered");
    assert.equal(result.error, null);
    await expectDenied(await rpc(hybrid.client, ids.hybridDest, "picked_up"), "N11 wrong assignment lane");
    console.log("PASS N11 hybrid assignment lane enforced");

    // N6 runs only after the final policy-drop migration.
    if (process.env.P0_ENFORCEMENT_LIVE === "YES") {
      const directBefore = await readOrder(ids.origin);
      const tampered = { ...directBefore.data, customer: { hacked: true } };
      const direct = await origin.client.from("orders").update({ data: tampered })
        .eq("id", ids.origin).eq("tenant_id", tenant).select("id");
      assert(direct.error || !direct.data || direct.data.length === 0, "N6 direct PATCH unexpectedly succeeded");
      const directAfter = await readOrder(ids.origin);
      assert.deepEqual(directAfter.data, directBefore.data);
      console.log("PASS N6 direct driver PATCH denied");
    } else {
      console.log("SKIP N6 until P0_ENFORCEMENT_LIVE=YES");
    }

    console.log("P0 Pack 1 N1-N14 database suite PASS");
    console.log("Browser QA still must prove one customer notification only for changed:true.");
  } finally {
    if (originalSettings) {
      await admin.from("tenant_settings").update({ data: originalSettings.data }).eq("id", originalSettings.id);
    }
    for (const [id, rowTenant] of cleanup.reverse()) {
      await admin.from("orders").delete().eq("id", id).eq("tenant_id", rowTenant);
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
