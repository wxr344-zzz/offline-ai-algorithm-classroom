/** Focused, revision-fenced correction: native layout and irrelevant quizzes.
 * Course assets, code drafts, assertions, public cases and scores are untouched. */
import { createRequire } from 'node:module';
import { writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Pool } from 'pg';
import { getOwnerScopedDocumentStore } from '../lib/server/agent-runtime/owner-scoped-documents';
import { getEduplusCourseStore } from '../lib/persistence/eduplus-courses';
import { nativeQuizQuestions } from '../lib/eduplus/classroom-adapter';
import { repairNativeTextClearance } from '../lib/edit/native-text-clearance';
import { avoidDecorativeTextOverlap } from '../lib/edit/decorative-text-clearance';
import type { AppDocumentOutline } from '../lib/document-store/persistence-types';
import type { ClassroomTeaching } from '../lib/types/eduplus-teaching.generated';
import type { PublicCourse } from '../lib/server/eduplus-internal.generated';

const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const seed = process.argv[2],
  apply = process.argv.includes('--apply');
if (!/^stage-[A-Za-z0-9_-]+$/.test(seed ?? '')) throw new Error('Specify classroom');
const generic = (value: unknown) =>
  /本课单份算法输入的字段|本课公开示例计算结果的最外层 JSON|批量处理相同计算结果时/.test(
    JSON.stringify(value),
  );
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const owner = (
      await pool.query('SELECT owner_id FROM stage_meta WHERE stage_id=$1 AND deleted_at IS NULL', [
        seed,
      ])
    ).rows[0]?.owner_id;
    if (!owner) throw new Error('Missing owned classroom');
    const ids = process.argv.includes('--owner-all')
      ? (
          await pool.query(
            'SELECT stage_id FROM stage_meta WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY stage_id',
            [owner],
          )
        ).rows.map((r) => r.stage_id)
      : [seed];
    const store = await getOwnerScopedDocumentStore(owner);
    const courses = await getEduplusCourseStore();
    const pending = [];
    const publicCourses: Record<string, PublicCourse> = {};
    for (const stageId of ids) {
      const document = await store.loadDocument(stageId),
        revision = await store.readFreshnessManifest(stageId);
      if (!document || !revision || !document.outline) continue;
      const outline = document.outline as AppDocumentOutline;
      for (const item of outline.outlines) {
        const ref = item.eduplus ?? item.algorithmDemo;
        if (ref && generic(ref.teaching) && !publicCourses[ref.courseId]) {
          const course = await courses.get(owner, ref.courseId);
          if (!course) throw new Error('Missing owned course');
          publicCourses[ref.courseId] = course;
        }
      }
      pending.push({ stageId, document, revision, outline });
    }
    const stamp = Date.now();
    const input = `logs/algorithm-teaching-input-${stamp}.json`,
      output = `logs/algorithm-teaching-output-${stamp}.json`;
    await writeFile(input, JSON.stringify(publicCourses), { flag: 'wx' });
    execFileSync(
      path.resolve('.venv/Scripts/python.exe'),
      ['scripts/repair-algorithm-teaching.py', input, output],
      { timeout: 120000 },
    );
    const teaching = JSON.parse(await readFile(output, 'utf8')) as Record<
      string,
      ClassroomTeaching
    >;
    const report = [];
    for (const { stageId, document, revision, outline } of pending) {
      const outlines = outline.outlines.map((item) => {
        const replace = <T extends { courseId: string; teaching: ClassroomTeaching }>(ref: T): T =>
          teaching[ref.courseId] && generic(ref.teaching)
            ? { ...ref, teaching: { ...ref.teaching, questions: teaching[ref.courseId].questions } }
            : ref;
        return {
          ...item,
          ...(item.eduplus ? { eduplus: replace(item.eduplus) } : {}),
          ...(item.algorithmDemo ? { algorithmDemo: replace(item.algorithmDemo) } : {}),
        };
      });
      let slides = 0,
        quizzes = 0;
      const scenes = document.scenes.map((scene) => {
        if (scene.type === 'slide' && scene.content.type === 'slide') {
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
          if (!isDeepStrictEqual(elements, canvas.elements)) {
            slides++;
            return { ...scene, content: { ...scene.content, canvas: { ...canvas, elements } } };
          }
        }
        const ref = outlines.find((item) => item.id === scene.outlineId)?.eduplus;
        if (
          scene.type === 'quiz' &&
          scene.content.type === 'quiz' &&
          generic(scene.content) &&
          ref &&
          teaching[ref.courseId]
        ) {
          quizzes++;
          const questions = nativeQuizQuestions(ref.courseId, ref.teaching).map((q) => ({
            ...q,
            id: q.id + '-algorithm-v2',
          }));
          return { ...scene, content: { ...scene.content, questions } };
        }
        return scene;
      });
      if (!slides && !quizzes) continue;
      const next = {
        ...document,
        scenes,
        outline: { ...outline, outlines, updatedAt: Date.now() },
        stage: { ...document.stage, updatedAt: Date.now() },
      };
      if (apply) {
        await writeFile(
          `logs/${stageId}-before-teaching-layout-${stamp}.json`,
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
          const current = await tx.query(
            'SELECT rev FROM document_stage_revision WHERE stage_id=$1 FOR UPDATE',
            [stageId],
          );
          if (Number(current.rows[0]?.rev) !== revision.rev)
            throw new Error('Concurrent edit; stopped for ' + stageId);
          seen.add(tx);
        });
        await guarded.saveDocument(next);
        const saved = await store.loadDocument(stageId);
        if (
          !saved ||
          !isDeepStrictEqual(saved.scenes, scenes) ||
          !isDeepStrictEqual(saved.outline, next.outline)
        )
          throw new Error('Post-save verification failed');
      }
      report.push({ stageId, slides, quizzes, applied: apply, labAssetsAndDraftsUnchanged: true });
    }
    await writeFile(
      `logs/algorithm-teaching-repair-${stamp}.json`,
      JSON.stringify(report, null, 2),
      { flag: 'wx' },
    );
    console.log(JSON.stringify(report));
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
