import { beforeEach, describe, expect, it, vi } from 'vitest';
import generated from '@/tests/fixtures/eduplus-generated.json';
import teaching from '@/tests/fixtures/eduplus-teaching.json';
import {
  prepareEmbeddedLabs,
  embeddedLabScene,
  embeddedLabContent,
  embeddedAlgorithmContent,
  bindEmbeddedLabsIn,
  ensureSimulation,
  finishOutlines,
} from '@/lib/server/eduplus-native-generation';
import type { OutlineResult } from '@/lib/server/generation/steps/outline';
import { AgentAPIError } from '@/lib/server/eduplus-agent-client';
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
it('grounds native lecture content in accepted computation rules, replacing unrelated model examples', async () => {
  const input = result();
  input.languageDirective = '简体中文';
  input.outlines[0] = {
    ...input.outlines[0],
    description: '错误的硬币找零案例',
    keyPoints: ['错误的相邻算法'],
  };
  const prepared = await prepareEmbeddedLabs('owner', input, '讲解当前算法并提供编程实验');
  const lecture = prepared.outlines.find((item) => item.id === 'explain')!;
  expect(lecture.title).toBe('讲解');
  expect(lecture.description).toContain(teaching.overview);
  expect(lecture.description).not.toContain('硬币找零');
  expect(lecture.keyPoints).not.toContain('错误的相邻算法');
});
it('binds simulations to the Python-backed renderer and stores no second algorithm runtime', async () => {
  const content = await embeddedAlgorithmContent('owner', {
    id: 'sim',
    type: 'interactive',
    title: '模拟器',
    description: '',
    keyPoints: [],
    order: 0,
    widgetType: 'simulation',
    algorithmDemo: {
      courseId: generated.publicCourse.courseId,
      teaching: { ...teaching, questions: [], algorithmTrace: null },
    },
  });
  expect(content.simulation).toEqual({
    topic: generated.publicCourse.topic,
    mode: 'simulation',
    courseId: generated.publicCourse.courseId,
  });
  expect(content.html).not.toMatch(/<script|暂不提供自动推演|function compute/);
});
const result = (): OutlineResult => ({
  courseTitle: '列表课程',
  languageDirective: '中文',
  taskEngineMode: false,
  outlines: [
    { id: 'explain', type: 'slide', title: '讲解', description: '讲解', keyPoints: [], order: 0 },
    {
      id: 'code',
      type: 'code' as 'interactive',
      title: 'Python 列表求和',
      description: '列表求和',
      keyPoints: [],
      order: 1,
    },
    {
      id: 'sim',
      type: 'simulation' as 'interactive',
      title: '模拟器',
      description: '演示',
      keyPoints: [],
      order: 2,
    },
    {
      id: 'game',
      type: 'game' as 'interactive',
      title: '游戏',
      description: '游戏',
      keyPoints: [],
      order: 3,
    },
  ],
});
describe('regular homepage generation wiring', () => {
  it('preserves vocational mode without calling the algorithm/Python service', async () => {
    const input = result();
    input.taskEngineMode = true;
    input.outlines = [
      input.outlines[0],
      {
        id: 'procedure',
        type: 'interactive',
        title: '断电确认',
        description: '安全步骤',
        keyPoints: ['验电'],
        order: 1,
        widgetType: 'procedural-skill',
        widgetOutline: { concept: '动力电池检修' },
      },
    ];
    const prepared = await prepareEmbeddedLabs('owner', input, '动力电池包检修安全操作');
    expect(prepared.outlines).toEqual(input.outlines);
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });
  it('removes non-Python code exercises too when theory only is requested', async () => {
    const input = result();
    input.outlines = [
      input.outlines[0],
      {
        id: 'js',
        type: 'interactive',
        title: '代码',
        description: '演示',
        keyPoints: [],
        order: 1,
        widgetType: 'code',
        widgetOutline: { language: 'javascript', concept: '闭包' },
      },
    ];
    const prepared = await prepareEmbeddedLabs('owner', input, 'Explain closures without coding');
    // A programming concept taught as theory keeps one simulator (algorithm classroom design).
    expect(prepared.outlines.map((item) => item.id)).toEqual([
      'explain',
      'lesson-worked-example',
      'native-simulation',
      'lesson-knowledge-check',
      'lesson-summary',
    ]);
    expect(deps.generate).not.toHaveBeenCalled();
  });
  it('recovers a native concept page when theory opt-out removes every model scene', async () => {
    const input = result();
    input.outlines = [
      {
        id: 'code-only',
        type: 'interactive',
        title: 'Wrong lab',
        description: 'Wrong lab',
        keyPoints: [],
        order: 0,
        widgetType: 'code',
        widgetOutline: { language: 'python', concept: 'loops' },
      },
    ];
    const prepared = await prepareEmbeddedLabs('owner', input, 'Explain loops, theory only');
    // An ordinary topic: the recovered concept page, then one native simulator
    // (the lesson had no hands-on page at all).
    expect(prepared.outlines).toHaveLength(5);
    expect(prepared.outlines.find((item) => item.widgetType === 'simulation')).toMatchObject({
      type: 'interactive',
      widgetType: 'simulation',
    });
    expect(prepared.outlines[0]).toMatchObject({
      type: 'slide',
      order: 0,
      description: 'Explain loops, theory only',
    });
    expect(deps.generate).not.toHaveBeenCalled();
    expect(JSON.stringify(prepared.outlines)).not.toContain('Wrong lab');
  });
  it('keeps the ordinary non-programming lesson after semantic classification', async () => {
    const input = result();
    input.outlines = [
      input.outlines[0],
      {
        id: 'check',
        type: 'quiz',
        title: '分数练习',
        description: '计算分数',
        keyPoints: ['通分'],
        order: 1,
      },
    ];
    deps.generate.mockResolvedValue({
      ...generated,
      publicCourse: { ...generated.publicCourse, requiresLab: false, scenes: [] },
    });
    const prepared = await prepareEmbeddedLabs('owner', input, '给十岁儿童讲解分数加法');
    // The native lesson as planned, plus one simulator before the quiz (it planned none).
    expect(prepared.outlines.map((item) => item.id)).toEqual([
      'explain',
      'lesson-worked-example',
      'native-simulation',
      'check',
      'lesson-summary',
    ]);
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.teaching).not.toHaveBeenCalled();
  });
  it('keeps a general-knowledge lesson when the optional Lab classifier is unavailable', async () => {
    const input = result();
    input.outlines = [input.outlines[0]];
    deps.generate.mockRejectedValue(
      new AgentAPIError(503, 'AGENT_UNAVAILABLE', '无法连接 Agent 服务'),
    );
    const prepared = await prepareEmbeddedLabs('owner', input, '讲解光合作用的过程');
    expect(deps.generate).toHaveBeenCalledTimes(1);
    expect(prepared.outlines.map((item) => item.id)).toEqual([
      'explain',
      'lesson-worked-example',
      'native-simulation',
      'lesson-knowledge-check',
      'lesson-summary',
    ]);
    expect(deps.save).not.toHaveBeenCalled();
  });
  it.each(['讲解快速排序', '讲解光合作用，并安排编程练习'])(
    'still reports an unavailable Lab service for %s, which needs a Lab',
    async (prompt) => {
      const input = result();
      input.outlines = [input.outlines[0]];
      deps.generate.mockRejectedValue(
        new AgentAPIError(503, 'AGENT_UNAVAILABLE', '无法连接 Agent 服务'),
      );
      await expect(prepareEmbeddedLabs('owner', input, prompt)).rejects.toThrow('无法连接');
    },
  );
  it.each(['ALGORITHM_CONTRACT_FAILED', 'TEACHING_FAILED'])(
    'publishes a mathematics lesson without its code page when the optional Lab fails (%s)',
    async (code) => {
      // Reproduces "请为我讲解洛必达法则": the outline planned a code page and the
      // Teacher proposed a Lab, but its implementation could not be verified.
      const input = result();
      if (code === 'ALGORITHM_CONTRACT_FAILED')
        deps.generate.mockRejectedValue(
          new AgentAPIError(502, code, '算法实现尚未通过独立执行校验'),
        );
      else deps.teaching.mockRejectedValue(new AgentAPIError(502, code, '课堂补充内容生成失败'));
      const prepared = await prepareEmbeddedLabs('owner', input, '请为我讲解洛必达法则');
      expect(prepared.outlines.map((item) => item.id)).toEqual([
        'explain',
        'lesson-worked-example',
        'sim',
        'game',
        'lesson-knowledge-check',
        'lesson-summary',
      ]);
      expect(prepared.outlines.some((item) => item.eduplus || item.widgetType === 'code')).toBe(
        false,
      );
    },
  );
  it('still fails an algorithm lesson whose Lab cannot be verified', async () => {
    deps.generate.mockRejectedValue(
      new AgentAPIError(502, 'ALGORITHM_CONTRACT_FAILED', '算法实现尚未通过独立执行校验'),
    );
    await expect(prepareEmbeddedLabs('owner', result(), '讲解快速排序')).rejects.toThrow(
      '独立执行校验',
    );
  });
  it.each(['ALGORITHM_CONTRACT_FAILED', 'AGENT_TIMEOUT'])(
    'never marks an explicitly requested Lab complete after verification failed (%s)',
    async (code) => {
      // Reproduces "请为我讲解贪婪最佳优先算法" with the Lab agent: the local model's
      // implementation never passed the independent check.
      deps.generate.mockRejectedValue(new AgentAPIError(502, code, '算法实现尚未通过独立执行校验'));
      const onNotice = vi.fn();
      await expect(
        prepareEmbeddedLabs('owner', result(), '请为我讲解贪婪最佳优先算法', undefined, undefined, {
          labAgent: true,
          fallbackWithoutLab: true,
          onNotice,
        }),
      ).rejects.toMatchObject({ code });
      expect(onNotice).not.toHaveBeenCalled();
    },
  );
  it('keeps an explicitly selected Lab recoverable instead of silently deleting it', async () => {
    const onNotice = vi.fn();
    await expect(
      prepareEmbeddedLabs('owner', result(), '请为我讲解贪婪最佳优先搜索', undefined, undefined, {
        labAgent: true,
        fallbackWithoutLab: true,
        skipLabCall: true,
        onNotice,
      }),
    ).rejects.toMatchObject({ code: 'LAB_INTENT_MISMATCH' });
    expect(deps.generate).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
  });
  it('still fails on a service that is down, even on the last attempt', async () => {
    deps.generate.mockRejectedValue(
      new AgentAPIError(503, 'AGENT_UNAVAILABLE', '无法连接 Agent 服务'),
    );
    await expect(
      prepareEmbeddedLabs('owner', result(), '讲解快速排序', undefined, undefined, {
        labAgent: true,
        fallbackWithoutLab: true,
      }),
    ).rejects.toThrow('无法连接');
  });
  it('keeps one simulator: a second simulation or diagram page is dropped (reported: dead step-card page)', () => {
    const page = (id: string, widgetType?: string, type = 'interactive') =>
      ({
        id,
        type,
        title: id,
        description: '',
        keyPoints: [],
        order: 0,
        ...(widgetType ? { widgetType } : {}),
      }) as never;
    const lesson = ensureSimulation(
      [
        page('intro', undefined, 'slide'),
        page('diagram', 'diagram'),
        page('steps', undefined, 'slide'),
        page('sim', 'simulation'),
        page('game', 'game'),
      ],
      '请为我讲解梯度下降算法',
    );
    expect(lesson.map((item) => item.id)).toEqual(['intro', 'steps', 'sim', 'game']);
    // A lone diagram becomes the lesson's simulator instead of getting a second one.
    const single = ensureSimulation(
      [page('intro', undefined, 'slide'), page('diagram', 'diagram')],
      '讲解',
    );
    expect(single.map((item) => [item.id, item.widgetType ?? null])).toEqual([
      ['intro', null],
      ['diagram', 'simulation'],
    ]);
  });
  it('adds one simulator after the concept page when a lesson planned no hands-on page', async () => {
    const input = result();
    input.outlines = [
      input.outlines[0],
      { id: 'check', type: 'quiz', title: '检测', description: '检测', keyPoints: ['a'], order: 1 },
    ];
    deps.generate.mockResolvedValue({
      ...generated,
      publicCourse: { ...generated.publicCourse, requiresLab: false, scenes: [] },
    });
    input.languageDirective = '全课程使用简体中文';
    const ordinary = await prepareEmbeddedLabs('owner', input, '请为我讲解洛必达法则');
    expect(ordinary.outlines.map((item) => item.id)).toEqual([
      'explain',
      'lesson-worked-example',
      'native-simulation',
      'check',
      'lesson-summary',
    ]);
    // A lesson that already has its own hands-on page keeps exactly its pages.
    const planned = await prepareEmbeddedLabs(
      'owner',
      {
        ...input,
        outlines: [
          ...input.outlines,
          {
            id: 'own',
            type: 'interactive',
            widgetType: 'diagram',
            title: '图示',
            description: '图示',
            keyPoints: ['a'],
            order: 2,
          },
        ],
      },
      '请为我讲解洛必达法则',
    );
    expect(planned.outlines.map((item) => item.id)).toEqual([
      'explain',
      'lesson-worked-example',
      'own',
      'check',
      'lesson-summary',
    ]);
    const algorithm = await prepareEmbeddedLabs(
      'owner',
      input,
      '请为我讲解二叉树的中序遍历',
      undefined,
      undefined,
      {
        labAgent: false,
      },
    );
    const simulation = algorithm.outlines.find((item) => item.widgetType === 'simulation')!;
    expect(simulation).toMatchObject({
      type: 'interactive',
      widgetType: 'simulation',
      title: '交互模拟',
    });
    expect(simulation.description).toContain('二叉树的中序遍历');
  });
  it('keeps the outline simulator instead of adding a second one', async () => {
    const input = result();
    input.outlines = input.outlines.filter((item) => item.id !== 'code');
    deps.generate.mockResolvedValue({
      ...generated,
      publicCourse: { ...generated.publicCourse, requiresLab: false, scenes: [] },
    });
    const prepared = await prepareEmbeddedLabs('owner', input, '讲解光合作用');
    expect(prepared.outlines.filter((item) => item.widgetType === 'simulation')).toHaveLength(1);
  });
  it('resumes an owner-checked saved Lab without regenerating its accepted data', async () => {
    const onCourseReady = vi.fn();
    await prepareEmbeddedLabs('owner', result(), '算法编程实验', undefined, {
      courseId: generated.publicCourse.courseId,
      onCourseReady,
    });
    expect(deps.get).toHaveBeenCalledWith('owner', generated.publicCourse.courseId);
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.teaching).toHaveBeenCalled();
  });
  it('checkpoints accepted Lab data before teaching, even if teaching fails', async () => {
    const onCourseReady = vi.fn();
    deps.teaching.mockRejectedValueOnce(new Error('bad teaching section'));
    await expect(
      prepareEmbeddedLabs('owner', result(), '算法编程实验', undefined, { onCourseReady }),
    ).rejects.toThrow('bad teaching');
    expect(onCourseReady).toHaveBeenCalledWith(generated.publicCourse.courseId);
    expect(onCourseReady.mock.invocationCallOrder[0]).toBeLessThan(
      deps.teaching.mock.invocationCallOrder[0],
    );
  });
  it.each(['讲解斐波那契数列', '介绍归并排序', '解释 Dijkstra 最短路径', '讲解二叉树遍历'])(
    'classifies %s even when the native outline contains no Python page',
    async (prompt) => {
      const input = result();
      input.outlines = [input.outlines[0]];
      const prepared = await prepareEmbeddedLabs('owner', input, prompt);
      expect(deps.generate).toHaveBeenCalledWith(prompt, undefined, 'owner');
      expect(
        prepared.outlines.map((item) => item.widgetType ?? item.eduplus?.phase ?? item.type),
      ).toEqual([
        'slide',
        'slide',
        'simulation',
        'game',
        'guided-lab',
        'oj-lab',
        'quiz',
        'slide',
        'review',
      ]);
      expect(prepared.outlines.filter((item) => item.algorithmDemo)).toHaveLength(2);
    },
  );
  it('routes an algorithm lesson to the embedded six-stage flow even if the model emits only PBL', async () => {
    const input = result();
    input.outlines = [
      {
        id: 'mistaken-project',
        type: 'pbl',
        title: 'Text Analysis Project',
        description: 'Unrelated text dataset',
        keyPoints: [],
        order: 0,
      },
    ];
    const prepared = await prepareEmbeddedLabs('owner', input, '讲解两数之和算法，并提供编程练习');
    expect(
      prepared.outlines.map((item) => item.widgetType ?? item.eduplus?.phase ?? item.type),
    ).toEqual([
      'slide',
      'slide',
      'simulation',
      'game',
      'guided-lab',
      'oj-lab',
      'quiz',
      'slide',
      'review',
    ]);
    expect(JSON.stringify(prepared.outlines)).not.toContain('Text Analysis Project');
    expect(deps.generate).toHaveBeenCalledWith(
      expect.stringContaining('两数之和算法'),
      undefined,
      'owner',
    );
  });
  it('does not silently drop explicitly requested practice when Teacher rejects the Lab', async () => {
    deps.generate.mockResolvedValue({
      ...generated,
      publicCourse: { ...generated.publicCourse, requiresLab: false, scenes: [] },
    });
    await expect(
      prepareEmbeddedLabs('owner', result(), '讲解算法并提供编程练习'),
    ).rejects.toMatchObject({ code: 'LAB_INTENT_MISMATCH' });
    expect(deps.save).not.toHaveBeenCalled();
  });
  it('keeps explicit project learning separate without inventing a Python lab', async () => {
    const input = result();
    input.outlines = [
      {
        id: 'project',
        type: 'pbl',
        title: '词频分析',
        description: '项目任务',
        keyPoints: [],
        order: 0,
      },
    ];
    const prepared = await prepareEmbeddedLabs('owner', input, '采用项目式学习完成词频分析项目');
    expect(prepared.outlines[0].type).toBe('pbl');
    expect(deps.generate).not.toHaveBeenCalled();
  });
  it('converts a mistaken PBL to theory without calling the Lab model', async () => {
    const input = result();
    input.outlines = [
      {
        id: 'project',
        type: 'pbl',
        title: 'Text Analysis Project',
        description: '项目',
        keyPoints: [],
        order: 0,
      },
    ];
    const prepared = await prepareEmbeddedLabs(
      'owner',
      input,
      '讲解二分查找，只讲理论，不需要实验',
    );
    expect(prepared.outlines.map((item) => item.type)).toEqual([
      'slide',
      'slide',
      'interactive',
      'quiz',
      'slide',
    ]);
    expect(deps.generate).not.toHaveBeenCalled();
  });
  it('normalizes actual loose model output, calls the real Agent seam and embeds Labs after native demonstrations', async () => {
    const signal = new AbortController().signal;
    const prepared = await prepareEmbeddedLabs('owner', result(), 'Python 编程实验', signal);
    expect(deps.generate).toHaveBeenCalledTimes(1);
    expect(deps.generate).toHaveBeenCalledWith(
      expect.stringContaining('Python 列表求和'),
      signal,
      'owner',
    );
    expect(deps.save).toHaveBeenCalledWith('owner', generated);
    expect(
      prepared.outlines
        .slice(0, 6)
        .map((item) => item.widgetType ?? item.eduplus?.phase ?? item.type),
    ).toEqual(['slide', 'slide', 'simulation', 'game', 'guided-lab', 'oj-lab']);
    const content = await embeddedLabContent(
      'owner',
      prepared.outlines.find((item) => item.eduplus?.phase === 'guided-lab')!,
    );
    expect('eduplus' in content).toBe(true);
    expect('html' in content && content.html).not.toMatch(/reference_solution|hidden_test_cases/);
  });
  it('does not consume the Python model for an explicit theory-only request', async () => {
    const prepared = await prepareEmbeddedLabs('owner', result(), '只讲理论，不需要实验');
    expect(prepared.outlines.some((item) => item.eduplus)).toBe(false);
    expect(deps.generate).not.toHaveBeenCalled();
    expect(prepared.outlines.some((item) => item.widgetType === 'code')).toBe(false);
  });
  it('honors the Teacher requiresLab=false decision for a conceptual Python lesson', async () => {
    deps.generate.mockResolvedValue({
      ...generated,
      publicCourse: { ...generated.publicCourse, requiresLab: false, scenes: [] },
    });
    const prepared = await prepareEmbeddedLabs('owner', result(), '介绍 Python 的语言特点');
    expect(prepared.outlines.some((item) => item.eduplus || item.widgetType === 'code')).toBe(
      false,
    );
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.teaching).not.toHaveBeenCalled();
  });
  it('refuses forged cross-owner asset references and binding conflicts', async () => {
    const prepared = await prepareEmbeddedLabs('owner', result(), 'Python');
    deps.get.mockResolvedValue(null);
    await expect(
      embeddedLabContent(
        'other',
        prepared.outlines.find((item) => item.eduplus?.phase === 'guided-lab')!,
      ),
    ).rejects.toMatchObject({
      status: 404,
    });
    const tx = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(
      bindEmbeddedLabsIn(tx, 'other', 'stage-one', prepared.outlines),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('binds a retained native quiz to its real scene id instead of inventing a new one', async () => {
    const prepared = await prepareEmbeddedLabs('owner', result(), '讲解算法');
    const quiz = prepared.outlines.find((item) => item.eduplus?.phase === 'quiz')!;
    const tx = {
      query: vi.fn().mockResolvedValue({ rows: [{ course_id: generated.publicCourse.courseId }] }),
    };
    await bindEmbeddedLabsIn(
      tx,
      'owner',
      'stage-existing',
      prepared.outlines,
      new Map([[quiz.id, 'retained-native-quiz']]),
    );
    expect(JSON.parse(tx.query.mock.calls[0][1][2])).toMatchObject({
      quizSceneId: 'retained-native-quiz',
    });
  });
});

describe('Lab agent routing', () => {
  it('does not silently drop a semantically recognized Lab merely because its name has no programming keyword', async () => {
    deps.generate.mockRejectedValue(
      new AgentAPIError(502, 'ALGORITHM_CONTRACT_FAILED', 'verification failed'),
    );
    await expect(
      prepareEmbeddedLabs('owner', result(), 'Unlisted procedure', undefined, undefined, {
        labAgent: true,
        fallbackWithoutLab: true,
      }),
    ).rejects.toMatchObject({ code: 'ALGORITHM_CONTRACT_FAILED' });
  });
  it('ignores the retired switch and always places simulation before assessment', () => {
    const pages: OutlineResult['outlines'] = [
      {
        id: 'intro',
        type: 'slide',
        title: 'Introduction',
        description: 'Concepts',
        keyPoints: [],
        order: 0,
      },
      { id: 'quiz', type: 'quiz', title: 'Check', description: 'Test', keyPoints: [], order: 1 },
      {
        id: 'sim',
        type: 'interactive',
        widgetType: 'simulation',
        title: 'Simulation',
        description: 'Adjust',
        keyPoints: [],
        order: 2,
      },
    ];
    const disabled = finishOutlines(pages, '光合作用', '简体中文', false);
    expect(disabled.filter((o) => o.widgetType === 'simulation')).toHaveLength(1);
    const late = [
      ...pages.filter((o) => o.widgetType !== 'simulation'),
      ...pages.filter((o) => o.widgetType === 'simulation'),
    ];
    const enabled = finishOutlines(late, '光合作用', '简体中文', true);
    expect(enabled.findIndex((o) => o.widgetType === 'simulation')).toBeLessThan(
      enabled.findIndex((o) => o.type === 'quiz'),
    );
  });
  it('without the Lab agent publishes the native lesson: no Teacher call, no code page', async () => {
    const prepared = await prepareEmbeddedLabs(
      'owner',
      result(),
      '讲解快速排序',
      undefined,
      undefined,
      { labAgent: false },
    );
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.teaching).not.toHaveBeenCalled();
    expect(prepared.outlines.some((o) => o.widgetType === 'code')).toBe(false);
    expect(prepared.outlines.some((o) => o.eduplus)).toBe(false);
    // Simulator and game stay; scene content routes algorithm topics to the maintained ones.
    expect(prepared.outlines.some((o) => o.widgetType === 'simulation')).toBe(true);
    expect(prepared.outlines.map((o) => o.order)).toEqual(prepared.outlines.map((_, i) => i));
  });

  it('with the Lab agent runs the algorithm classroom with its Labs', async () => {
    const prepared = await prepareEmbeddedLabs(
      'owner',
      result(),
      '讲解当前算法并提供编程实验',
      undefined,
      undefined,
      { labAgent: true },
    );
    expect(deps.generate).toHaveBeenCalledTimes(1);
    expect(prepared.outlines.some((o) => o.eduplus?.phase === 'guided-lab')).toBe(true);
    expect(prepared.outlines.some((o) => o.eduplus?.phase === 'oj-lab')).toBe(true);
  });

  it('with the Lab agent on a non-programming topic follows the Teacher and keeps the native lesson', async () => {
    deps.generate.mockResolvedValue({
      ...generated,
      publicCourse: { ...generated.publicCourse, requiresLab: false },
    });
    const prepared = await prepareEmbeddedLabs(
      'owner',
      result(),
      '讲解光合作用',
      undefined,
      undefined,
      { labAgent: true },
    );
    expect(prepared.outlines.some((o) => o.eduplus)).toBe(false);
    expect(prepared.outlines.some((o) => o.widgetType === 'code')).toBe(false);
  });

  it('lets the Lab agent lead the help discussion of the programming phases only', () => {
    const outline = (phase: 'guided-lab' | 'oj-lab' | 'quiz') =>
      ({
        id: phase,
        type: phase === 'quiz' ? 'quiz' : 'interactive',
        title: phase,
        description: '',
        keyPoints: [],
        order: 0,
        eduplus: { courseId: generated.publicCourse.courseId, phase, teaching },
      }) as never;
    const content = { html: '<p>lab</p>', widgetType: 'code' } as never;
    const guided = embeddedLabScene('stage', outline('guided-lab'), content, 'default-7');
    const hold = guided.actions!.find((a) => a.type === 'discussion') as {
      agentId?: string;
      topic: string;
    };
    expect(hold.agentId).toBe('default-7');
    expect(hold.topic).toContain('实验导师');
    const speech = guided.actions!.find((a) => a.type === 'speech') as { text: string };
    expect(speech.text).toContain('实验导师');
    const quiz = embeddedLabScene(
      'stage',
      outline('quiz'),
      { questions: [] } as never,
      'default-7',
    );
    expect(
      (quiz.actions!.find((a) => a.type === 'discussion') as { agentId?: string }).agentId,
    ).toBeUndefined();
    // Without the Lab agent the scene is unchanged.
    const plain = embeddedLabScene('stage', outline('guided-lab'), content);
    expect(
      (plain.actions!.find((a) => a.type === 'discussion') as { agentId?: string }).agentId,
    ).toBeUndefined();
  });
});

describe('ordinary lesson with the Lab agent', () => {
  it('adds the Lab pages but keeps the native simulator, lecture focus and quiz', async () => {
    const input = result();
    const before = input.outlines.filter((o) => o.widgetType !== 'code').map((o) => ({ ...o }));
    const prepared = await prepareEmbeddedLabs(
      'owner',
      input,
      '讲解万有引力定律',
      undefined,
      undefined,
      {
        labAgent: true,
      },
    );
    expect(prepared.outlines.some((o) => o.eduplus?.phase === 'guided-lab')).toBe(true);
    expect(prepared.outlines.some((o) => o.algorithmDemo)).toBe(false);
    // One simulator, the subject's own - not the algorithm-step page.
    const sims = prepared.outlines.filter((o) => o.widgetType === 'simulation');
    expect(sims).toHaveLength(1);
    expect(sims[0]!.widgetOutline?.keyVariables ?? []).not.toContain('当前步骤');
    expect(prepared.outlines.find((o) => o.eduplus?.phase === 'guided-lab')!.title).not.toMatch(
      /Guided Lab/,
    );
    for (const page of before) {
      const kept = prepared.outlines.find((o) => o.id === page.id);
      if (!kept) continue;
      expect(kept.description).toBe(page.description);
      expect(kept.keyPoints).toEqual(page.keyPoints);
      expect(kept.eduplus).toBeUndefined();
    }
  });
});
