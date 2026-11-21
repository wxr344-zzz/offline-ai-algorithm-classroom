import { describe, expect, it } from 'vitest';
import {
  courseIntent,
  courseIntentDirective,
  enforceCourseIntent,
} from '@/lib/eduplus/course-intent';

describe('user-selected teaching mode', () => {
  it('recognises explicit English guided and independent practice requests', () => {
    expect(
      courseIntent('Teach a sequence with guided Python coding and independent practice.'),
    ).toMatchObject({ programming: true, explicitPractice: true });
  });
  it.each([
    '讲解算法，不需要编程基础，安排编程练习',
    '无需编程经验也能学习的 Python 课程',
    'Teach programming with no coding experience required',
    'Algorithms without programming background',
  ])('does not confuse missing prerequisites with opting out of practice: %s', (request) => {
    expect(courseIntent(request)).toMatchObject({ theoryOnly: false, programming: true });
  });
  it.each([
    'Explain recursion, theory only',
    'Teach algorithms without coding',
    'Explain algorithms with no programming',
    '只講理論，無需編程',
    '讲解分数，不要编程',
    'Explain sorting with no code',
  ])('honors theory-only requests across languages: %s', (request) => {
    expect(courseIntent(request)).toMatchObject({ theoryOnly: true, programming: false });
  });
  it('does not extend a project negation across clause boundaries', () => {
    expect(courseIntent('不要讲无关的东西，采用 PBL 开发项目').project).toBe(true);
  });
  it.each(['讲解两数之和算法', 'Python 编程练习', 'Explain binary search algorithm'])(
    'defaults %s to a normal lesson',
    (request) => {
      expect(courseIntent(request)).toMatchObject({ project: false, programming: true });
      expect(courseIntentDirective(request)).toContain('禁止生成 type=pbl');
    },
  );
  it('delegates bare algorithm names to semantic classification without a name whitelist', () => {
    expect(courseIntent('介绍冒泡排序').project).toBe(false);
    expect(courseIntentDirective('讲解斐波那契数列')).toContain('widgetType=code');
    // Unknown topics are still routed by meaning, not rejected for missing keywords.
    expect(courseIntentDirective('讲解光合作用')).toContain('先判断主题是否属于算法');
    // An ordinary topic is not forced to have a simulator or a game.
    expect(courseIntentDirective('讲解光合作用', false)).not.toContain('widgetType=game');
  });
  it.each([
    '讲解快速排序',
    '介绍冒泡排序',
    '讲解哈希表',
    '讲解动态规划',
    'Explain quicksort',
    '讲解二叉树的遍历',
  ])('recognises named algorithm topic %s as a programming lesson', (request) => {
    expect(courseIntent(request)).toMatchObject({ programming: true, theoryOnly: false });
  });
  it.each([
    '纯理论讲解快速排序，不涉及编程',
    '讲解二分查找，不需要任何编程',
    '讲解栈，不要安排实验',
    '讲解排序算法，无需写代码',
    'Explain merge sort, concepts only',
  ])('honors theory-only phrasing %s', (request) => {
    expect(courseIntent(request)).toMatchObject({ theoryOnly: true, programming: false });
  });
  it.each([
    '不要只讲理论，安排编程练习',
    '不仅讲理论，还要写代码',
    '只讲概念和代码实现',
    '不需要编程基础的实验课',
  ])('does not mistake %s for a theory-only request', (request) => {
    expect(courseIntent(request).theoryOnly).toBe(false);
  });
  it('does not treat a general-knowledge topic as programming', () => {
    expect(courseIntent('讲解光合作用')).toMatchObject({ programming: false, theoryOnly: false });
    expect(courseIntent('讲解唐诗宋词').programming).toBe(false);
  });
  it.each([
    '采用 PBL 讲解算法',
    '采用项目式学习开发词频统计',
    'Build a project-based learning course',
  ])('permits explicit project request %s', (request) => {
    expect(courseIntent(request).project).toBe(true);
  });
  it.each([
    '不要 PBL，讲解两数之和算法',
    '不需要项目式学习，做编程练习',
    '不用项目制学习，只讲理论',
  ])('honors project opt-out %s', (request) => {
    expect(courseIntent(request).project).toBe(false);
  });
  it('does not mutate the original PBL or leave its configuration in the ordinary lesson', () => {
    const input = [
      {
        id: 'p',
        type: 'pbl' as const,
        title: 'Wrong topic',
        description: 'wrong',
        keyPoints: [],
        order: 0,
        pblConfig: {
          projectTopic: 'Wrong topic',
          projectDescription: 'Wrong topic',
          targetSkills: [],
        },
      },
    ];
    const output = enforceCourseIntent(input, '二分查找算法编程练习');
    expect(output[0].type).toBe('slide');
    expect(output[1]).toMatchObject({ id: 'p', type: 'interactive', widgetType: 'code' });
    expect(output[1]).not.toHaveProperty('pblConfig');
    expect(input[0].type).toBe('pbl');
    expect(JSON.stringify(output)).not.toContain('Wrong topic');
  });
});

describe('Lab agent', () => {
  it('plans no programming page when the Lab agent is not selected', async () => {
    const { courseIntentDirective } = await import('@/lib/eduplus/course-intent');
    const off = courseIntentDirective('讲解快速排序', false);
    expect(off).toContain('没有选择 Lab agent');
    expect(off).toContain('widgetType=simulation');
    expect(off).not.toContain('引导编程');
    expect(courseIntentDirective('讲解快速排序', true)).toContain('引导编程');
    expect(courseIntentDirective('讲解快速排序')).toBe(courseIntentDirective('讲解快速排序', true));
  });

  it('reads the selection from either agent mode and recognises lab topics', async () => {
    const { selectsLabAgent, isLabTopic, LAB_AGENT_ID } = await import('@/lib/eduplus/lab-agent');
    expect(selectsLabAgent({ mode: 'preset', agentIds: ['default-1', LAB_AGENT_ID] })).toBe(true);
    expect(selectsLabAgent({ mode: 'auto', presetAgentIds: [LAB_AGENT_ID] })).toBe(true);
    expect(selectsLabAgent({ mode: 'preset', agentIds: ['default-1'] })).toBe(false);
    expect(selectsLabAgent({ mode: 'auto' })).toBe(false);
    expect(isLabTopic('讲解快速排序')).toBe(true);
    expect(isLabTopic('讲解光合作用')).toBe(false);
    expect(isLabTopic('讲解洛必达法则')).toBe(false);
  });
});
