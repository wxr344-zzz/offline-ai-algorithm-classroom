/** Repair one backed-up owned classroom's retained native quiz binding. */
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { getOwnerScopedDocumentStore } from '../lib/server/agent-runtime/owner-scoped-documents';
import { bindEmbeddedLabsIn, embeddedLabContent } from '../lib/server/eduplus-native-generation';
import type { AppDocumentOutline } from '../lib/document-store/persistence-types';
import type { Scene } from '../lib/types/stage';
const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const stageId = process.argv[2];
if (!/^stage-[A-Za-z0-9_-]+$/.test(stageId ?? '')) throw new Error('Specify one classroom');
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
    await writeFile(`logs/${stageId}-before-quiz-binding.json`, JSON.stringify(document), {
      flag: 'wx',
    });
    const outline = document.outline as AppDocumentOutline;
    const scenes: Scene[] = [];
    for (const scene of document.scenes) {
      const item = outline.outlines.find(
        (item) => item.id === scene.outlineId || item.id === scene.id,
      );
      if (!item) {
        scenes.push(scene);
        continue;
      }
      const quiz = item.eduplus?.phase === 'quiz' ? await embeddedLabContent(owner, item) : null;
      scenes.push({
        ...scene,
        outlineId: item.id,
        ...(quiz ? { content: { type: 'quiz', ...quiz } } : {}),
      } as Scene);
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
      if (Number(current.rows[0]?.rev) !== revision.rev) throw new Error('Concurrent edit');
      await bindEmbeddedLabsIn(
        tx,
        owner,
        stageId,
        outline.outlines,
        new Map(scenes.map((scene) => [scene.outlineId ?? scene.id, scene.id])),
      );
      seen.add(tx);
    });
    await guarded.saveDocument({
      ...document,
      scenes,
      stage: { ...document.stage, updatedAt: Date.now() },
    });
    console.log(JSON.stringify({ stageId, quizBindingRepaired: true }));
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
