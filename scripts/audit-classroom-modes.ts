/** Live smoke check through the same services as a generation run.
 * Reads the selected classroom's owner, writes audit artifacts only, and never
 * replaces a saved lesson or executes model-generated code on the host. */
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { defaultRunStepServices } from '../lib/server/generation/run/services';
import { validateAppScene } from '../lib/document-store/validators';
import { createLogger } from '../lib/logger';
import type { SceneActionsInput } from '../lib/server/generation/steps/scene-actions';
import type { OutlineResult } from '../lib/server/generation/steps/outline';

const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const stageId = process.argv[2];
const mode = process.argv[3] ?? 'general';
if (!stageId || !/^[\w-]{6,100}$/.test(stageId)) throw new Error('Select an existing stage');
const requests = {
  general: {
    locale: 'zh-CN',
    requirement:
      '请给十岁儿童讲解分数加法。只生成三页：通分讲解、计算例题、一道随堂检测。不要编程，不要项目，不要图片和视频。',
  },
  theory: {
    locale: 'en-US',
    requirement:
      'Explain binary search, theory only. Create three pages: concept, a worked example, and one algorithm quiz. No images or videos.',
  },
  project: {
    locale: 'zh-CN',
    requirement:
      '采用项目式学习设计一个校园节水调查项目。两页：学习目标讲解、PBL调查项目。不要编程，不要图片和视频。',
  },
};
if (!(mode in requests)) throw new Error('Unknown audit mode');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const { rows } = await pool.query(
    'SELECT owner_id FROM stage_meta WHERE stage_id=$1 AND deleted_at IS NULL',
    [stageId],
  );
  if (!rows[0]) throw new Error('Stage not found');
  const ownerId = rows[0].owner_id as string;
  const requirements = requests[mode as keyof typeof requests];
  const quizOnly = process.argv.includes('--quiz-only');
  const resumeOutline = quizOnly
    ? (JSON.parse(await readFile(`logs/classroom-mode-${mode}-generated.json`, 'utf8'))
        .outlined as OutlineResult)
    : undefined;
  const ctx = { signal: AbortSignal.timeout(600_000), log: createLogger('ClassroomModeAudit') };
  const outlined = await defaultRunStepServices.outline(
    ownerId,
    {
      requirements,
      pdfText: '',
      pdfImages: [],
      imageMapping: {},
      researchContext: '',
      allowImageGeneration: false,
      allowVideoGeneration: false,
      ...(resumeOutline ? { resumeOutline } : {}),
    },
    ctx,
  );
  if (mode !== 'project' && outlined.outlines.some((item) => item.type === 'pbl' || item.eduplus))
    throw new Error('Unexpected project or Lab in a non-practical course');
  if (mode === 'project' && !outlined.outlines.some((item) => item.type === 'pbl'))
    throw new Error('Explicit project request lost its project scene');
  const scenes = [];
  let previousSpeeches: string[] = [];
  for (const outline of outlined.outlines.filter((item) => !quizOnly || item.type === 'quiz')) {
    const generated = await defaultRunStepServices.sceneContent(
      ownerId,
      {
        outline,
        requirements,
        languageDirective: outlined.languageDirective,
        targetLanguage: requirements.locale,
        pdfImages: [],
        imageMapping: {},
        agents: [],
      },
      ctx,
    );
    const assembled = await defaultRunStepServices.sceneActions(
      ownerId,
      {
        outline: generated.effectiveOutline,
        allOutlines: outlined.outlines,
        content: generated.content as SceneActionsInput['content'],
        stageId: 'stage-local-mode-audit',
        agents: [],
        previousSpeeches,
        languageDirective: outlined.languageDirective,
      },
      ctx,
    );
    const validation = validateAppScene(assembled.scene);
    if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
    scenes.push(assembled.scene);
    previousSpeeches = [...previousSpeeches, ...assembled.previousSpeeches];
    console.log(
      JSON.stringify({
        mode,
        complete: scenes.length,
        total: outlined.outlines.length,
        type: outline.type,
      }),
    );
  }
  await writeFile(
    `logs/classroom-mode-${mode}-${quizOnly ? 'quiz-reviewed' : 'generated'}.json`,
    JSON.stringify({ outlined, scenes }),
  );
  console.log(
    JSON.stringify({
      mode,
      status: 'passed',
      scenes: scenes.length,
      language: outlined.languageDirective,
    }),
  );
} finally {
  await pool.end();
}
process.exit(0);
