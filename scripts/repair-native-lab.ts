/** Local maintenance for an explicitly requested existing classroom; no credentials or owner ids printed. */
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
const localRequire = createRequire(import.meta.url);
const nextRequire = createRequire(localRequire.resolve('next/package.json'));
nextRequire('@next/env').loadEnvConfig(process.cwd());
const stageId = process.argv[2];
if (!stageId || !/^stage-[a-zA-Z0-9_-]+$/.test(stageId))
  throw new Error('Specify a valid classroom stage id');
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const found = await pool.query(
      'SELECT owner_id FROM stage_meta WHERE stage_id=$1 AND deleted_at IS NULL',
      [stageId],
    );
    if (!found.rows.length) throw new Error('Classroom not found');
    // Require the read-only diagnostic backup before any existing course write.
    await readFile(path.resolve('logs', `${stageId}-before-integration.json`), 'utf8');
    const { repairNativeLabs } = await import('../lib/server/eduplus-native-repair');
    const result = await repairNativeLabs(
      found.rows[0].owner_id,
      stageId,
      AbortSignal.timeout(900000),
      {
        regenerateLabs: process.argv[3] === '--regenerate-labs',
        repairFeedback: process.argv[4] ? await readFile(process.argv[4], 'utf8') : undefined,
      },
    );
    await writeFile(
      path.resolve('logs', `${stageId}-integration-result.json`),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    await pool.end();
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.code ?? error.message);
    process.exit(1);
  });
