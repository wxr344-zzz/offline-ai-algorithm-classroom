/** Local maintenance: install an inspected generated lesson into a backed-up owned classroom. */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { getOwnerScopedDocumentStore } from '../lib/server/agent-runtime/owner-scoped-documents';
import { getEduplusCourseStore } from '../lib/persistence/eduplus-courses';
import { bindEmbeddedLabsIn, embeddedLabContent } from '../lib/server/eduplus-native-generation';
import { nativeEmbeddedSceneId } from '../lib/eduplus/native-outline';
import type { AppDocumentOutline } from '../lib/document-store/persistence-types';
import type { Scene } from '../lib/types/stage';
import { isTwoSumTopic, twoSumWidget } from '../lib/eduplus/two-sum-widget';
import { twoSumSlide } from '../lib/eduplus/two-sum-slide';
const requireLocal = createRequire(import.meta.url);
createRequire(requireLocal.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const [targetId, sourceId] = process.argv.slice(2);
if (
  ![targetId, sourceId].every((id) => /^stage-[a-zA-Z0-9_-]+$/.test(id ?? '')) ||
  targetId === sourceId
)
  throw new Error('Specify different target and inspected source stage IDs');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const owners = await pool.query(
      'SELECT stage_id, owner_id FROM stage_meta WHERE stage_id=ANY($1::text[]) AND deleted_at IS NULL',
      [[targetId, sourceId]],
    );
    const targetOwner = owners.rows.find((row) => row.stage_id === targetId)?.owner_id;
    const sourceOwner = owners.rows.find((row) => row.stage_id === sourceId)?.owner_id;
    if (!targetOwner || !sourceOwner) throw new Error('Classroom not found');
    const targetStore = await getOwnerScopedDocumentStore(targetOwner);
    const sourceStore = await getOwnerScopedDocumentStore(sourceOwner);
    const target = await targetStore.loadDocument(targetId);
    const source = await sourceStore.loadDocument(sourceId);
    const revision = await targetStore.readFreshnessManifest(targetId);
    if (!target || !source || !revision) throw new Error('Classroom unavailable');
    const sourceOutline = source.outline as AppDocumentOutline;
    const targetOutline = target.outline as AppDocumentOutline;
    if (!sourceOutline?.generationComplete || !targetOutline?.generationComplete)
      throw new Error('Both classrooms must have completed generation');
    if (!isTwoSumTopic(source.stage.name))
      throw new Error('Only the inspected Two Sum curriculum is supported');
    const backup = `logs/${targetId}-before-quality-repair.json`;
    await writeFile(backup, JSON.stringify(target, null, 2), { flag: 'wx' });
    const courses = await getEduplusCourseStore();
    const mapping = new Map<string, string>();
    for (const outline of sourceOutline.outlines) {
      const sourceCourseId = outline.eduplus?.courseId;
      if (!sourceCourseId || mapping.has(sourceCourseId)) continue;
      const publicCourse = await courses.get(sourceOwner, sourceCourseId);
      const privateOutput = await courses.getPrivateForTeacher(sourceOwner, sourceCourseId);
      if (!publicCourse || !privateOutput?.problem?.oj_assessment)
        throw new Error('Missing independent private assessment');
      const cloned = structuredClone({ publicCourse, privateOutput });
      const newId = randomUUID();
      cloned.publicCourse.courseId = newId;
      cloned.privateOutput.course_id = newId;
      for (const scene of cloned.publicCourse.scenes) {
        scene.courseId = newId;
        scene.sceneId = randomUUID();
        scene.problem.problemId = randomUUID();
        if (
          scene.sceneType === 'oj-lab' &&
          scene.problem.executionMode === 'stdio' &&
          scene.problem.title === '露营采购：预算内的最佳双物品组合'
        )
          scene.problem.standardIoProfile = 'budget-pair';
        if (scene.sceneType === 'guided-lab') {
          scene.problem.instructions =
            '给定整数数组 nums 和整数 target，返回两个不同下标 [i,j]，使 nums[i]+nums[j]==target。返回下标按升序排列 i<j，不得重复使用同一个位置。本题评测输入只有唯一解或无解；无解或空数组返回 []。例如 nums=[2,7,11,15]、target=9，返回 [0,1]。请实现 Solution.solve(nums: list[int], target: int) -> list[int]。';
          scene.markdownContent = `# ${scene.problem.title}\n\n${scene.problem.instructions}`;
          scene.problem.constraints = [
            '0 <= len(nums) <= 10000',
            'nums 元素与 target 为 -10^9 到 10^9 的整数',
            '只有唯一解或无解；返回升序下标或空列表',
          ];
          cloned.privateOutput.problem!.guided_scene = structuredClone(scene);
          cloned.privateOutput.lab!.instructions = scene.problem.instructions;
        } else cloned.privateOutput.problem!.oj_scene = structuredClone(scene);
      }
      await courses.save(targetOwner, cloned);
      mapping.set(sourceCourseId, newId);
    }
    const outlines = sourceOutline.outlines.map((item) => ({
      ...item,
      ...(item.eduplus
        ? { eduplus: { ...item.eduplus, courseId: mapping.get(item.eduplus.courseId)! } }
        : {}),
    }));
    const scenes: Scene[] = [];
    for (const scene of source.scenes) {
      const outline = outlines.find((item) => item.id === scene.outlineId);
      if (!outline) throw new Error('Source scene/outline mismatch');
      const id = outline.eduplus ? nativeEmbeddedSceneId(targetId, outline) : randomUUID();
      let content = structuredClone(scene.content);
      if (content.type === 'slide')
        content = { ...content, canvas: { ...content.canvas, ...twoSumSlide(scene.title) } };
      if (
        content.type === 'interactive' &&
        (content.widgetType === 'simulation' || content.widgetType === 'game')
      )
        content = { ...content, html: twoSumWidget(content.widgetType) };
      if (outline.eduplus) {
        const generated = await embeddedLabContent(targetOwner, outline);
        content =
          outline.eduplus.phase === 'quiz'
            ? ({ type: 'quiz', ...generated } as Scene['content'])
            : ({ type: 'interactive', ...generated } as Scene['content']);
      }
      scenes.push({
        ...scene,
        id,
        stageId: targetId,
        content,
        actions: scene.actions?.map((action) => ({
          ...action,
          id: randomUUID(),
          ...(action.type === 'speech' && outline.eduplus?.phase === 'oj-lab'
            ? {
                text: '现在独立完成同一考点下的迁移题，请从空白作答区独立实现。公开测试用于练习，正式判题暂未启用。',
              }
            : {}),
        })),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as Scene);
    }
    const checked = new WeakSet<object>();
    const guarded = await getOwnerScopedDocumentStore(targetOwner, async (tx) => {
      if (checked.has(tx)) return;
      await tx.query(
        'SELECT stage_id FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 FOR UPDATE',
        [targetId, targetOwner],
      );
      const current = await tx.query(
        'SELECT rev FROM document_stage_revision WHERE stage_id=$1 FOR UPDATE',
        [targetId],
      );
      if (Number(current.rows[0]?.rev) !== revision.rev)
        throw new Error('Concurrent edit; classroom was not replaced');
      await bindEmbeddedLabsIn(tx, targetOwner, targetId, outlines);
      checked.add(tx);
    });
    await guarded.saveDocument({
      ...target,
      scenes,
      stage: {
        ...target.stage,
        name: source.stage.name,
        languageDirective: source.stage.languageDirective,
        agentIds: source.stage.agentIds,
        generatedAgentConfigs: source.stage.generatedAgentConfigs,
        updatedAt: Date.now(),
      },
      outline: {
        ...sourceOutline,
        outlines,
        producerRef: `eduplus-quality-repair:${targetId}`,
        updatedAt: Date.now(),
      },
    });
    console.log(
      JSON.stringify({
        stageId: targetId,
        repaired: true,
        sceneCount: scenes.length,
        backup,
        oldAssetsAndDraftsRetained: true,
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
