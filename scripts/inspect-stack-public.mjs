import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const { rows } = await pool.query("SELECT public_data FROM eduplus_courses WHERE owner_id=$1 AND public_data->>'topic' LIKE '%栈%' ORDER BY created_at DESC LIMIT 1", [process.env.OWNER_SINGLE_USER_ID || 'local']);
  if (!rows.length) throw new Error('No owned stack course found');
  await writeFile('logs/stack-public-debug.json', JSON.stringify(rows[0].public_data, null, 2));
  console.log(JSON.stringify({ topic: rows[0].public_data.topic, saved: 'logs/stack-public-debug.json' }));
} finally { await pool.end(); }
