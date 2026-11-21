/**
 * Topic → classroom mode, end to end through prepareEmbeddedLabs, for every
 * combination discussed with the user: algorithm (maintained / unlisted),
 * non-algorithm, theory-only, explicit practice, project; Lab agent selected
 * or not; Lab service success, content failure and outage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import generated from '@/tests/fixtures/eduplus-generated.json';
import teaching from '@/tests/fixtures/eduplus-teaching.json';
import { prepareEmbeddedLabs } from '@/lib/server/eduplus-native-generation';
import type { OutlineResult } from '@/lib/server/generation/steps/outline';
import type { SceneOutline } from '@/lib/types/generation';
import { AgentAPIError } from '@/lib/server/eduplus-agent-client';
import { isExamAlgorithmTopic } from '@/lib/eduplus/exam-topic';
import { isLabTopic } from '@/lib/eduplus/lab-agent';

const deps = vi.hoisted(() => ({
  generate: vi.fn(),
  teaching: vi.fn(),
  save: vi.fn(),
  get: vi.fn(),
}));
vi.mock('@/lib/server/eduplus-agent-client', async (original) => ({
  ...(await original<typeof import('@/lib/server/eduplus-agent-client')>()),
  callAgentForStorage: deps.generate,
  callTeachingCore: deps.teaching,
}));
vi.mock('@/lib/persistence/eduplus-courses', () => ({
  getEduplusCourseStore: async () => ({ save: deps.save, get: deps.get }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  deps.generate.mockResolvedValue(generated);
  deps.teaching.mockResolvedValue(teaching);
  deps.save.mockResolvedValue(generated.publicCourse);
  deps.get.mockResolvedValue(generated.publicCourse);
});

const page = (id: string, type: string, widgetType?: string, title = id): SceneOutline =>
  ({
    id,
    type,
    title,
    description: title,
    keyPoints: [title],
    order: 0,
    ...(widgetType ? { widgetType } : {}),
  }) as SceneOutline;
// What the outline model typically writes: concept slides, a code page, two
// simulator-like pages (the reported duplicate), a game and a quiz.
const outline = (): OutlineResult => ({
  courseTitle: '课程',
  languageDirective: '全课程使用简体中文',
  taskEngineMode: false,
  outlines: [
    page('intro', 'slide', undefined, '简介'),
    page('steps', 'slide', undefined, '步骤'),
    page('diagram', 'interactive', 'diagram', '算法模拟'),
    page('code', 'interactive', 'code', 'Python 实现'),
    page('sim', 'interactive', 'simulation', '交互模拟'),
    page('game', 'interactive', 'game', '互动游戏'),
    page('quiz', 'quiz', undefined, '随堂检测'),
  ].map((item, order) => ({ ...item, order })),
});
const kinds = (outlines: SceneOutline[]) =>
  outlines.map((o) => o.eduplus?.phase ?? o.widgetType ?? o.type);
const simulators = (outlines: SceneOutline[]) =>
  outlines.filter((o) => ['simulation', 'diagram', 'visualization3d'].includes(o.widgetType ?? ''));

const MAINTAINED = '请为我讲解快速排序';
const UNLISTED = '请为我讲解梯度下降算法';
const SCIENCE = '请为我讲解光合作用';

describe('topic recognition used by routing', () => {
  it('tells maintained algorithms, unlisted algorithms and other topics apart', () => {
    expect(isExamAlgorithmTopic(MAINTAINED)).toBe(true);
    expect(isExamAlgorithmTopic('请为我讲解贪婪最佳优先搜素')).toBe(true);
    expect(isExamAlgorithmTopic(UNLISTED)).toBe(false);
    expect(isExamAlgorithmTopic(SCIENCE)).toBe(false);
    expect(isLabTopic(MAINTAINED)).toBe(true);
    expect(isLabTopic(UNLISTED)).toBe(true);
    expect(isLabTopic(SCIENCE)).toBe(false);
  });
});

describe('Lab agent not selected: the native classroom', () => {
  it('an ordinary topic keeps the native outline as planned (only code pages are left out)', async () => {
    const prepared = await prepareEmbeddedLabs('owner', outline(), SCIENCE, undefined, undefined, {
      labAgent: false,
    });
    expect(deps.generate).not.toHaveBeenCalled();
    expect(kinds(prepared.outlines)).toEqual([
      'slide',
      'slide',
      'simulation',
      'game',
      'quiz',
      'slide',
    ]);
    expect(prepared.outlines.map((o) => o.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('an ordinary topic without any hands-on page gets one simulator (never a game it did not plan)', async () => {
    const plain: OutlineResult = {
      ...outline(),
      outlines: [page('intro', 'slide', undefined, '牛顿第一定律'), page('quiz', 'quiz')].map(
        (item, order) => ({ ...item, order }),
      ),
    };
    const prepared = await prepareEmbeddedLabs(
      'owner',
      plain,
      '讲解牛顿定律',
      undefined,
      undefined,
      {
        labAgent: false,
      },
    );
    expect(kinds(prepared.outlines)).toEqual(['slide', 'slide', 'simulation', 'quiz', 'slide']);
  });
  it('an algorithm classroom is put in teaching order, with a concept page first', async () => {
    const shuffled: OutlineResult = {
      ...outline(),
      outlines: [
        page('game', 'interactive', 'game', '互动游戏'),
        page('sim', 'interactive', 'simulation', '交互模拟'),
        page('quiz', 'quiz', undefined, '随堂检测'),
        page('sum', 'slide', undefined, '总结'),
      ].map((item, order) => ({ ...item, order })),
    };
    const prepared = await prepareEmbeddedLabs(
      'owner',
      shuffled,
      '请为我讲解二叉树的中序遍历',
      undefined,
      undefined,
      { labAgent: false },
    );
    expect(kinds(prepared.outlines)).toEqual([
      'slide',
      'slide',
      'simulation',
      'game',
      'quiz',
      'slide',
    ]);
    expect(prepared.outlines[0]!.title).toBe('概念与核心步骤');
    expect(prepared.outlines.at(-1)!.id).toBe('sum');
  });
  it.each([MAINTAINED, UNLISTED])('%s: no Lab call, no code page, one simulator', async (topic) => {
    const prepared = await prepareEmbeddedLabs('owner', outline(), topic, undefined, undefined, {
      labAgent: false,
    });
    expect(deps.generate).not.toHaveBeenCalled();
    expect(kinds(prepared.outlines)).not.toContain('code');
    expect(prepared.outlines.some((o) => o.eduplus)).toBe(false);
    expect(simulators(prepared.outlines).map((o) => o.widgetType)).toEqual(['simulation']);
    expect(kinds(prepared.outlines)).toContain('game');
    expect(kinds(prepared.outlines)).toContain('quiz');
    expect(prepared.outlines.map((o) => o.order)).toEqual(prepared.outlines.map((_, i) => i));
  });
});

describe('Lab agent selected', () => {
  it.each([MAINTAINED, UNLISTED])(
    '%s with a verified Lab: guided and independent programming, simulator/game bound to the course',
    async (topic) => {
      const prepared = await prepareEmbeddedLabs('owner', outline(), topic, undefined, undefined, {
        labAgent: true,
      });
      expect(deps.generate).toHaveBeenCalledTimes(1);
      const phases = prepared.outlines.map((o) => o.eduplus?.phase).filter(Boolean);
      expect(phases).toEqual(expect.arrayContaining(['guided-lab', 'oj-lab']));
      expect(kinds(prepared.outlines)).not.toContain('code');
      const demos = prepared.outlines.filter((o) => o.algorithmDemo);
      expect(demos.map((o) => o.widgetType).sort()).toEqual(['game', 'simulation']);
      expect(simulators(prepared.outlines)).toHaveLength(1);
    },
  );

  it('an explicitly selected unverified Lab remains recoverable, never a completed classroom with missing phases', async () => {
    deps.generate.mockRejectedValue(
      new AgentAPIError(502, 'ALGORITHM_CONTRACT_FAILED', '算法实现尚未通过独立执行校验'),
    );
    await expect(
      prepareEmbeddedLabs('owner', outline(), UNLISTED, undefined, undefined, { labAgent: true }),
    ).rejects.toThrow('独立执行校验');
    const onNotice = vi.fn();
    deps.generate.mockClear();
    await expect(
      prepareEmbeddedLabs('owner', outline(), UNLISTED, undefined, undefined, {
        labAgent: true,
        fallbackWithoutLab: true,
        skipLabCall: true,
        onNotice,
      }),
    ).rejects.toMatchObject({ code: 'LAB_INTENT_MISMATCH' });
    expect(deps.generate).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
  });

  it('a Lab service that is down still reports the outage (actionable), even on the last attempt', async () => {
    deps.generate.mockRejectedValue(
      new AgentAPIError(503, 'AGENT_UNAVAILABLE', '无法连接 Agent 服务'),
    );
    await expect(
      prepareEmbeddedLabs('owner', outline(), MAINTAINED, undefined, undefined, {
        labAgent: true,
        fallbackWithoutLab: true,
      }),
    ).rejects.toThrow('无法连接');
  });

  it('non-algorithm topic: the Teacher decides; without a Lab it is the native classroom', async () => {
    deps.generate.mockResolvedValue({
      ...generated,
      publicCourse: { ...generated.publicCourse, requiresLab: false, scenes: [] },
    });
    const prepared = await prepareEmbeddedLabs('owner', outline(), SCIENCE, undefined, undefined, {
      labAgent: true,
    });
    expect(prepared.outlines.some((o) => o.eduplus || o.algorithmDemo)).toBe(false);
    // The native outline as planned (its two simulator-like pages included).
    expect(simulators(prepared.outlines)).toHaveLength(1);
  });

  it('non-algorithm topic whose optional Lab fails: native classroom, never an error', async () => {
    deps.generate.mockRejectedValue(new AgentAPIError(502, 'GENERATION_FAILED', '失败'));
    const prepared = await prepareEmbeddedLabs('owner', outline(), SCIENCE, undefined, undefined, {
      labAgent: true,
    });
    expect(prepared.outlines.some((o) => o.eduplus || o.widgetType === 'code')).toBe(false);
  });
});

describe('explicit requests win over the Lab agent choice', () => {
  it.each([true, false])('theory only (Lab agent %s): no programming pages', async (labAgent) => {
    const prepared = await prepareEmbeddedLabs(
      'owner',
      outline(),
      '纯理论讲解快速排序，不涉及编程',
      undefined,
      undefined,
      { labAgent },
    );
    expect(deps.generate).not.toHaveBeenCalled();
    expect(kinds(prepared.outlines)).not.toContain('code');
    expect(simulators(prepared.outlines)).toHaveLength(1);
  });
  it('project-based learning keeps its project outline', async () => {
    const input = outline();
    const prepared = await prepareEmbeddedLabs(
      'owner',
      input,
      '采用项目式学习开发词频统计',
      undefined,
      undefined,
      {
        labAgent: true,
      },
    );
    expect(deps.generate).not.toHaveBeenCalled();
    expect(prepared.outlines.length).toBeGreaterThan(0);
  });
});

describe('深度交互 mode', () => {
  it('ignores the retired switch and keeps one working simulator', async () => {
    const prepared = await prepareEmbeddedLabs('owner', outline(), SCIENCE, undefined, undefined, {
      labAgent: false,
      interactiveMode: true,
    });
    expect(simulators(prepared.outlines).map((o) => o.widgetType)).toEqual(['simulation']);
  });
});
