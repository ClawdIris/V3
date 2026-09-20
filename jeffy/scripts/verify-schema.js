#!/usr/bin/env node
/**
 * Guards against the hand-maintained TypeScript enums drifting from the SQL.
 *
 * src/types/database.ts is written by hand until the Supabase project exists
 * and `npm run gen:types` can take over. Until then nothing stops someone
 * adding a value to a Postgres enum and forgetting the TypeScript side, where
 * it would surface as a runtime string that no switch handles. This compares
 * the two and exits non-zero on any difference.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const TYPES = path.join(ROOT, 'src', 'types', 'database.ts');

/** snake_case SQL enum name -> SCREAMING_CASE TypeScript const name. */
const CONST_NAME = {
  item_category: 'ITEM_CATEGORIES',
  season: 'SEASONS',
  closet_role: 'CLOSET_ROLES',
  member_status: 'MEMBER_STATUSES',
  item_status: 'ITEM_STATUSES',
  outfit_source: 'OUTFIT_SOURCES',
  outfit_status: 'OUTFIT_STATUSES',
  feedback_verdict: 'FEEDBACK_VERDICTS',
  rule_strength: 'RULE_STRENGTHS',
  wishlist_source: 'WISHLIST_SOURCES',
  wishlist_status: 'WISHLIST_STATUSES',
  piece_match: 'PIECE_MATCHES',
  look_status: 'LOOK_STATUSES',
  attachment_kind: 'ATTACHMENT_KINDS',
  price_tier: 'PRICE_TIERS',
  item_source: 'ITEM_SOURCES',
};

function readMigrations() {
  return fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    .join('\n');
}

function sqlEnums(sql) {
  const found = new Map();
  const pattern = /create\s+type\s+public\.(\w+)\s+as\s+enum\s*\(([^)]*)\)/gis;
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    const values = [...match[2].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    found.set(match[1], values);
  }
  return found;
}

function tsEnums(source) {
  const found = new Map();
  const pattern = /export const (\w+) = \[([^\]]*)\] as const;/gs;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const values = [...match[2].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    found.set(match[1], values);
  }
  return found;
}

const sql = sqlEnums(readMigrations());
const ts = tsEnums(fs.readFileSync(TYPES, 'utf8'));
const problems = [];

for (const [sqlName, sqlValues] of sql) {
  const constName = CONST_NAME[sqlName];
  if (!constName) {
    problems.push(
      `SQL enum public.${sqlName} has no entry in CONST_NAME in scripts/verify-schema.js`,
    );
    continue;
  }
  const tsValues = ts.get(constName);
  if (!tsValues) {
    problems.push(`SQL enum public.${sqlName} has no ${constName} in src/types/database.ts`);
    continue;
  }
  // Order matters: these back `as const` tuples used for exhaustive switches.
  if (sqlValues.join('|') !== tsValues.join('|')) {
    problems.push(
      `public.${sqlName} differs from ${constName}\n` +
        `      SQL: [${sqlValues.join(', ')}]\n` +
        `       TS: [${tsValues.join(', ')}]`,
    );
  }
}

for (const sqlName of Object.keys(CONST_NAME)) {
  if (!sql.has(sqlName)) {
    problems.push(`CONST_NAME lists public.${sqlName}, but no migration creates it`);
  }
}

if (problems.length > 0) {
  console.error('Schema drift between supabase/migrations and src/types/database.ts:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`Schema OK: ${sql.size} enums match src/types/database.ts`);
