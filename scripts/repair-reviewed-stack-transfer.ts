/** Scoped repair of the user's already-generated stack classroom; old assets remain immutable. */
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Pool } from 'pg';
import { getOwnerScopedDocumentStore } from '../lib/server/agent-runtime/owner-scoped-documents';
import { getEduplusCourseStore } from '../lib/persistence/eduplus-courses';
import { bindEmbeddedLabsIn, embeddedLabContent } from '../lib/server/eduplus-native-generation';
import type { AppDocumentOutline } from '../lib/document-store/persistence-types';
import type { GeneratedCourse } from '../lib/server/eduplus-internal.generated';
import type { Scene } from '../lib/types/stage';
const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const stageId = 'stage-bWbEC0mSLBGu';
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const row = await pool.query(
      'SELECT owner_id FROM stage_meta WHERE stage_id=$1 AND deleted_at IS NULL',
      [stageId],
    );
    const owner = row.rows[0]?.owner_id;
    if (!owner) throw new Error('Missing classroom');
    const store = await getOwnerScopedDocumentStore(owner);
    const document = await store.loadDocument(stageId);
    const revision = await store.readFreshnessManifest(stageId);
    if (!document || !revision) throw new Error('Missing document');
    const outline = document.outline as AppDocumentOutline;
    const oldId = outline.outlines.find((item) => item.eduplus?.phase === 'oj-lab')?.eduplus
      ?.courseId;
    if (!oldId) throw new Error('Missing original course');
    const courses = await getEduplusCourseStore();
    const original = await courses.getPrivateForTeacher(owner, oldId);
    if (!original) throw new Error('Missing private assets');
    if (original.problem?.oj_scene.problem.title === '校园编辑器：撤销记录的峰值与剩余记录') return;
    for (const [file, value] of [
      ['logs/stack-before-transfer-document.json', document],
      ['logs/stack-before-transfer-private.json', original],
    ] as const) {
      try {
        await writeFile(file, JSON.stringify(value), { flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (JSON.stringify(JSON.parse(await readFile(file, 'utf8'))) !== JSON.stringify(value))
          throw new Error('Backup differs from current snapshot; repair stopped');
      }
    }
    execFileSync(
      path.resolve('.venv/Scripts/python.exe'),
      [
        'scripts/build-reviewed-stack-transfer.py',
        'logs/stack-before-transfer-private.json',
        'logs/stack-reviewed-assets.json',
      ],
      { timeout: 60000 },
    );
    const generated = JSON.parse(
      await readFile('logs/stack-reviewed-assets.json', 'utf8'),
    ) as GeneratedCourse;
    await courses.save(owner, generated);
    const courseId = generated.publicCourse.courseId;
    const outlines = outline.outlines.map((item) => ({
      ...item,
      ...(item.eduplus?.courseId === oldId ? { eduplus: { ...item.eduplus, courseId } } : {}),
      ...(item.algorithmDemo?.courseId === oldId
        ? { algorithmDemo: { ...item.algorithmDemo, courseId } }
        : {}),
    }));
    const scenes: Scene[] = [];
    for (const scene of document.scenes) {
      const item = outlines.find((item) => item.id === scene.outlineId);
      if (item?.eduplus && scene.type === 'interactive') {
        const content = await embeddedLabContent(owner, item);
        scenes.push({ ...scene, content: { ...scene.content, ...content } } as Scene);
      } else scenes.push(scene);
    }
    const seen = new WeakSet<object>();
    const guarded = await getOwnerScopedDocumentStore(owner, async (tx) => {
      if (seen.has(tx)) return;
      await tx.query(
        'SELECT stage_id FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 FOR UPDATE',
        [stageId, owner],
      );
      const current = await tx.query(
        'SELECT rev FROM document_stage_revision WHERE stage_id=$1 FOR UPDATE',
        [stageId],
      );
      if (Number(current.rows[0]?.rev) !== revision.rev)
        throw new Error('Concurrent edit; no classroom replacement');
      await bindEmbeddedLabsIn(
        tx,
        owner,
        stageId,
        outlines,
        new Map(scenes.map((scene) => [scene.outlineId ?? scene.id, scene.id])),
      );
      seen.add(tx);
    });
    await guarded.saveDocument({
      ...document,
      scenes,
      stage: { ...document.stage, updatedAt: Date.now() },
      outline: { ...outline, outlines, updatedAt: Date.now() },
    });
    console.log(
      JSON.stringify({ stageId, courseId, changed: true, oldAssetsAndDraftsRetained: true }),
    );
  } finally {
    await pool.end();
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
