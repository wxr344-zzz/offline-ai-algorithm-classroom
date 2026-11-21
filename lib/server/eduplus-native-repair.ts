import type { OwnerPrincipal } from '@/lib/server/identity/types';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { AgentAPIError } from './eduplus-agent-client';
import {
  prepareEmbeddedLabs,
  bindEmbeddedLabsIn,
  embeddedLabContent,
  embeddedAlgorithmContent,
} from './eduplus-native-generation';
import { defaultRunStepServices } from '@/lib/server/generation/run/services';
import type { SceneOutline } from '@/lib/types/generation';
import { createLogger } from '@/lib/logger';
import type { AppDocumentOutline } from '@/lib/document-store/persistence-types';
import type { Scene } from '@/lib/types/stage';
import type { SceneActionsInput } from '@/lib/server/generation/steps/scene-actions';
import { validateAppScene } from '@/lib/document-store/validators';
import { StepRefusal } from '@/lib/server/generation/steps/context';
import { courseIntent } from '@/lib/eduplus/course-intent';
import type { SceneActionsResult } from '@/lib/server/generation/steps/scene-actions';
import { isLegacyPythonLab } from '@/lib/eduplus/legacy-lab';
import { readGenerationRun } from '@/lib/server/generation/run/store';

/** Upgrade the owned existing classroom in place. Non-Python scenes and stage identity are retained. */
export async function repairNativeLabs(
  owner: string | OwnerPrincipal,
  stageId: string,
  signal?: AbortSignal,
  options: { regenerateLabs?: boolean; regenerateLectures?: boolean; repairFeedback?: string; verifiedCourseId?: string } = {},
) {
  const ownerId = typeof owner === 'string' ? owner : owner.ownerId;
  const store = await getOwnerScopedDocumentStore(owner);
  // The manifest is owner-only, unlike the native capability-by-id document read.
  const revision = await store.readFreshnessManifest(stageId);
  if (!revision) throw new AgentAPIError(404, 'COURSE_NOT_FOUND', '课程不存在或无权修改。');
  const original = await store.loadDocument(stageId);
  if (!original) throw new AgentAPIError(404, 'COURSE_NOT_FOUND', '课程不存在。');
  const originalOutline = original.outline as AppDocumentOutline | undefined;
  if (originalOutline?.generationComplete === false)
    throw new AgentAPIError(409, 'COURSE_GENERATING', '课程还在生成，请完成生成后再修复。');
  const guided = original.scenes.find(
    (scene) =>
      scene.content.type === 'interactive' && scene.content.eduplus?.phase === 'guided-lab',
  );
  const courseId =
    guided?.content.type === 'interactive' ? guided.content.eduplus?.courseId : undefined;
  const completePair =
    courseId &&
    original.scenes.some(
      (scene) =>
        scene.content.type === 'interactive' &&
        scene.content.eduplus?.courseId === courseId &&
        scene.content.eduplus.phase === 'oj-lab',
    );
  if (!options.regenerateLabs && completePair) {
    const legacy = original.scenes.filter((scene) => isLegacyPythonLab(scene.content));
    if (!legacy.length) return { stageId, changed: false, ready: true };
    const obsolete = new Set(legacy.flatMap((scene) => [scene.id, scene.outlineId ?? scene.id]));
    const checked = new WeakSet<object>();
    const fenced = await getOwnerScopedDocumentStore(owner, async (tx) => {
      if (checked.has(tx)) return;
      await tx.query('SELECT stage_id FROM stage_meta WHERE stage_id=$1 FOR UPDATE', [stageId]);
      const current = await tx.query(
        'SELECT rev FROM document_stage_revision WHERE stage_id=$1 FOR UPDATE',
        [stageId],
      );
      if (Number(current.rows[0]?.rev ?? -1) !== revision.rev)
        throw new AgentAPIError(
          409,
          'COURSE_CHANGED',
          '课程在修复过程中发生修改，未覆盖原课程，请重试。',
        );
      checked.add(tx);
    });
    signal?.throwIfAborted();
    await fenced.saveDocument({
      ...original,
      stage: { ...original.stage, updatedAt: Date.now() },
      scenes: original.scenes
        .filter((scene) => !obsolete.has(scene.id))
        .map((scene, order) => ({ ...scene, order })),
      ...(originalOutline
        ? {
            outline: {
              ...originalOutline,
              outlines: (originalOutline.outlines ?? [])
                .filter((item) => !obsolete.has(item.id))
                .map((item, order) => ({ ...item, order })),
              updatedAt: Date.now(),
            },
          }
        : {}),
    });
    return { stageId, changed: true, ready: true, removedLegacyScenes: legacy.length };
  }
  let requirement = originalOutline?.requirement ?? original.stage.name;
  if (originalOutline?.producerRef?.startsWith('run-')) {
    const run = await readGenerationRun(originalOutline.producerRef, ownerId);
    if (run?.stageId === stageId) requirement = run.input.requirement;
  }
  const oldLabQuizIds = new Set(
    (originalOutline?.outlines ?? [])
      .filter((item) => item.eduplus?.phase === 'quiz')
      .map((item) => item.id),
  );
  const retainedScenes = options.regenerateLabs
    ? original.scenes.filter(
        (scene) =>
          !oldLabQuizIds.has(scene.outlineId ?? scene.id) &&
          !(
            'eduplus' in scene.content &&
            scene.content.eduplus &&
            ['guided-lab', 'oj-lab', 'review'].includes(scene.content.eduplus.phase)
          ),
      )
    : original.scenes;
  const outlines: SceneOutline[] = retainedScenes.map((scene, order) => ({
    id: scene.id,
    type: scene.type,
    title: scene.title,
    description: scene.title,
    keyPoints: [],
    order,
    ...(scene.type === 'interactive'
      ? {
          widgetType: scene.content.widgetType,
          widgetOutline: {
            language: isLegacyPythonLab(scene.content) ? ('python' as const) : undefined,
            concept: scene.title,
          },
        }
      : {}),
  }));
  if (
    !outlines.some(
      (item) => item.widgetType === 'code' && item.widgetOutline?.language === 'python',
    ) &&
    !courseIntent(requirement).programming
  )
    return { stageId, changed: false };
  const prepared = await prepareEmbeddedLabs(
    ownerId,
    {
      outlines,
      languageDirective: original.stage.languageDirective ?? '',
      courseTitle: original.stage.name,
      taskEngineMode: false,
    },
    `${requirement}${options.repairFeedback ? `\n上次生成的质量反馈（重新核验，不得复制错误样例）：${options.repairFeedback.slice(0, 4000)}` : ''}`,
    signal,
    options.verifiedCourseId ? { courseId: options.verifiedCourseId } : undefined,
  );
  const ctx = { signal, log: createLogger('NativeLabRepair') };
  const agents =
    original.stage.generatedAgentConfigs ??
    (await defaultRunStepServices.presetAgents(ownerId, original.stage.agentIds ?? []));
  const scenes: Scene[] = [];
  for (const outline of prepared.outlines) {
    signal?.throwIfAborted();
    const previous = original.scenes.find((scene) => scene.id === outline.id);
    if (previous && !(options.regenerateLectures && previous.type === 'slide')) {
      const quizContent =
        outline.eduplus?.phase === 'quiz' ? await embeddedLabContent(ownerId, outline) : null;
      const demoContent = outline.algorithmDemo
        ? await embeddedAlgorithmContent(ownerId, outline)
        : null;
      scenes.push({
        ...previous,
        outlineId: outline.id,
        order: outline.order,
        ...(quizContent ? { content: { type: 'quiz', ...quizContent } } : {}),
        ...(demoContent ? { content: { type: 'interactive', ...demoContent } } : {}),
      } as Scene);
      continue;
    }
    let generated: SceneActionsResult | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const trial =
        attempt === 0
          ? outline
          : {
              ...outline,
              description: `${outline.description}\n上次生成未通过校验。重新输出完整有效 HTML，原生 JavaScript/Canvas，禁止外部依赖。检查括号、字符串、函数声明与 DOM 初始化。`,
            };
      try {
        const content = await defaultRunStepServices.sceneContent(
          ownerId,
          { outline: trial, agents, languageDirective: prepared.languageDirective },
          ctx,
        );
        generated = await defaultRunStepServices.sceneActions(
          ownerId,
          {
            outline: trial,
            allOutlines: prepared.outlines,
            content: content.content as SceneActionsInput['content'],
            stageId,
            agents,
            languageDirective: prepared.languageDirective,
          },
          ctx,
        );
        break;
      } catch (error) {
        if (attempt === 1 || !(error instanceof StepRefusal) || signal?.aborted) throw error;
        ctx.log.warn(`Retrying native interactive generation: ${outline.id}`);
      }
    }
    if (!generated)
      throw new AgentAPIError(502, 'GENERATION_FAILED', '互动页面生成失败，未修改原课程。');
    if (!validateAppScene(generated.scene).valid)
      throw new AgentAPIError(502, 'INVALID_SCENE', '生成的互动页面结构无效，未修改原课程。');
    scenes.push(generated.scene as Scene);
  }
  const checked = new WeakSet<object>();
  const fenced = await getOwnerScopedDocumentStore(owner, async (tx) => {
    if (!checked.has(tx)) {
      await tx.query('SELECT stage_id FROM stage_meta WHERE stage_id=$1 FOR UPDATE', [stageId]);
      const current = await tx.query(
        'SELECT rev FROM document_stage_revision WHERE stage_id=$1 FOR UPDATE',
        [stageId],
      );
      if (Number(current.rows[0]?.rev ?? -1) !== revision.rev)
        throw new AgentAPIError(
          409,
          'COURSE_CHANGED',
          '课程在修复过程中发生修改，未覆盖原课程，请重试。',
        );
      checked.add(tx);
    }
    await bindEmbeddedLabsIn(
      tx,
      ownerId,
      stageId,
      prepared.outlines,
      new Map(scenes.map((scene) => [scene.outlineId ?? scene.id, scene.id])),
    );
  });
  signal?.throwIfAborted();
  await fenced.saveDocument({
    ...original,
    stage: {
      ...original.stage,
      name: prepared.courseTitle ?? original.stage.name,
      updatedAt: Date.now(),
    },
    scenes,
    outline: {
      outlines: prepared.outlines,
      requirement,
      generationComplete: true,
      producer: 'server-job',
      producerRef: `eduplus-repair:${stageId}`,
      createdAt: originalOutline?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    },
  });
  return { stageId, changed: true, sceneCount: scenes.length };
}
