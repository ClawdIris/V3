const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

(async () => {
  const connectionString = 'postgresql://postgres:O6c7wN3qHnteDcec@db.exayifxbqduhsxmmsnxr.supabase.co:5432/postgres';
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('✅ Connected to Supabase database');

    // Read SQL file
    const sqlPath = path.join(__dirname, 'phase1-data-schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('📄 SQL file loaded');

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
