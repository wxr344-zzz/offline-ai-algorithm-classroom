/** Inspect owned saved classrooms, or repair one explicitly selected stage. */
import { createRequire } from 'node:module';
import { Pool } from 'pg';
import { getOwnerScopedDocumentStore } from '../lib/server/agent-runtime/owner-scoped-documents';
import { repairNativeLabs } from '../lib/server/eduplus-native-repair';
import { readFile, writeFile } from 'node:fs/promises';
import { deepStrictEqual } from 'node:assert';
import { isLegacyPythonLab } from '../lib/eduplus/legacy-lab';
const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const stageId = process.argv[2];
if (stageId && !/^[A-Za-z0-9_-]{6,100}$/.test(stageId)) throw new Error('Invalid stage');
const courseIndex = process.argv.indexOf('--course-id');
const verifiedCourseId = courseIndex >= 0 ? process.argv[courseIndex + 1] : undefined;
if (courseIndex >= 0 && (!verifiedCourseId || !/^[A-Za-z0-9_-]{6,100}$/.test(verifiedCourseId)))
  throw new Error('Invalid verified course');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const { rows } = await pool.query(
    'SELECT stage_id,owner_id FROM stage_meta WHERE deleted_at IS NULL' +
      (stageId ? ' AND stage_id=$1' : ''),
    stageId ? [stageId] : [],
  );
  for (const row of rows) {
    if (stageId && process.argv.includes('--repair')) {
      const document = await (
        await getOwnerScopedDocumentStore(row.owner_id)
      ).loadDocument(row.stage_id);
      await writeFile(
        `logs/${stageId}-before-legacy-repair-${Date.now()}.json`,
        JSON.stringify(document),
        { flag: 'wx' },
      );
      console.log(
        JSON.stringify(
          await repairNativeLabs(
            row.owner_id,
            row.stage_id,
            undefined,
            process.argv.includes('--regenerate')
              ? {
                  regenerateLabs: true,
                  regenerateLectures: process.argv.includes('--regenerate-all'),
                  verifiedCourseId,
                }
              : {},
          ),
        ),
      );
      continue;
    }
    const doc = await (await getOwnerScopedDocumentStore(row.owner_id)).loadDocument(row.stage_id);
    if (!doc) continue;
    if (stageId && process.argv.includes('--export'))
      await writeFile(`logs/${stageId}-audit-document.json`, JSON.stringify(doc));
    const legacy = doc.scenes.filter((s) => isLegacyPythonLab(s.content));
    const backupIndex = process.argv.indexOf('--verify-backup');
    if (backupIndex >= 0) {
      const file = process.argv[backupIndex + 1];
      if (!file?.startsWith(`logs/${stageId}-before-legacy-repair-`) || file.includes('..'))
        throw new Error('Invalid backup');
      const before = JSON.parse(await readFile(file, 'utf8')) as typeof doc;
      const retained = before.scenes.filter((s) => !isLegacyPythonLab(s.content));
      deepStrictEqual(
        doc.scenes.map((s) => s.id),
        retained.map((s) => s.id),
      );
      for (const [index, scene] of doc.scenes.entries()) {
        deepStrictEqual(scene.content, retained[index].content);
        deepStrictEqual(scene.actions, retained[index].actions);
      }
      console.log(
        JSON.stringify({
          stageId,
          retainedScenes: retained.length,
          contentsAndActionsUnchanged: true,
        }),
      );
    }
    if (legacy.length || stageId)
      console.log(
        JSON.stringify({
          stageId: row.stage_id,
          title: doc.stage.name,
          legacy: legacy.map((s) => ({ id: s.id, title: s.title, outlineId: s.outlineId })),
          phases: doc.scenes.flatMap((s) =>
            s.content.type === 'interactive' && s.content.eduplus ? [s.content.eduplus.phase] : [],
          ),
        }),
      );
  }
} finally {
  await pool.end();
}
process.exit(0);
