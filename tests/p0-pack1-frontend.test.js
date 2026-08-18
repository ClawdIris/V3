const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

describe("P0 Pack 1 frontend contract", () => {
  test("uses only the new driver status RPC", () => {
    expect(source).toContain('supabase.rpc("driver_update_order_status"');
    expect(source).not.toContain("supabase.rpc('update_driver_status'");
  });

  test("sends structured reason and box scope parameters", () => {
    for (const key of [
      "p_box_sub_id",
      "p_reason_code",
      "p_reason_note",
      "ckReasonCode"
    ]) expect(source).toContain(key);
  });

  test("new orders snapshot the configured deposit", () => {
    expect(source).toContain("depositAmountSnapshot: f.boxDeposit ? _depositSnapshot : null");
  });

  test("customer messaging is downstream of changed true", () => {
    const rpcStart = source.indexOf('supabase.rpc("driver_update_order_status"');
    const noOpGate = source.indexOf("payload.changed !== true", rpcStart);
    const notify = source.indexOf("dispatchCommittedStatusNotifications(committed", rpcStart);
    expect(rpcStart).toBeGreaterThan(-1);
    expect(noOpGate).toBeGreaterThan(rpcStart);
    expect(notify).toBeGreaterThan(noOpGate);
  });

  test("Scan Mode passes the resolved child while Delivery Queue remains order-scoped", () => {
    expect(source).toContain("resolved.box ? resolved.box.subId : null");
    expect(source).toContain('ckReasonCode("attempted", attemptPreset)');
  });

  test("legacy origin No Answer actions send the canonical code", () => {
    expect((source.match(/"no_answer"/g) || []).length).toBeGreaterThanOrEqual(5);
  });
});
