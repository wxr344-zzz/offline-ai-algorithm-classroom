import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateSceneActions } from '@/lib/server/generation/steps/scene-actions';
import type { SceneOutline } from '@/lib/types/generation';

import { fakeModel, testLogger } from './helpers';

const mocks = vi.hoisted(() => ({
  callLLM: vi.fn(),
  generateSceneActions: vi.fn(),
}));

vi.mock('@/lib/ai/llm', () => ({ callLLM: mocks.callLLM }));
vi.mock('@openmaic/generation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openmaic/generation')>()),
  generateSceneActions: mocks.generateSceneActions,
}));

const model = fakeModel();

const outline = (id: string, order: number, title: string): SceneOutline => ({
  id,
  order,
  type: 'slide',
  title,
  description: title,
  keyPoints: [],
});

const body = {
  outline: outline('o2', 2, 'Second'),
  allOutlines: [outline('o1', 1, 'First'), outline('o2', 2, 'Second'), outline('o3', 3, 'Third')],
  content: { elements: [] },
  stageId: 'stage-1',
  previousSpeeches: ['Welcome back.'],
  userProfile: 'A curious learner',
  languageDirective: 'Teach in English.',
};

describe('scene actions step', () => {
  it('keeps the Python simulator reference when assembling a newly generated lesson', async () => {
    mocks.generateSceneActions.mockResolvedValue([]);
    const result = await generateSceneActions(
      {
        ...body,
        outline: { ...body.outline, type: 'interactive', widgetType: 'simulation' },
        content: {
          html: '<h1>预览</h1>',
          widgetType: 'simulation',
          simulation: { topic: '01背包算法', mode: 'simulation' },
        },
        model,
      },
      { log: testLogger() },
    );
    expect(result.scene.content).toHaveProperty('simulation', {
      topic: '01背包算法',
      mode: 'simulation',
    });
  });
  beforeEach(() => {
    vi.resetModules();
    mocks.generateSceneActions.mockReset();
    mocks.generateSceneActions.mockResolvedValue([
      { id: 'a1', type: 'speech', text: 'Now the second part.' },
      { id: 'a2', type: 'speech', text: 'Let us look closer.' },
    ]);
  });

  it("generates in the scene's place in the course and hands its speeches on", async () => {
    const result = await generateSceneActions({ ...body, model }, { log: testLogger() });

    const [, , , options] = mocks.generateSceneActions.mock.calls[0]!;
    expect(options).toEqual({
      ctx: {
        pageIndex: 2,
        totalPages: 3,
        allTitles: ['First', 'Second', 'Third'],
        previousSpeeches: ['Welcome back.'],
      },
      agents: undefined,
      userProfile: 'A curious learner',
      languageDirective: 'Teach in English.',
    });
    expect(result.scene).toMatchObject({ stageId: 'stage-1', type: 'slide', title: 'Second' });
    expect(result.previousSpeeches).toEqual(['Now the second part.', 'Let us look closer.']);
  });
  it('corrects native slide language jointly rather than translating the same speeches first', async () => {
    mocks.generateSceneActions.mockResolvedValue([
      { id: 's1', type: 'speech', text: 'An English line in a Chinese course.' },
    ]);
    const critic = fakeModel({ model: { modelId: 'critic-model' } as never });
    mocks.callLLM.mockReset();
    mocks.callLLM
      .mockResolvedValueOnce({ text: '{"ok":false,"issues":["wrong language"]}' })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          texts: ['能量', '能量与运动有关。'],
          speeches: ['本页讲解运动中的能量。'],
        }),
      })
      .mockResolvedValueOnce({ text: '{"ok":true,"issues":[]}' });
    const result = await generateSceneActions(
      {
        ...body,
        languageDirective: '全课程使用简体中文',
        content: {
          elements: [
            {
              id: 'h',
              type: 'text',
              left: 32,
              top: 32,
              width: 900,
              height: 60,
              content: '<p>能量</p>',
            },
            {
              id: 'b',
              type: 'text',
              left: 32,
              top: 120,
              width: 900,
              height: 160,
              content: '<p>运动中的能量。</p>',
            },
          ],
        } as never,
        model,
        reviewModel: critic,
      },
      { log: testLogger() },
    );
    expect(result.previousSpeeches).toEqual(['本页讲解运动中的能量。']);
    expect(mocks.callLLM).toHaveBeenCalledTimes(3);
    expect(mocks.callLLM.mock.calls[0][0].model).toBe(critic.model);
    expect(mocks.callLLM.mock.calls[1][0].model).toBe(model.model);
    expect(mocks.callLLM.mock.calls[2][0].model).toBe(critic.model);
    expect(mocks.callLLM.mock.calls[0][0].system).toContain('completed lesson page');
    mocks.callLLM.mockReset();
  });

  it('localizes invitation metadata without translating jointly reviewed speeches again', async () => {
    mocks.generateSceneActions.mockResolvedValue([
      { id: 's1', type: 'speech', text: 'An English line in a Chinese course.' },
      {
        id: 'd1',
        type: 'discussion',
        topic: 'Why does energy change?',
        prompt: 'Explain your reasoning.',
      },
    ]);
    mocks.callLLM.mockReset();
    mocks.callLLM
      .mockResolvedValueOnce({ text: '{"ok":false,"issues":["wrong language"]}' })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          texts: ['能量', '能量与运动有关。'],
          speeches: ['本页讲解运动中的能量。'],
        }),
      })
      .mockResolvedValueOnce({ text: '{"ok":true,"issues":[]}' })
      .mockResolvedValueOnce({ text: '{"texts":["能量为什么变化？","请解释原因。"]}' });
    const result = await generateSceneActions(
      {
        ...body,
        languageDirective: '全课程使用简体中文',
        content: {
          elements: [
            {
              id: 'h',
              type: 'text',
              left: 32,
              top: 32,
              width: 900,
              height: 60,
              content: '<p>能量</p>',
            },
            {
              id: 'b',
              type: 'text',
              left: 32,
              top: 120,
              width: 900,
              height: 160,
              content: '<p>运动中的能量。</p>',
            },
          ],
        } as never,
        model,
        reviewModel: model,
      },
      { log: testLogger() },
    );
    expect(result.previousSpeeches).toEqual(['本页讲解运动中的能量。']);
    expect(mocks.callLLM).toHaveBeenCalledTimes(4);
    expect(mocks.callLLM.mock.calls[0][0].system).toContain('completed lesson page');
    expect(mocks.callLLM.mock.calls[3][0].prompt).not.toContain('本页讲解运动中的能量');
    expect(JSON.stringify(result.scene)).toContain('能量为什么变化？');
    mocks.callLLM.mockReset();
  });

  it('drops play_video for a video the slide does not have, and Markdown asterisks in speech', async () => {
    mocks.generateSceneActions.mockResolvedValue([
      { id: 'a1', type: 'speech', text: '首先，我们将**初始化参数**。' },
      { id: 'a2', type: 'play_video', elementId: 'video_ghost' },
      { id: 'a3', type: 'play_video', elementId: 'v1' },
    ]);
    const result = await generateSceneActions(
      {
        ...body,
        languageDirective: '',
        content: {
          elements: [{ id: 'v1', type: 'video', left: 0, top: 0, width: 100, height: 56 }],
        } as never,
        model,
      },
      { log: testLogger() },
    );
    const actions =
      (result.scene as { actions?: Array<{ id: string; text?: string }> }).actions ?? [];
    expect(actions.map((a) => a.id)).toEqual(['a1', 'a3']);
    expect(actions[0]!.text).toBe('首先，我们将初始化参数。');
  });

  it('does not publish a Chinese course with a stubborn untranslated teacher line', async () => {
    mocks.generateSceneActions.mockResolvedValue([
      { id: 'a1', type: 'speech', text: "Let's see how well you remember what we just covered." },
      { id: 'a2', type: 'discussion', topic: 'Which method would you prefer? Why?' },
    ]);
    mocks.callLLM.mockImplementation(async (params: { prompt: string }) => {
      const texts = JSON.parse(params.prompt) as string[];
      if (texts.length > 1) return { text: '{"texts":[]}' };
      return {
        text: texts[0]!.startsWith('Which')
          ? '{"texts":["你更喜欢哪种方法？为什么？"]}'
          : '{"texts":["still English here"]}',
      };
    });
    await expect(
      generateSceneActions(
        { ...body, languageDirective: '全课程使用简体中文', model },
        { log: testLogger() },
      ),
    ).rejects.toThrow('untranslated prose');
    mocks.callLLM.mockReset();
  });
});
