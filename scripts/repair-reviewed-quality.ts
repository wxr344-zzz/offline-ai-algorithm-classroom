/** Explicit repair of audited test classrooms; old assets remain immutable. */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Pool } from 'pg';
import { getOwnerScopedDocumentStore } from '../lib/server/agent-runtime/owner-scoped-documents';
import { getEduplusCourseStore } from '../lib/persistence/eduplus-courses';
import {
  bindEmbeddedLabsIn,
  embeddedLabContent,
  embeddedAlgorithmContent,
} from '../lib/server/eduplus-native-generation';
import type { AppDocumentOutline } from '../lib/document-store/persistence-types';
import type { GeneratedCourse } from '../lib/server/eduplus-internal.generated';
import { callTeachingCore } from '../lib/server/eduplus-agent-client';
import { localizeSpeeches } from '../lib/server/generation/steps/speech-language';
import { shortestPathTrace } from '../lib/eduplus/graph-trace';
import { orderNativeLabOutlines } from '../lib/eduplus/native-outline';
import type { Scene } from '../lib/types/stage';
const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const stageId = process.argv[2];
if (!/^stage-[A-Za-z0-9_-]+$/.test(stageId ?? '')) throw new Error('Specify one classroom');
const reviewedProof = process.argv[4];
if (reviewedProof && (!['executable', 'executable-programming'].includes(process.argv[3]) ||
  !/^logs\/[A-Za-z0-9_.-]+\.json$/.test(reviewedProof)))
  throw new Error('A reviewed execution proof must be a local logs JSON file');
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
    if (['executable', 'executable-programming'].includes(process.argv[3])) {
      const source = await pool.query(
        "SELECT input->>'requirement' AS requirement FROM generation_runs WHERE stage_id=$1 AND owner_id=$2 ORDER BY created_at DESC LIMIT 1",
        [stageId, owner],
      );
      await writeFile(`logs/${stageId}-source-requirement.txt`, source.rows[0]?.requirement ?? '');
    }
    const courses = await getEduplusCourseStore();
    const original = await courses.getPrivateForTeacher(owner, oldId);
    if (!original) throw new Error('Missing private assets');

    for (const [file, value] of [
      [`logs/${stageId}-${oldId}-before-quality-document.json`, document],
      [`logs/${stageId}-${oldId}-before-quality-private.json`, original],
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
        'scripts/build-reviewed-quality-repair.py',
        `logs/${stageId}-${oldId}-before-quality-private.json`,
        `logs/${stageId}-quality-assets.json`,
        process.argv[3],
        `logs/${stageId}-source-requirement.txt`,
        reviewedProof ?? '',
        `owner:${createHash('sha256').update(owner).digest('hex')}`,
      ],
      { timeout: ['regenerated', 'executable', 'executable-programming'].includes(process.argv[3]) ? 900000 : 420000 },
    );
    const generated = JSON.parse(
      await readFile(`logs/${stageId}-quality-assets.json`, 'utf8'),
    ) as GeneratedCourse;
    await courses.save(owner, generated);
    const courseId = generated.publicCourse.courseId;
    const previousPublic = await courses.get(owner, oldId);
    const previousTeaching = outline.outlines.find((item) => item.eduplus?.courseId === oldId)
      ?.eduplus?.teaching;
    const inputsAndAnswers = (course: typeof generated.publicCourse) =>
      course.scenes.map((scene) =>
        scene.problem.publicTestCases.map((item) => ({
          caseId: item.caseId,
          inputs: item.inputs,
          expected: item.expected,
        })),
      );
    const teaching =
      (['dijkstra-adjacency', 'kruskal', 'bst'].includes(process.argv[3]) && previousTeaching) ||
      (previousPublic &&
        previousTeaching &&
        !['capped-matches', 'search-lesson'].includes(process.argv[3]) &&
        JSON.stringify(inputsAndAnswers(previousPublic)) ===
          JSON.stringify(inputsAndAnswers(generated.publicCourse)))
        ? previousTeaching
        : ['lcs', 'capped-matches', 'search-lesson'].includes(process.argv[3])
          ? JSON.parse(
              execFileSync(
                path.resolve('.venv/Scripts/python.exe'),
                [
                  '-c',
                  process.argv[3] === 'lcs'
                    ? 'import json,sys; from pathlib import Path; from lab_contracts import PublicCourse; from lcs_assets import reviewed_lcs_teaching; data=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")); print(json.dumps(reviewed_lcs_teaching(PublicCourse.model_validate(data["publicCourse"])),ensure_ascii=True))'
                    : 'import json,sys; from pathlib import Path; from lab_contracts import PublicCourse; from capped_match_assets import reviewed_teaching; data=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")); print(json.dumps(reviewed_teaching(PublicCourse.model_validate(data["publicCourse"])),ensure_ascii=True))',
                  `logs/${stageId}-quality-assets.json`,
                ],
                { encoding: 'utf8' },
              ),
            )
          : await callTeachingCore(generated.publicCourse, AbortSignal.timeout(300000));
    if (process.argv[3] === 'kruskal') {
      teaching.overview =
        'Kruskal 先按边权排序，再用并查集判断端点是否已连通。只选连接不同集合的边，避免成环；最终需要 n-1 条边。';
      teaching.demoExplanation =
        '以 A、B、C 三个顶点为例：候选边为 A—B（1）、B—C（2）、A—C（3）。观察每次选边后的连通集合与累计成本。游戏要求排列这几次具体决策。';
      teaching.algorithmTrace = {
        exampleCaseId: generated.publicCourse.scenes[0].problem.publicTestCases[0].caseId,
        outcome: 3,
        steps: [
          {
            label: '初始化并排序候选边',
            explanation: '边按费用从小到大为 AB=1、BC=2、AC=3。三个顶点各自属于不同集合。',
            values: ['集合 {A}', '集合 {B}', '集合 {C}', '累计费用 0'],
            activeIndices: [],
          },
          {
            label: '选择 A—B，费用 1',
            explanation: 'A 与 B 不在同一集合，加入 AB 并合并。',
            values: ['集合 {A,B}', '集合 {C}', '已选 AB', '累计费用 1'],
            activeIndices: [0, 2],
          },
          {
            label: '选择 B—C，费用 2',
            explanation: 'B 所在集合为 {A,B}，C 在另一个集合；加入 BC 后全部连通。',
            values: ['集合 {A,B,C}', '已选 AB、BC', '累计费用 3'],
            activeIndices: [0, 1],
          },
          {
            label: '拒绝 A—C 并结束',
            explanation: 'A、C 已连通，再加入 AC 会成环。已选 3-1 条边，最小总费用为 3。',
            values: ['跳过 AC=3', '最小总费用 3'],
            activeIndices: [1],
          },
        ],
      };
      teaching.questions = [
        {
          question: 'Kruskal 按什么顺序考察候选边？',
          options: ['边权升序', '边权降序', '顶点编号降序', '随机顺序'],
          answer: 'A',
          analysis: '从小到大考察边权，在不成环的前提下选边。',
        },
        {
          question: '什么时候应跳过一条候选边？',
          options: ['两端点已在同一连通集合', '权重为零', '它连接不同集合', '两端点编号不同'],
          answer: 'A',
          analysis: '同一集合中加入这条边会成环。',
        },
        {
          question: '有 n 个顶点的生成树有多少条边？',
          options: ['n-1', 'n', 'n+1', '2n'],
          answer: 'A',
          analysis: '连通无环图的边数为顶点数减一；选边不足则无法形成生成树。',
        },
      ];
    }
    if (process.argv[3] === 'dijkstra-adjacency') {
      const example = generated.publicCourse.scenes[0].problem.publicTestCases[0];
      const computed = shortestPathTrace(generated.publicCourse, example.inputs);
      if (!computed) throw new Error('Reviewed graph representation unavailable');
      const steps =
        computed.steps.length <= 16
          ? computed.steps
          : [...computed.steps.slice(0, 15), computed.steps.at(-1)!];
      teaching.algorithmTrace = {
        exampleCaseId: example.caseId,
        outcome: computed.outcome,
        steps: steps.map(({ label, explanation, values, activeIndices }) => ({
          label,
          explanation,
          values,
          activeIndices,
        })),
      };
      teaching.demoExplanation =
        '观察有向边及其权重、距离表和优先队列；每次弹出最小距离候选，尝试松弛相邻边，直到队列为空。';
    }
    if (process.argv[3]?.startsWith('dijkstra')) {
      // Explicitly reviewed corrections: the generated negative-edge question
      // incorrectly offered both Bellman-Ford and Floyd as competing answers.
      teaching.questions = [
        {
          question: '在距离数组中，尚未发现从源点到某节点的路径时，通常用哪种哨兵值表示？',
          options: ['无穷大', '0', '该节点编号', '源点编号'],
          answer: 'A',
          analysis: '源点距离为 0，其他节点初始距离为无穷大；最终仍为无穷大表示不可达。',
        },
        {
          question: 'Dijkstra 算法的最小优先队列在每轮用于执行什么操作？',
          options: [
            '取出当前已知距离最小的候选节点',
            '取出编号最大的节点',
            '按边权从大到小取边',
            '随机选择未访问节点',
          ],
          answer: 'A',
          analysis: '最小优先队列按当前距离取出候选节点，过期条目应跳过，再对相邻边进行松弛。',
        },
        {
          question: '求单源最短路时，图含负权边但无源点可达的负环，以下哪种算法可直接处理？',
          options: ['标准 Dijkstra', 'Bellman-Ford', '二分查找', '冒泡排序'],
          answer: 'B',
          analysis: 'Bellman-Ford 通过多轮松弛处理负权边；标准 Dijkstra 的正确性依赖非负边权。',
        },
      ];
    }
    const outlines = orderNativeLabOutlines(
      outline.outlines
        .filter(
          (item) =>
            process.argv[3] !== 'kruskal' ||
            item.type !== 'interactive' ||
            item.eduplus ||
            item.algorithmDemo,
        )
        .map((item) => ({
          ...item,
          ...(item.eduplus?.courseId === oldId
            ? { eduplus: { ...item.eduplus, courseId, teaching } }
            : {}),
          ...(item.algorithmDemo?.courseId === oldId
            ? { algorithmDemo: { ...item.algorithmDemo, courseId, teaching } }
            : {}),
        })),
    );
    const scenes: Scene[] = [];
    for (const scene of document.scenes) {
      const item = outlines.find((item) => item.id === scene.outlineId);
      if (!item) continue;
      if (item?.eduplus && (scene.type === 'interactive' || scene.type === 'quiz')) {
        const content = await embeddedLabContent(owner, item);
        scenes.push({ ...scene, content: { ...scene.content, ...content } } as Scene);
      } else if (item?.algorithmDemo && scene.type === 'interactive') {
        const content = await embeddedAlgorithmContent(owner, item);
        scenes.push({ ...scene, content: { ...scene.content, ...content } } as Scene);
      } else scenes.push(scene);
    }
    const speechCounts = scenes.map((scene) => scene.actions?.length ?? 0);
    const actions = scenes.flatMap((scene) => scene.actions ?? []);
    const localized = [
      'floyd',
      'lcs',
      'regenerated',
      'executable',
      'executable-programming',
      'capped-matches',
      'search-lesson',
      'bst',
    ].includes(process.argv[3])
      ? actions
      : await localizeSpeeches(actions, '简体中文', async (system, prompt) => {
          const response = await fetch('http://127.0.0.1:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(180000),
            body: JSON.stringify({
              model: 'qwen2.5-coder:7b',
              stream: false,
              format: 'json',
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: prompt },
              ],
              options: { temperature: 0, num_predict: 4096, num_ctx: 8192 },
            }),
          });
          if (!response.ok) throw new Error('Local translation failed');
          return (await response.json()).message.content;
        });
    let cursor = 0;
    for (let i = 0; i < scenes.length; i++) {
      scenes[i] = {
        ...scenes[i],
        actions: localized.slice(cursor, cursor + speechCounts[i]),
      } as Scene;
      cursor += speechCounts[i];
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
