/**
 * The production step wiring of a run: which model slot a scene's content
 * resolves through (an unknown type reaches the content step's own refusal),
 * and the media type narration clips are stored with.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveModel: vi.fn(),
  synthesizeNarration: vi.fn(),
  storeGeneratedAsset: vi.fn(),
  generateOutlines: vi.fn(),
  prepareEmbeddedLabs: vi.fn(),
}));

vi.mock('@/lib/server/generation/steps/outline', async (original) => ({
  ...(await original<typeof import('@/lib/server/generation/steps/outline')>()),
  generateOutlines: mocks.generateOutlines,
}));
vi.mock('@/lib/server/eduplus-native-generation', async (original) => ({
  ...(await original<typeof import('@/lib/server/eduplus-native-generation')>()),
  prepareEmbeddedLabs: mocks.prepareEmbeddedLabs,
}));

vi.mock('@/lib/server/resolve-model', () => ({ resolveModel: mocks.resolveModel }));
vi.mock('@/lib/server/generation/steps/narration', () => ({
  synthesizeNarration: mocks.synthesizeNarration,
}));
vi.mock('@/lib/server/store-generated-asset', () => ({
  storeGeneratedAsset: mocks.storeGeneratedAsset,
}));

import { StepRefusal } from '@/lib/server/generation/steps/context';
import { AgentAPIError } from '@/lib/server/eduplus-agent-client';
import { defaultRunStepServices } from '@/lib/server/generation/run/services';
import type { MediaConnection } from '@/lib/server/model-config/media';
import type { SceneOutline } from '@/lib/types/generation';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

describe('run step services', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', '');
    mocks.resolveModel.mockReset().mockResolvedValue({
      model: { id: 'test-model' },
      modelInfo: {},
      modelString: 'test:model',
      serverManaged: true,
    });
  });

  const outline = (type: string): SceneOutline =>
    ({ id: 'o1', type, title: 'Scene', description: '', keyPoints: [], order: 1 }) as never;

  // Maintained algorithms only: an unlisted one (e.g. 梯度下降算法) without a
  // verified Lab course gets the native simulator, not a step-by-step simulator
  // whose implementation the model would have to write while the learner waits.
  it.each(['冒泡排序算法', 'AVL树旋转', 'B+树分裂与合并', '带权并查集'])(
    'never asks the model to author executable simulation logic for %s, even without a Lab reference',
    async (topic) => {
      const result = await defaultRunStepServices.sceneContent(
        'user:a',
        {
          outline: { ...outline('interactive'), title: topic, widgetType: 'simulation' },
          requirements: { requirement: topic },
        },
        { log },
      );
      expect(mocks.resolveModel).not.toHaveBeenCalled();
      expect(result.content).toHaveProperty('html');
      const html = (result.content as { html: string }).html;
      expect(result.content).toHaveProperty('simulation', { topic, mode: 'simulation' });
      expect(html).not.toMatch(/computeReviewedAlgorithm|<script|暂不提供自动推演/);
    },
  );

  it('clears streamed slots before publishing the Lab-integrated reordered outline', async () => {
    const first = outline('slide');
    const second = { ...first, id: 'scene_4', order: 2 };
    const source = {
      outlines: [first, second],
      languageDirective: '简体中文',
      taskEngineMode: false,
    };
    const integrated = { ...source, outlines: [second, first] };
    mocks.generateOutlines.mockResolvedValue(source);
    mocks.prepareEmbeddedLabs.mockResolvedValue(integrated);
    const emit = vi.fn();
    await defaultRunStepServices.outline(
      'user:a',
      {
        requirements: { requirement: '讲解算法' },
      } as never,
      { log, emit },
    );
    expect(emit.mock.calls.map(([event]) => event.type)).toEqual(['reset', 'outline', 'outline']);
    expect(emit.mock.calls[1][0]).toMatchObject({ index: 0, data: { id: 'scene_4' } });
  });
  it.each(['GENERATION_FAILED', 'UPSTREAM_ERROR', 'TEACHING_FAILED'])(
    'reuses a saved outline and retries recoverable %s without regenerating it',
    async (code) => {
      const base = {
        outlines: [outline('slide')],
        languageDirective: '中文',
        taskEngineMode: false,
      };
      mocks.generateOutlines.mockClear();
      mocks.prepareEmbeddedLabs
        .mockReset()
        .mockRejectedValueOnce(new AgentAPIError(502, code, 'invalid body'))
        .mockResolvedValue(base);
      const checkpointOutline = vi.fn();
      await defaultRunStepServices.outline(
        'user:a',
        {
          requirements: { requirement: '任意算法' },
          resumeOutline: base,
        } as never,
        { log, checkpointOutline },
      );
      expect(mocks.generateOutlines).not.toHaveBeenCalled();
      expect(checkpointOutline).not.toHaveBeenCalled();
      expect(mocks.prepareEmbeddedLabs).toHaveBeenCalledTimes(2);
    },
  );
  it('does not retry access failures', async () => {
    const base = { outlines: [outline('slide')], languageDirective: '中文', taskEngineMode: false };
    mocks.prepareEmbeddedLabs
      .mockReset()
      .mockRejectedValue(new AgentAPIError(403, 'FORBIDDEN', 'denied'));
    await expect(
      defaultRunStepServices.outline(
        'user:a',
        { requirements: { requirement: '课程' }, resumeOutline: base } as never,
        { log },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.prepareEmbeddedLabs).toHaveBeenCalledTimes(1);
  });
  it('does not start integration after cancellation', async () => {
    const signal = AbortSignal.abort(new Error('cancelled by user'));
    mocks.prepareEmbeddedLabs.mockClear();
    await expect(
      defaultRunStepServices.outline(
        'user:a',
        {
          requirements: { requirement: '任意算法' },
          resumeOutline: {
            outlines: [outline('slide')],
            languageDirective: '中文',
            taskEngineMode: false,
          },
        } as never,
        { log, signal },
      ),
    ).rejects.toThrow('cancelled by user');
    expect(mocks.prepareEmbeddedLabs).not.toHaveBeenCalled();
  });

  it("resolves a known type's content through its own slot", async () => {
    await expect(
      defaultRunStepServices.sceneContent('user:a', { outline: outline('slide') }, { log }),
    ).rejects.toBeDefined();
    expect(mocks.resolveModel).toHaveBeenCalledWith({
      stage: 'scene-content:slide',
      workspaceId: 'user:a',
    });
  });

  it('resolves an unknown type through course.content and reaches the content refusal', async () => {
    const result = defaultRunStepServices.sceneContent(
      'user:a',
      { outline: outline('video') },
      { log },
    );
    await expect(result).rejects.toBeInstanceOf(StepRefusal);
    await expect(result).rejects.toMatchObject({ reason: 'generation-failed' });
    expect(mocks.resolveModel).toHaveBeenCalledWith({
      stage: 'scene-content',
      workspaceId: 'user:a',
    });
  });

  it.each([
    ['mp3', 'audio/mpeg'],
    ['wav', 'audio/wav'],
    ['ogg', 'audio/ogg'],
    ['opus', 'audio/ogg'],
    ['aac', 'audio/aac'],
    ['flac', 'audio/flac'],
    ['webm', 'audio/webm'],
  ])('stores a %s clip as %s', async (format, mimeType) => {
    mocks.synthesizeNarration.mockResolvedValue({ audio: new Uint8Array([1]), format });
    mocks.storeGeneratedAsset.mockReset().mockResolvedValue({ status: 'stored', assetId: 'ast_1' });
    const id = await defaultRunStepServices.narrateClip(
      'user:a',
      {
        target: {
          connection: { providerId: 'openai-tts' } as MediaConnection,
          providerId: 'openai-tts',
        },
        stageId: 'stage-1',
        text: 'Hello',
        audioId: 'tts_s1_a',
        voice: 'alloy',
        speed: 1,
        fence: async () => undefined,
      },
      { log },
    );
    expect(id).toBe('ast_1');
    expect(mocks.storeGeneratedAsset).toHaveBeenCalledWith(expect.objectContaining({ mimeType }));
  });

  it('refuses audio in a format it cannot serve', async () => {
    mocks.synthesizeNarration.mockResolvedValue({ audio: new Uint8Array([1]), format: 'pcm' });
    await expect(
      defaultRunStepServices.narrateClip(
        'user:a',
        {
          target: { connection: { providerId: 'x' } as MediaConnection, providerId: 'x' as never },
          stageId: 'stage-1',
          text: 'Hello',
          audioId: 'tts_s1_a',
          voice: 'v',
          speed: 1,
          fence: async () => undefined,
        },
        { log },
      ),
    ).rejects.toThrow(/unknown format: pcm/);
  });
});
