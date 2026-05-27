const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ DATABASE_URL is required. Export it locally before running this script.');
    process.exit(1);
  }

  const sqlFile = process.argv[2] || 'phase1-data-schema.sql';
  const sqlPath = path.resolve(__dirname, sqlFile);
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    console.log('✅ Connected to Supabase database');

    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log(`📄 SQL file loaded: ${path.basename(sqlPath)}`);

    // Execute migration
    await client.query(sql);
    console.log('✅ Phase 1 migration applied successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
