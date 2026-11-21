/** Repair only prompt-contaminated lecture pages, with backups and revision fences. */
import { createRequire } from 'node:module';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { Pool } from 'pg';
import { getOwnerScopedDocumentStore } from '../lib/server/agent-runtime/owner-scoped-documents';
import { getEduplusCourseStore } from '../lib/persistence/eduplus-courses';
import {
  repairLectureSlide,
  hasLectureMetadata,
  lectureKeyPoints,
} from '../lib/eduplus/lecture-content';
import { repairNativeTextClearance } from '../lib/edit/native-text-clearance';
import { avoidDecorativeTextOverlap } from '../lib/edit/decorative-text-clearance';
import type { AppDocumentOutline } from '../lib/document-store/persistence-types';
import type { PublicCourse } from '../lib/server/eduplus-internal.generated';
import type { Action } from '../lib/types/action';
const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const seed = process.argv[2],
  apply = process.argv.includes('--apply');
const verifyBackups = process.argv.includes('--verify-backups');
if (apply && verifyBackups) throw new Error('Verification is read-only');
if (!/^stage-[A-Za-z0-9_-]+$/.test(seed ?? '')) throw new Error('Specify classroom');
function plain(html: string) {
  let text = '';
  function visit(node: DefaultTreeAdapterTypes.Node) {
    if ('value' in node) text += node.value;
    if ('childNodes' in node) node.childNodes.forEach(visit);
  }
  visit(parseFragment(html));
  return text.trim();
}
interface Material {
  facts: string[];
  overview: string;
  example?: { input: unknown; expected: unknown };
}
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
    const store = await getOwnerScopedDocumentStore(owner),
      courses = await getEduplusCourseStore();
    const pending = [],
      publicCourses: Record<string, PublicCourse> = {};
    const backupNames = verifyBackups ? (await readdir('logs')).sort() : [];
    for (const stageId of ids) {
      const live = await store.loadDocument(stageId),
        revision = await store.readFreshnessManifest(stageId);
      const backup = backupNames.find(
        (name) => name.startsWith(stageId + '-before-lecture-content-') && name.endsWith('.json'),
      );
      if (verifyBackups && !backup) continue;
      const document = backup
        ? (JSON.parse(await readFile('logs/' + backup, 'utf8')) as NonNullable<typeof live>)
        : live;
      if (
        !document ||
        !revision ||
        !document.outline ||
        !document.scenes.some(
          (s) =>
            s.type === 'slide' &&
            s.content.type === 'slide' &&
            s.content.canvas.elements.some(
              (e) => e.type === 'text' && hasLectureMetadata(plain(e.content)),
            ),
        )
      )
        continue;
      const outline = document.outline as AppDocumentOutline;
      const ref = outline.outlines.find((item) => item.eduplus)?.eduplus;
      if (!ref) continue;
      const course = await courses.get(owner, ref.courseId);
      if (!course) throw new Error('Missing owned course');
      publicCourses[ref.courseId] = course;
      pending.push({ stageId, document, revision, outline, course, live });
    }
    const stamp = Date.now(),
      input = `logs/lecture-material-input-${stamp}.json`,
      output = `logs/lecture-material-output-${stamp}.json`;
    await writeFile(input, JSON.stringify(publicCourses), { flag: 'wx' });
    execFileSync(
      path.resolve('.venv/Scripts/python.exe'),
      ['scripts/build-lecture-material.py', input, output],
      { timeout: 120000 },
    );
    const materials = JSON.parse(await readFile(output, 'utf8')) as Record<string, Material>;
    const report = [];
    for (const { stageId, document, revision, outline, course, live } of pending) {
      const material = materials[course.courseId];
      material.facts = lectureKeyPoints(material.facts);
      if (!material.facts.length) throw new Error('Missing subject matter');
      let slides = 0;
      const scenes = document.scenes.map((scene) => {
        if (scene.type !== 'slide' || scene.content.type !== 'slide') return scene;
        const canvas = scene.content.canvas;
        const rewritten = repairLectureSlide(
          canvas.elements,
          scene.title,
          material.facts,
          material.example,
        );
        if (rewritten === canvas.elements) return scene;
        const elements = avoidDecorativeTextOverlap(
          repairNativeTextClearance(
            rewritten,
            canvas.viewportSize,
            canvas.viewportSize * canvas.viewportRatio,
          ),
          canvas.viewportSize,
          canvas.viewportSize * canvas.viewportRatio,
        );
        if (elements.some((e) => e.type === 'text' && hasLectureMetadata(plain(e.content))))
          throw new Error('Prompt metadata remains after repair');
        // Narration must describe the corrected slide, never play stale audio.
        const lines = elements
          .filter((e) => e.type === 'text')
          .sort((a, b) => a.top - b.top)
          .map((e) => plain(e.content))
          .filter(Boolean);
        let speech = 0;
        const count = scene.actions?.filter((a) => a.type === 'speech').length ?? 0;
        const actions = scene.actions?.flatMap<Action>((action): Action[] => {
          if (action.type !== 'speech') return [action];
          if (speech >= lines.length) return [];
          const text = speech === count - 1 ? lines.slice(speech).join('。') : lines[speech];
          speech++;
          const { audioId: _id, ...rest } = action;
          if ('audioUrl' in rest) delete rest.audioUrl;
          return [{ ...rest, text, audioInvalidated: true }];
        });
        slides++;
        return {
          ...scene,
          ...(actions ? { actions } : {}),
          content: { ...scene.content, canvas: { ...canvas, elements } },
        };
      });
      if (!slides) continue;
      const outlines = outline.outlines.map((item) => ({
        ...item,
        ...(item.type === 'slide'
          ? { description: `${item.title}：${material.overview}`, keyPoints: material.facts }
          : {}),
        ...(item.eduplus?.courseId === course.courseId
          ? {
              eduplus: {
                ...item.eduplus,
                teaching: { ...item.eduplus.teaching, overview: material.overview },
              },
            }
          : {}),
        ...(item.algorithmDemo?.courseId === course.courseId
          ? {
              algorithmDemo: {
                ...item.algorithmDemo,
                teaching: { ...item.algorithmDemo.teaching, overview: material.overview },
              },
            }
          : {}),
      }));
      const next = {
        ...document,
        scenes,
        outline: { ...outline, outlines, updatedAt: Date.now() },
        stage: { ...document.stage, updatedAt: Date.now() },
      };
      if (verifyBackups) {
        if (
          !live ||
          !isDeepStrictEqual(live.scenes, JSON.parse(JSON.stringify(scenes))) ||
          !isDeepStrictEqual((live.outline as AppDocumentOutline).outlines, outlines)
        )
          throw new Error('Backup replay differs from saved classroom: ' + stageId);
      }
      if (apply) {
        await writeFile(
          `logs/${stageId}-before-lecture-content-${stamp}.json`,
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
            throw new Error('Concurrent edit; repair stopped for ' + stageId);
          seen.add(tx);
        });
        await guarded.saveDocument(next);
        const saved = await store.loadDocument(stageId);
        if (
          !saved ||
          !isDeepStrictEqual(saved.scenes, JSON.parse(JSON.stringify(scenes))) ||
          !isDeepStrictEqual(saved.outline, next.outline)
        ) {
          await writeFile(`logs/${stageId}-lecture-expected-${stamp}.json`, JSON.stringify(next));
          await writeFile(`logs/${stageId}-lecture-actual-${stamp}.json`, JSON.stringify(saved));
          throw new Error('Post-save verification failed for ' + stageId);
        }
      }
      report.push({
        stageId,
        topic: course.topic,
        slides,
        applied: apply,
        verifiedFromBackup: verifyBackups,
        courseAssetsAndDraftsUnchanged: true,
      });
    }
    await writeFile(`logs/lecture-content-repair-${stamp}.json`, JSON.stringify(report, null, 2), {
      flag: 'wx',
    });
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
