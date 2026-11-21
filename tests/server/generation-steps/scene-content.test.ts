import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StepRefusal } from '@/lib/server/generation/steps/context';
import {
  generateSceneContent,
  type SceneContentInput,
} from '@/lib/server/generation/steps/scene-content';
import type { PdfImage, SceneOutline } from '@/lib/types/generation';
import type { PPTElement, PPTTextElement } from '@openmaic/dsl';
import fixture from '@/tests/fixtures/knapsack-overlapping-slides.json';
import { nativeTextHeight } from '@/lib/edit/native-text-clearance';

import { fakeModel, testLogger } from './helpers';

const mocks = vi.hoisted(() => ({
  callLLM: vi.fn(),
  generateSceneContent: vi.fn(),
  resolveVisionImagesStub: vi.fn(),
}));

vi.mock('@/lib/ai/llm', () => ({ callLLM: mocks.callLLM }));
vi.mock('@openmaic/generation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openmaic/generation')>()),
  generateSceneContent: mocks.generateSceneContent,
}));

const visionModel = fakeModel({
  modelInfo: { outputWindow: 4096, capabilities: { vision: true } } as never,
});

const outline: SceneOutline = {
  id: 'o1',
  order: 1,
  type: 'slide',
  title: 'Leaves',
  description: 'How leaves work',
  keyPoints: ['stomata'],
  suggestedImageIds: ['img_2', 'img_1'],
};

const image = (id: string, pageNumber: number): PdfImage => ({
  id,
  src: '',
  pageNumber,
  description: `figure ${id}`,
});

const body = {
  outline,
  allOutlines: [outline],
  pdfImages: [image('img_1', 1), image('img_2', 2), image('img_3', 3)],
  imageMapping: { img_1: 'asset-1', img_2: 'asset-2', img_3: 'asset-3' },
  stageInfo: { name: 'Plants' },
  stageId: 'stage-1',
  languageDirective: 'Teach in English.',
};

const content = { elements: [], remark: 'generated' };

describe('scene content step', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.callLLM.mockReset();
    mocks.generateSceneContent.mockReset();
    mocks.generateSceneContent.mockResolvedValue(content);
    mocks.resolveVisionImagesStub.mockReset();
    mocks.resolveVisionImagesStub.mockImplementation(
      async (images: { id: string; src: string }[]) =>
        images
          .filter((img) => img.src !== 'asset-2')
          .map((img) => ({ ...img, src: `data:image/png;base64,${img.id}` })),
    );
  });

  function input(): SceneContentInput {
    return {
      outline: body.outline,
      pdfImages: body.pdfImages,
      imageMapping: body.imageMapping,
      languageDirective: body.languageDirective,
      targetLanguage: '',
      model: visionModel,
    };
  }

  it("attaches the outline's images as resolved, dropping one that does not resolve", async () => {
    const resolveVisionImages = vi.fn(mocks.resolveVisionImagesStub);
    const result = await generateSceneContent(input(), { log: testLogger(), resolveVisionImages });

    expect(result).toEqual({ content, effectiveOutline: expect.objectContaining({ id: 'o1' }) });
    const [effectiveOutline, , options] = mocks.generateSceneContent.mock.calls[0]!;
    expect(effectiveOutline).toMatchObject({ title: 'Leaves', type: 'slide' });
    expect(options.visionEnabled).toBe(true);
    // Only the assigned images, in page order, minus the one that did not resolve.
    expect(options.assignedImages.map((img: PdfImage) => img.id)).toEqual(['img_1']);
    expect(options.imageMapping).toEqual({ img_1: 'asset-1', img_3: 'asset-3' });
    expect(options.resolvedVisionImages).toEqual([
      { id: 'img_1', src: 'data:image/png;base64,img_1' },
    ]);
    expect(options.targetLanguage).toBeUndefined();
  });

  it('refuses when the generator produces nothing', async () => {
    mocks.generateSceneContent.mockResolvedValue(null);
    const failure = await generateSceneContent(input(), {
      log: testLogger(),
      resolveVisionImages: mocks.resolveVisionImagesStub,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StepRefusal);
    expect(failure).toMatchObject({
      reason: 'generation-failed',
      message: 'Failed to generate content: Leaves',
    });
  });
  it('does not append slide formatting rules to a strict JSON teaching review', async () => {
    mocks.generateSceneContent.mockResolvedValue({
      elements: [
        {
          id: 'equation',
          type: 'text',
          left: 60,
          top: 60,
          width: 800,
          height: 80,
          rotate: 0,
          content: '<p style="font-size:28px">Area = width.</p>',
        },
      ],
    });
    mocks.callLLM.mockResolvedValue({
      text: JSON.stringify({ texts: ['Area = width × height.'] }),
    });
    const result = await generateSceneContent(input(), {
      log: testLogger(),
      resolveVisionImages: mocks.resolveVisionImagesStub,
    });
    const review = mocks.callLLM.mock.calls.find(([args]) =>
      args.system.startsWith('Review teaching text'),
    );
    expect(review).toBeDefined();
    expect(review![0].system).not.toContain('一个 <p> 一条');
    expect((result.content as { elements: { content: string }[] }).elements[0]!.content).toContain(
      'width × height',
    );
  });
  it('adds the quiz and lecture rules to algorithm classrooms only; other topics keep the native prompts', async () => {
    mocks.callLLM.mockResolvedValue({ text: '{}' });
    mocks.generateSceneContent.mockImplementation(async (scene, aiCall) => {
      await aiCall('Native system', 'Native prompt');
      return scene.type === 'quiz' ? { questions: [] } : { elements: [] };
    });
    const algorithm = { requirement: '请为我讲解快速排序' } as never;
    await generateSceneContent(
      { ...input(), requirements: algorithm, outline: { ...outline, type: 'quiz' } },
      { log: testLogger(), resolveVisionImages: mocks.resolveVisionImagesStub },
    );
    const quizSystem = mocks.callLLM.mock.calls[0][0].system as string;
    expect(quizSystem).toContain('不能把某一种实现');
    expect(quizSystem).toContain('先独立推导答案');
    expect(quizSystem).toContain('不考查平台格式');
    mocks.callLLM.mockClear();
    await generateSceneContent(
      { ...input(), requirements: algorithm },
      { log: testLogger(), resolveVisionImages: mocks.resolveVisionImagesStub },
    );
    expect(mocks.callLLM.mock.calls[0][0].system).toContain('幻灯片正文是给学生阅读的教学内容');
    for (const type of ['quiz', 'slide'] as const) {
      mocks.callLLM.mockClear();
      await generateSceneContent(
        {
          ...input(),
          requirements: { requirement: '讲解牛顿定律' } as never,
          outline: { ...outline, type },
        },
        { log: testLogger(), resolveVisionImages: mocks.resolveVisionImagesStub },
      );
      const system = mocks.callLLM.mock.calls[0][0].system as string;
      expect(system.startsWith('Native system')).toBe(true);
      expect(system).not.toContain('幻灯片正文是给学生阅读的教学内容');
      expect(system).not.toContain('不能把某一种实现');
      if (type === 'quiz') expect(system).toContain('单选题恰好一个正确选项');
    }
  });
  it('repairs actual overlapping native text blocks without asking the model to rewrite content', async () => {
    const original = structuredClone(fixture[2].canvas.elements) as PPTElement[];
    mocks.generateSceneContent.mockResolvedValue({ elements: original });
    const lesson = {
      ...input(),
      outline: { ...outline, title: '01背包算法', keyPoints: ['每件物品至多选择一次'] },
    };
    const result = await generateSceneContent(lesson, {
      log: testLogger(),
      resolveVisionImages: mocks.resolveVisionImagesStub,
    });
    const fixed = (result.content as { elements: PPTElement[] }).elements
      .filter((e): e is PPTTextElement => e.type === 'text')
      .sort((a, b) => a.top - b.top);
    fixed.forEach((element, i) => {
      expect(nativeTextHeight(element)).toBeLessThanOrEqual(element.height);
      expect(element.top + element.height).toBeLessThanOrEqual(542.5);
      if (i) expect(fixed[i - 1].top + fixed[i - 1].height).toBeLessThan(element.top);
      const before = original.find((e) => e.id === element.id) as PPTTextElement;
      if (/教学主题|讲解依据|原始需求/.test(before.content)) {
        expect(element.content).toContain('每件物品至多选择一次');
        expect(element.content).not.toMatch(/教学主题|讲解依据|原始需求/);
      } else
        expect(element.content.replace(/<[^>]*>/g, '')).toBe(
          before.content.replace(/<[^>]*>/g, ''),
        );
    });
    expect(mocks.generateSceneContent).toHaveBeenCalledTimes(1);
    expect(result.effectiveOutline.title).toBe('01背包算法');
  });
});
