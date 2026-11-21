/** Refresh only a specified owned classroom's maintained demo HTML; no model calls. */
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { getOwnerScopedDocumentStore } from '../lib/server/agent-runtime/owner-scoped-documents';
import { embeddedAlgorithmContent } from '../lib/server/eduplus-native-generation';
import type { AppDocumentOutline } from '../lib/document-store/persistence-types';
import type { Scene } from '../lib/types/stage';
const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const stageId = process.argv[2];
if (!/^stage-[A-Za-z0-9_-]+$/.test(stageId ?? '')) throw new Error('Specify one classroom');
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const owner = (
      await pool.query('SELECT owner_id FROM stage_meta WHERE stage_id=$1 AND deleted_at IS NULL', [
        stageId,
      ])
    ).rows[0]?.owner_id;
    if (!owner) throw new Error('Missing classroom');
    const store = await getOwnerScopedDocumentStore(owner),
      doc = await store.loadDocument(stageId),
      revision = await store.readFreshnessManifest(stageId);
    if (!doc || !revision) throw new Error('Missing document');
    await writeFile(`logs/${stageId}-before-live-inputs.json`, JSON.stringify(doc), { flag: 'wx' });
    const outline = doc.outline as AppDocumentOutline,
      scenes: Scene[] = [];
    let updated = 0;
    for (const scene of doc.scenes) {
      const item = outline.outlines.find(
        (item) => item.id === scene.outlineId || item.id === scene.id,
      );
      if (scene.type === 'interactive' && item?.algorithmDemo) {
        const content = await embeddedAlgorithmContent(owner, item);
        scenes.push({ ...scene, content: { ...scene.content, ...content } });
        updated++;
      } else scenes.push(scene);
    }
    if (!updated) throw new Error('No maintained demos found; no classroom write');
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
      seen.add(tx);
    });
    await guarded.saveDocument({ ...doc, scenes, stage: { ...doc.stage, updatedAt: Date.now() } });
    console.log(JSON.stringify({ stageId, updated }));
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
