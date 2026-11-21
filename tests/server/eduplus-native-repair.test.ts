import { beforeEach, describe, expect, it, vi } from 'vitest';
import course from '@/contracts/examples/public-lab.json';
import teachingFixture from '@/tests/fixtures/eduplus-teaching.json';
import { parseTeaching } from '@/lib/eduplus/classroom-contract';
import { embeddedLabScene } from '@/lib/server/eduplus-native-generation';
import type { SceneOutline } from '@/lib/types/generation';
import { repairNativeLabs } from '@/lib/server/eduplus-native-repair';

const deps = vi.hoisted(() => ({
  documents: vi.fn(),
  prepare: vi.fn(),
  bind: vi.fn(),
  save: vi.fn(),
  manifest: vi.fn(),
  load: vi.fn(),
  content: vi.fn(),
  actions: vi.fn(),
  run: vi.fn(),
  rev: 10,
}));
const teaching = parseTeaching(teachingFixture);
vi.mock('@/lib/server/agent-runtime/owner-scoped-documents', () => ({
  getOwnerScopedDocumentStore: deps.documents,
}));
vi.mock('@/lib/server/generation/run/store', () => ({ readGenerationRun: deps.run }));
vi.mock('@/lib/server/eduplus-native-generation', async (original) => ({
  ...(await original<typeof import('@/lib/server/eduplus-native-generation')>()),
  prepareEmbeddedLabs: deps.prepare,
  bindEmbeddedLabsIn: deps.bind,
}));
vi.mock('@/lib/server/generation/run/services', () => ({
  defaultRunStepServices: {
    presetAgents: async () => [],
    sceneContent: deps.content,
    sceneActions: deps.actions,
  },
}));
const original = {
  stage: { id: 'stage-existing', name: '两数加和', generatedAgentConfigs: [], updatedAt: 1000 },
  scenes: [
    {
      id: 'lecture',
      stageId: 'stage-existing',
      type: 'slide',
      title: '概念讲解',
      order: 0,
      content: { type: 'slide', canvas: { untouched: true } },
    },
    {
      id: 'broken',
      stageId: 'stage-existing',
      type: 'interactive',
      title: '编程练习',
      order: 1,
      content: { type: 'interactive', widgetType: 'code', html: '<script>loadPyodide()</script>' },
    },
    {
      id: 'old-quiz',
      stageId: 'stage-existing',
      type: 'quiz',
      title: '原测验',
      order: 2,
      content: { type: 'quiz', questions: [] },
    },
  ],
  outline: { generationComplete: true, createdAt: 1000 },
};
beforeEach(() => {
  vi.clearAllMocks();
  deps.rev = 10;
  deps.run.mockResolvedValue(null);
  deps.manifest.mockResolvedValue({ rev: 10, scenes: [] });
  deps.load.mockResolvedValue(original);
  deps.prepare.mockImplementation(async (_owner, input) => ({
    ...input,
    outlines: [
      input.outlines[0],
      ...(['guided-lab', 'oj-lab'] as const).map(
        (phase, index): SceneOutline => ({
          id: `lab-${phase}`,
          type: 'interactive',
          title: phase,
          order: index + 1,
          description: '实验',
          keyPoints: [],
          eduplus: { courseId: course.courseId, phase, teaching },
        }),
      ),
      { ...input.outlines[2], order: 3 },
    ],
  }));
  deps.content.mockImplementation(async (_owner, { outline }) => ({
    content: {
      html: '<h1>Lab</h1>',
      eduplus: { courseId: course.courseId, phase: outline.eduplus.phase },
    },
    effectiveOutline: outline,
  }));
  deps.actions.mockImplementation(async (_owner, input) => ({
    scene: embeddedLabScene(input.stageId, input.outline, input.content),
  }));
  deps.documents.mockImplementation(async (_owner, fence) => {
    const tx = {
      query: vi.fn(async (sql: string) => ({
        rows: sql.includes('SELECT rev') ? [{ rev: deps.rev }] : [{ stage_id: 'stage-existing' }],
      })),
    };
    return {
      readFreshnessManifest: deps.manifest,
      loadDocument: deps.load,
      saveDocument: async (document: unknown) => {
        await fence(tx); // before the document write
        deps.rev += 1; // the framework's own revision trigger
        await fence(tx); // after the write, same transaction
        deps.save(document);
      },
    };
  });
});
describe('existing native course upgrade', () => {
  it('passes an explicitly reviewed course through the owner-scoped recovery path', async () => {
    await repairNativeLabs('owner', 'stage-existing', undefined, {
      regenerateLabs: true, verifiedCourseId: 'reviewed-course',
    });
    expect(deps.prepare.mock.calls[0][0]).toBe('owner');
    expect(deps.prepare.mock.calls[0][4]).toEqual({ courseId: 'reviewed-course' });
  });
  it('does not save the classroom when reviewed-course ownership cannot be verified', async () => {
    deps.prepare.mockRejectedValue(new Error('已保存的实验资产不存在或无权访问'));
    await expect(repairNativeLabs('owner', 'stage-existing', undefined, {
      regenerateLabs: true, verifiedCourseId: 'other-owner-course',
    })).rejects.toThrow('无权访问');
    expect(deps.save).not.toHaveBeenCalled();
  });
  it('recovers the owned original requirement instead of trusting a model-generated classroom name', async () => {
    deps.load.mockResolvedValue({
      ...original,
      stage: { ...original.stage, name: '错误的硬币找零标题' },
      outline: { ...original.outline, producerRef: 'run-original' },
    });
    deps.run.mockResolvedValue({
      stageId: 'stage-existing',
      input: { requirement: '请讲解指定的目录外搜索算法' },
    });
    await repairNativeLabs('owner', 'stage-existing', undefined, { regenerateLabs: true });
    expect(deps.run).toHaveBeenCalledWith('run-original', 'owner');
    expect(deps.prepare.mock.calls[0][2]).toBe('请讲解指定的目录外搜索算法');
    expect(deps.save.mock.calls[0][0].outline.requirement).toBe('请讲解指定的目录外搜索算法');
  });
  it('can explicitly rebuild stale lecture content and leaves the document intact on failure', async () => {
    deps.content.mockRejectedValue(new Error('lecture generation interrupted'));
    await expect(
      repairNativeLabs('owner', 'stage-existing', undefined, {
        regenerateLabs: true,
        regenerateLectures: true,
      }),
    ).rejects.toThrow('lecture generation interrupted');
    expect(deps.content.mock.calls[0][1].outline.id).toBe('lecture');
    expect(deps.save).not.toHaveBeenCalled();
  });
  function readyDocument() {
    const labs = (['guided-lab', 'oj-lab'] as const).map((phase, index) =>
      embeddedLabScene(
        'stage-existing',
        {
          id: `ready-${phase}`,
          type: 'interactive',
          title: phase,
          order: 3 + index,
          description: '正式实验',
          keyPoints: [],
          eduplus: { courseId: course.courseId, phase, teaching },
        },
        { html: '<p>正式实验</p>', eduplus: { courseId: course.courseId, phase } },
      ),
    );
    const scenes = [...original.scenes, ...labs];
    return {
      ...original,
      scenes,
      outline: {
        ...original.outline,
        outlines: scenes.map((s) => ({
          id: ('outlineId' in s ? s.outlineId : undefined) ?? s.id,
          type: s.type,
          title: s.title,
          order: s.order,
          description: s.title,
          keyPoints: [],
        })),
      },
    };
  }
  it('removes a stale generated code page when the native pair already exists, retaining assets and records', async () => {
    const document = readyDocument();
    deps.load.mockResolvedValue(document);
    const result = await repairNativeLabs('owner', 'stage-existing');
    expect(result).toMatchObject({ changed: true, ready: true, removedLegacyScenes: 1 });
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.content).not.toHaveBeenCalled();
    expect(deps.bind).not.toHaveBeenCalled();
    const saved = deps.save.mock.calls[0][0];
    expect(saved.scenes.map((s: { id: string }) => s.id)).toEqual(
      document.scenes.filter((s) => s.id !== 'broken').map((s) => s.id),
    );
    for (const scene of saved.scenes)
      expect(scene.content).toEqual(document.scenes.find((s) => s.id === scene.id)!.content);
    expect(saved.outline.outlines.some((s: { id: string }) => s.id === 'broken')).toBe(false);
    expect(saved.stage.id).toBe('stage-existing');
  });
  it('treats an already upgraded document as ready instead of reporting that it has no experiment', async () => {
    const document = readyDocument();
    deps.load.mockResolvedValue({
      ...document,
      scenes: document.scenes.filter((s) => s.id !== 'broken'),
    });
    await expect(repairNativeLabs('owner', 'stage-existing')).resolves.toMatchObject({
      changed: false,
      ready: true,
    });
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.prepare).not.toHaveBeenCalled();
  });
  it('fences legacy cleanup against concurrent edits too', async () => {
    deps.load.mockResolvedValue(readyDocument());
    deps.rev = 11;
    await expect(repairNativeLabs('owner', 'stage-existing')).rejects.toMatchObject({
      code: 'COURSE_CHANGED',
    });
    expect(deps.save).not.toHaveBeenCalled();
  });
  it('can explicitly regenerate an existing Lab pair while keeping lectures and the stage id', async () => {
    const oldLab = embeddedLabScene(
      'stage-existing',
      {
        id: 'old-guided',
        type: 'interactive',
        title: '旧实验',
        order: 1,
        description: '旧实验',
        keyPoints: [],
        eduplus: { courseId: course.courseId, phase: 'guided-lab', teaching },
      },
      { html: '<p>old</p>', eduplus: { courseId: course.courseId, phase: 'guided-lab' } },
    );
    deps.load.mockResolvedValue({ ...original, scenes: [...original.scenes, oldLab] });
    await repairNativeLabs('owner', 'stage-existing', undefined, { regenerateLabs: true });
    const input = deps.prepare.mock.calls[0][1];
    expect(input.outlines.some((item: SceneOutline) => item.title === '旧实验')).toBe(false);
    const saved = deps.save.mock.calls[0][0];
    expect(saved.stage.id).toBe('stage-existing');
    expect(saved.scenes[0].content).toEqual(original.scenes[0].content);
    expect(saved.scenes.some((scene: { title: string }) => scene.title === '旧实验')).toBe(false);
  });
  it('rebuilds the prior lab quiz on regeneration while retaining an unrelated course quiz', async () => {
    const unrelated = { ...original.scenes[2], id: 'course-quiz', title: '课程原有测验' };
    deps.load.mockResolvedValue({
      ...original,
      scenes: [...original.scenes, unrelated],
      outline: {
        ...original.outline,
        outlines: [
          {
            id: 'old-quiz',
            type: 'quiz',
            title: '旧实验测验',
            order: 2,
            description: '旧测验',
            keyPoints: [],
            eduplus: { courseId: course.courseId, phase: 'quiz', teaching },
          },
        ],
      },
    });
    await repairNativeLabs('owner', 'stage-existing', undefined, { regenerateLabs: true });
    const input = deps.prepare.mock.calls[0][1];
    expect(input.outlines.some((item: SceneOutline) => item.id === 'old-quiz')).toBe(false);
    expect(input.outlines.some((item: SceneOutline) => item.id === 'course-quiz')).toBe(true);
    expect(
      deps.save.mock.calls[0][0].scenes.some((item: { id: string }) => item.id === 'old-quiz'),
    ).toBe(false);
  });
  it('keeps the URL, lecture and quiz while adding Labs, and does not mistake its own write for a conflict', async () => {
    const result = await repairNativeLabs('owner', 'stage-existing');
    expect(result.changed).toBe(true);
    const saved = deps.save.mock.calls[0][0];
    expect(saved.stage.id).toBe('stage-existing');
    expect(saved.scenes[0]).toEqual({ ...original.scenes[0], outlineId: original.scenes[0].id });
    expect(saved.scenes[3].content).toEqual(original.scenes[2].content);
    expect(
      saved.scenes.filter((scene: { content: { eduplus?: unknown } }) => scene.content.eduplus),
    ).toHaveLength(2);
    expect(deps.bind).toHaveBeenCalledTimes(2);
    expect(deps.bind.mock.calls[0][4].get('old-quiz')).toBe('old-quiz');
    expect(original.scenes).toHaveLength(3);
  });
  it('refuses a concurrent edit without saving a replacement document', async () => {
    deps.rev = 11;
    await expect(repairNativeLabs('owner', 'stage-existing')).rejects.toMatchObject({
      status: 409,
      code: 'COURSE_CHANGED',
    });
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.bind).not.toHaveBeenCalled();
  });
  it('refuses other owners before consuming model capacity', async () => {
    deps.manifest.mockResolvedValue(null);
    await expect(repairNativeLabs('other', 'stage-existing')).rejects.toMatchObject({
      status: 404,
    });
    expect(deps.prepare).not.toHaveBeenCalled();
  });
});
