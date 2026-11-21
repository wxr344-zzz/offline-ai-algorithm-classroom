// Read-only connection and migration-permission check; never prints credentials.
const { createRequire } = require('node:module');
const path = require('node:path');
const { Pool } = require('pg');

const root = path.resolve(__dirname, '..');
const nextRequire = createRequire(require.resolve('next/package.json'));
nextRequire('@next/env').loadEnvConfig(root);

async function main() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is not configured');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    const result = await pool.query(
      "SELECT current_database() AS database, current_user AS role, has_schema_privilege(current_user, 'public', 'CREATE') AS can_create",
    );
    console.log('Database connection: OK', result.rows[0]);
    if (!result.rows[0].can_create) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Database connection failed:', error.code || error.name);
  process.exitCode = 1;
});
