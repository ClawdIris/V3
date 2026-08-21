#!/usr/bin/env node
/*
 * Isolated migration apply checker.
 * It never connects to production. Provide TEST_DATABASE_URL for a disposable
 * Postgres/Supabase database. The script applies migration inside a transaction
 * and rolls back at the end.
 */
const fs = require("fs");
const { Client } = require("pg");

async function main() {
  const url = process.env.TEST_DATABASE_URL || process.env.TWILIO_PHASE1_TEST_DATABASE_URL;
  if (!url) {
    console.log("SKIP isolated apply: set TEST_DATABASE_URL to a disposable database.");
    process.exit(0);
  }
  if (/supabase\.co|casabe|prod|production/i.test(url)) {
    throw new Error("Refusing to run isolated apply against a URL that looks non-disposable");
  }
  const sql = fs.readFileSync("supabase/migrations/20260819000100_twilio_phase1_inbox.sql", "utf8")
    .replace(/^\s*BEGIN;\s*/i, "")
    .replace(/\s*COMMIT;\s*$/i, "");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    const res = await client.query("select to_regclass('public.message_threads') as threads, to_regclass('public.messaging_numbers') as numbers");
    if (!res.rows[0].threads || !res.rows[0].numbers) throw new Error("Phase 1 tables missing after apply");
    await client.query("ROLLBACK");
    console.log("isolated apply passed and rolled back");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
