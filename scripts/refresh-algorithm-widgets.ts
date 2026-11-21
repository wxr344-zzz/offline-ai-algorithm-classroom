/** Back up and replace only maintained algorithm widget HTML. Owner and document
 * revision fences preserve unrelated course content and concurrent edits. */
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { isDeepStrictEqual } from 'node:util';
import { getOwnerScopedDocumentStore } from '../lib/server/agent-runtime/owner-scoped-documents';
import { getEduplusCourseStore } from '../lib/persistence/eduplus-courses';
import { simulationPreview } from '../lib/eduplus/simulation-preview';
import { avoidDecorativeTextOverlap } from '../lib/edit/decorative-text-clearance';
import { repairNativeTextClearance } from '../lib/edit/native-text-clearance';
import type { AppDocumentOutline } from '../lib/document-store/persistence-types';
const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const seedId = process.argv[2];
const options = new Set(process.argv.slice(3));
if (
  [...options].some(
    (option) => !['--simulation-only', '--owner-all', '--audit', '--inspect'].includes(option),
  )
)
  throw new Error('Unknown refresh option');
if (!/^stage-[A-Za-z0-9_-]+$/.test(seedId ?? '')) throw new Error('Specify one classroom');

async function refresh(owner: string, stageId: string) {
  const store = await getOwnerScopedDocumentStore(owner);
  const document = await store.loadDocument(stageId),
    revision = await store.readFreshnessManifest(stageId);
  if (!document || !revision) return null;
  if (options.has('--inspect')) {
    const path = `logs/${stageId}-visual-inspection.json`;
    await writeFile(
      path,
      JSON.stringify(
        document.scenes.map((s) => ({
          id: s.id,
          title: s.title,
          type: s.type,
          outlineId: s.outlineId,
          content: s.content,
        })),
        null,
        2,
      ),
    );
    console.log(path);
    return null;
  }
  const outline = document.outline as AppDocumentOutline | undefined;
  if (!Array.isArray(outline?.outlines)) return null;
  const scenes = [],
    topics = [];
  let count = 0,
    blocked = 0;
  for (const scene of document.scenes) {
    const item = outline.outlines.find((o) => o.id === scene.outlineId);
    if (
      item?.algorithmDemo &&
      scene.type === 'interactive' &&
      (item.widgetType === 'simulation' ||
        (!options.has('--simulation-only') && item.widgetType === 'game'))
    ) {
      const course = await (await getEduplusCourseStore()).get(owner, item.algorithmDemo.courseId);
      if (!course) throw new Error('Missing owned course for ' + stageId);
      const html = simulationPreview(course.topic);
      const simulation = { topic: course.topic, mode: item.widgetType, courseId: course.courseId };
      const unsupported = false;
      topics.push({
        topic: course.topic,
        type: item.widgetType,
        status: 'python-deterministic',
      });
      if (unsupported) blocked++;
      scenes.push({ ...scene, content: { ...scene.content, html, simulation } });
      if (
        html !== scene.content.html ||
        !isDeepStrictEqual(
          simulation,
          scene.content.type === 'interactive' ? scene.content.simulation : undefined,
        )
      )
        count++;
    } else if (scene.type === 'slide' && scene.content.type === 'slide') {
      const canvas = scene.content.canvas;
      const elements = avoidDecorativeTextOverlap(
        repairNativeTextClearance(
          canvas.elements,
          canvas.viewportSize,
          canvas.viewportSize * canvas.viewportRatio,
        ),
        canvas.viewportSize,
        canvas.viewportSize * canvas.viewportRatio,
      );
      if (elements !== canvas.elements) {
        scenes.push({ ...scene, content: { ...scene.content, canvas: { ...canvas, elements } } });
        count++;
      } else scenes.push(scene);
    } else scenes.push(scene);
  }
  if (!topics.length) return null;
  if (count && !options.has('--audit')) {
    await writeFile(
      `logs/${stageId}-before-widget-refresh-${Date.now()}.json`,
      JSON.stringify(document),
      { flag: 'wx' },
    );
    const seen = new WeakSet<object>();
    const guarded = await getOwnerScopedDocumentStore(owner, async (tx) => {
      if (seen.has(tx)) return;
      await tx.query(
        'SELECT stage_id FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 FOR UPDATE',
        [stageId, owner],
      );
      const fresh = await tx.query(
        'SELECT rev FROM document_stage_revision WHERE stage_id=$1 FOR UPDATE',
        [stageId],
      );
      if (Number(fresh.rows[0]?.rev) !== revision.rev)
        throw new Error('Concurrent edit; refresh stopped for ' + stageId);
      seen.add(tx);
    });
    await guarded.saveDocument({
      ...document,
      scenes,
      stage: { ...document.stage, updatedAt: Date.now() },
    });
    const saved = await store.loadDocument(stageId);
    if (
      !saved ||
      !isDeepStrictEqual(saved.scenes, scenes) ||
      !isDeepStrictEqual(saved.outline, document.outline)
    )
      throw new Error('Post-save verification failed for ' + stageId);
  }
  return {
    stageId,
    widgetsRefreshed: options.has('--audit') ? 0 : count,
    changesNeeded: count,
    blocked,
    topics,
    draftsRetained: true,
  };
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const row = await pool.query(
      'SELECT owner_id FROM stage_meta WHERE stage_id=$1 AND deleted_at IS NULL',
      [seedId],
    );
    const owner = row.rows[0]?.owner_id;
    if (!owner) throw new Error('Missing owner');
    const ids = options.has('--owner-all')
      ? (
          await pool.query(
            'SELECT stage_id FROM stage_meta WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY stage_id',
            [owner],
          )
        ).rows.map((row) => row.stage_id)
      : [seedId];
    const report = [];
    for (const stageId of ids) {
      const item = await refresh(owner, stageId);
      if (item) {
        report.push(item);
        console.log(JSON.stringify(item));
      }
    }
    const summary = {
      classrooms: report.length,
      widgetsRefreshed: report.reduce((sum, item) => sum + item.widgetsRefreshed, 0),
      blocked: report.reduce((sum, item) => sum + item.blocked, 0),
      auditOnly: options.has('--audit'),
    };
    await writeFile(
      `logs/algorithm-widget-audit-${Date.now()}.json`,
      JSON.stringify({ summary, classrooms: report }, null, 2),
      { flag: 'wx' },
    );
    console.log(JSON.stringify(summary));
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
