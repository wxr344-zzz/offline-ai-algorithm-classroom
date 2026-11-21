/** Correct the model's demonstration/practice order without regenerating or replacing page assets. */
import { createRequire } from 'node:module';
import { Pool } from 'pg';
import { writeFile } from 'node:fs/promises';
import { getOwnerScopedDocumentStore } from '../lib/server/agent-runtime/owner-scoped-documents';
import { orderNativeLabOutlines } from '../lib/eduplus/native-outline';
import type { AppDocumentOutline } from '../lib/document-store/persistence-types';
import { embeddedLabContent } from '../lib/server/eduplus-native-generation';
import { isTwoSumTopic, twoSumWidget } from '../lib/eduplus/two-sum-widget';
import { twoSumSlide } from '../lib/eduplus/two-sum-slide';
const localRequire = createRequire(import.meta.url);
createRequire(localRequire.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const stageId = process.argv[2];
if (!/^stage-[a-zA-Z0-9_-]+$/.test(stageId ?? ''))
  throw new Error('Specify one classroom stage id');
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const meta = await pool.query(
      'SELECT owner_id FROM stage_meta WHERE stage_id=$1 AND deleted_at IS NULL',
      [stageId],
    );
    if (!meta.rows.length) throw new Error('Classroom not found');
    const ownerId = meta.rows[0].owner_id;
    const store = await getOwnerScopedDocumentStore(ownerId);
    const revision = await store.readFreshnessManifest(stageId);
    const doc = await store.loadDocument(stageId);
    if (!doc || !revision) throw new Error('Classroom not found');
    const outline = doc.outline as AppDocumentOutline;
    if (!outline?.generationComplete) throw new Error('Wait for generation to complete');
    await writeFile(`logs/${stageId}-before-order.json`, JSON.stringify(doc, null, 2), {
      flag: 'wx',
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const ordered = orderNativeLabOutlines(outline.outlines);
    if (isTwoSumTopic(doc.stage.name) && ordered.some((item) => item.widgetType === 'game')) {
      for (const item of ordered) {
        if (item.type === 'slide' && /互动游戏|挑战游戏/.test(item.title))
          item.title = '代码示例与边界处理';
      }
    }
    const positions = new Map(ordered.map((item) => [item.id, item.order]));
    const scenes = doc.scenes
      .map((scene) => {
        const order = positions.get(scene.outlineId ?? scene.id) ?? positions.get(scene.id);
        if (order === undefined) throw new Error('Scene/outline mismatch');
        const planned = ordered.find((item) => item.id === scene.outlineId || item.id === scene.id);
        return { ...scene, title: planned?.title ?? scene.title, order };
      })
      .sort((a, b) => a.order - b.order);
    for (const scene of scenes) {
      if (isTwoSumTopic(doc.stage.name)) {
        if (scene.type === 'slide' && scene.content.type === 'slide')
          scene.content = {
            type: 'slide',
            canvas: { ...scene.content.canvas, ...twoSumSlide(scene.title) },
          };
        if (
          scene.type === 'interactive' &&
          (scene.content.widgetType === 'simulation' || scene.content.widgetType === 'game')
        )
          scene.content = { ...scene.content, html: twoSumWidget(scene.content.widgetType) };
      }
      if (scene.type !== 'interactive' || !scene.content.eduplus) continue;
      const planned = ordered.find((item) => item.id === scene.outlineId || item.id === scene.id);
      if (!planned?.eduplus) throw new Error('Missing owned Lab outline');
      const content = await embeddedLabContent(ownerId, planned);
      if (!('html' in content)) throw new Error('Invalid Lab context');
      scene.content = { ...scene.content, html: content.html };
    }
    const checked = new WeakSet<object>();
    const guarded = await getOwnerScopedDocumentStore(ownerId, async (tx) => {
      if (checked.has(tx)) return;
      await tx.query('SELECT stage_id FROM stage_meta WHERE stage_id=$1 FOR UPDATE', [stageId]);
      const current = await tx.query(
        'SELECT rev FROM document_stage_revision WHERE stage_id=$1 FOR UPDATE',
        [stageId],
      );
      if (Number(current.rows[0]?.rev) !== revision.rev)
        throw new Error('Concurrent edit; nothing replaced');
      checked.add(tx);
    });
    await guarded.saveDocument({
      ...doc,
      scenes,
      stage: { ...doc.stage, updatedAt: Date.now() },
      outline: { ...outline, outlines: ordered, updatedAt: Date.now() },
    });
    console.log(
      JSON.stringify({
        stageId,
        sceneIdsRetained: true,
        order: scenes.map((scene) => scene.title),
      }),
    );
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
