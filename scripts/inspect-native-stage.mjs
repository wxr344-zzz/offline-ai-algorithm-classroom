// Read-only diagnostics and recoverable snapshot for a user-specified local classroom.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const { Pool } = pg;
const root = fileURLToPath(new URL('../', import.meta.url));
const localRequire = createRequire(import.meta.url);
createRequire(localRequire.resolve('next/package.json'))('@next/env').loadEnvConfig(root);
const stageId = process.argv[2];
if (!stageId || !/^stage-[a-zA-Z0-9_-]+$/.test(stageId))
  throw new Error('Provide a valid stage id');
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const stage = await pool.query('SELECT data FROM document_stages WHERE id=$1', [stageId]);
    const scenes = await pool.query(
      'SELECT data FROM document_scenes WHERE stage_id=$1 ORDER BY scene_order',
      [stageId],
    );
    if (!stage.rows.length) throw new Error('Classroom not found');
    const doc = { stage: stage.rows[0].data, scenes: scenes.rows.map((row) => row.data) };
    const file = path.join(root, 'logs', `${stageId}-before-integration.json`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8');
    console.log(
      JSON.stringify(
        {
          title: doc.stage.name,
          scenes: doc.scenes.map((scene) => ({
            id: scene.id,
            title: scene.title,
            type: scene.type,
            widgetType: scene.content.widgetType,
            codeMirror: /codemirror|baseSetup/i.test(scene.content.html || ''),
            pyodide: /pyodide/i.test(scene.content.html || ''),
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
