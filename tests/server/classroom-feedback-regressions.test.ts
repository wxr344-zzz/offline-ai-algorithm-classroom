import { describe, expect, it, vi } from 'vitest';
import { finishOutlines } from '@/lib/server/eduplus-native-generation';
import { slideTextIntegrity } from '@/lib/server/generation/slide-text-integrity';
import { preservesTeachingText } from '@/lib/server/generation/teaching-text-review';
import { smokeTestWidget } from '@/lib/server/generation/widget-smoke-test';
import { persistentCourseDisplay } from '@/lib/server/persistent-course-display';
import { localizeTraceDisplay } from '@/lib/server/trace-display';
import type { SceneOutline } from '@/lib/types/generation';
import type { PPTElement } from '@openmaic/dsl';
import type { EduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import type { SimulationTrace } from '@/lib/eduplus/simulation-contract';

const page = (
  id: string,
  type: SceneOutline['type'],
  title: string,
  widgetType?: 'simulation' | 'game',
): SceneOutline => ({
  id,
  type,
  title,
  widgetType,
  description: title,
  keyPoints: ['细胞呼吸的机制'],
  order: 0,
});

describe('reported classroom regressions, at shared boundaries', () => {
  it.each([undefined, false, true])(
    'ignores retired mode %s, preserves teaching and closing phases, deduplicates simulations',
    (mode) => {
      const result = finishOutlines(
        [
          page('intro', 'slide', '呼吸作用介绍'),
          page('quiz', 'quiz', '知识检测'),
          page('application', 'slide', '呼吸作用的应用'),
          page('insert', 'interactive', '插入模拟', 'simulation'),
          page('delete', 'interactive', '删除模拟', 'simulation'),
        ],
        '请讲解呼吸作用',
        '简体中文',
        mode,
      );
      expect(result.filter((item) => item.widgetType === 'simulation')).toHaveLength(1);
      const quiz = result.findIndex((item) => item.type === 'quiz');
      expect(result.findIndex((item) => item.id === 'application')).toBeLessThan(quiz);
      expect(result.findIndex((item) => item.widgetType === 'simulation')).toBeLessThan(quiz);
      expect(result.at(-1)?.title).toBe('课程总结');
    },
  );
  it('does not turn an introduction-only plan into an immediate test', () => {
    const result = finishOutlines(
      [page('intro', 'slide', 'Introduction')],
      'Cellular respiration',
      'locale en-US',
    );
    expect(
      result.filter((item) => item.type === 'slide' && !/summary/i.test(item.title)),
    ).toHaveLength(2);
    expect(result.some((item) => item.type === 'quiz')).toBe(true);
    expect(result.at(-1)?.title).toBe('Lesson summary');
  });
  it('distinguishes corrupt stored prose from geometry and rejects destructive editorial replacement', () => {
    const corrupt = [
      { type: 'text', content: '<p>调节的 到化作用</p><p>公式水成 公式水成 w调节 的 成到化</p>' },
    ] as PPTElement[];
    expect(slideTextIntegrity(corrupt, page('intro', 'slide', '呼吸作用入门'))).toMatch(
      /subject vocabulary/,
    );
    expect(preservesTeachingText('呼吸作用的意义与主要阶段', '调节的 到化作用')).toBe(false);
    expect(preservesTeachingText('分光反应产生 ATP。', '光反应产生 ATP。')).toBe(true);
  });
  it('never reports success when an unmodelled error aborted the script before a later missing-node write', async () => {
    const result = await smokeTestWidget(
      '<html><head><script>throw new Error("Missing interaction scope"); document.getElementById("start").onclick=()=>{};</script></head><body><button id="start">Start</button></body></html>',
      'game',
    );
    expect(result.inconclusive || result.errors.length > 0).toBe(true);
  });
  it('reads saved translations after restart without calling any model and keeps grading data outside the translation store', async () => {
    const translate = vi.fn();
    const store = {
      getDisplayTexts: vi.fn().mockResolvedValue(new Map([['输入数据', 'Input data']])),
      saveDisplayTexts: vi.fn(),
    } as unknown as EduplusCourseStore;
    const result = await persistentCourseDisplay(
      store,
      'owner-a',
      'course-a',
      'en-US',
      ['输入数据'],
      translate,
    );
    expect(result.get('输入数据')).toBe('Input data');
    expect(translate).not.toHaveBeenCalled();
    expect(store.getDisplayTexts).toHaveBeenCalledWith('owner-a', 'course-a', 'en-US');
  });
  it('translates trace presentation without changing any value, pointer, identifier or proof', async () => {
    const trace = {
      version: 1,
      algorithm: 'stack',
      title: 'Stack',
      engine: 'python-deterministic',
      verified: true,
      input: { operations: ['push 3'] },
      outcome: { data: [3] },
      frames: [
        {
          index: 0,
          label: 'Push',
          explanation: 'Push value',
          state: { data: [3] },
          views: [
            {
              kind: 'sequence',
              name: 'Stack contents',
              values: [3, '数据'],
              pointers: { top: 0 },
              active: [0],
            },
          ],
        },
      ],
    } as SimulationTrace;
    const translated = await localizeTraceDisplay(
      trace,
      'fr-FR',
      'owner',
      async (_system, prompt) =>
        JSON.stringify({ texts: (JSON.parse(prompt) as string[]).map((text) => `État ${text}`) }),
    );
    expect(translated.frames[0].label).toBe('État Push');
    expect(translated.input).toEqual(trace.input);
    expect(translated.outcome).toEqual(trace.outcome);
    expect(translated.frames[0].state).toEqual(trace.frames[0].state);
    expect(translated.frames[0].views[0]).toMatchObject({
      values: [3, '数据'],
      pointers: { top: 0 },
      active: [0],
    });
  });
  it('does not bypass English localization for dynamic snapshot tables', async () => {
    const trace = {
      version: 1,
      algorithm: 'dynamic-test',
      engine: 'python-sandbox',
      title: 'Test',
      verified: true,
      input: { n: 5 },
      outcome: 5,
      frames: [
        {
          index: 0,
          label: 'Step',
          explanation: 'Run',
          state: { n: 5 },
          views: [
            {
              kind: 'table',
              name: '局部变量.data',
              columns: ['变量', '实际值'],
              rows: [['n', 5]],
              active: [],
            },
            {
              kind: 'table',
              name: 'Call stack',
              columns: ['函数', '源码行'],
              rows: [['solve', 2]],
              active: [0],
            },
          ],
        },
      ],
    } as SimulationTrace;
    const dictionary: Record<string, string> = {
      '局部变量.data': 'Local variables.data',
      变量: 'Variable',
      实际值: 'Actual value',
      函数: 'Function',
      源码行: 'Source line',
    };
    const translated = await localizeTraceDisplay(
      trace,
      'en-US',
      'english-table-owner',
      async (_system, prompt) =>
        JSON.stringify({
          texts: (JSON.parse(prompt) as string[]).map((text) => dictionary[text] ?? text),
        }),
    );
    expect(translated.frames[0].views[0]).toMatchObject({
      name: 'Local variables.data',
      columns: ['Variable', 'Actual value'],
      rows: [['n', 5]],
    });
    expect(translated.frames[0].views[1]).toMatchObject({
      columns: ['Function', 'Source line'],
      rows: [['solve', 2]],
    });
    expect(translated.frames[0].state).toEqual(trace.frames[0].state);
    expect(translated.outcome).toEqual(trace.outcome);
  });
});
