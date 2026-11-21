import { describe, expect, it } from 'vitest';
import fixture from '@/contracts/examples/public-lab.json';
import teachingFixture from '@/tests/fixtures/eduplus-teaching.json';
import {
  embedLabOutlines,
  isPythonLab,
  orderNativeLabOutlines,
} from '@/lib/eduplus/native-outline';
import { parseTeaching } from '@/lib/eduplus/classroom-contract';
import { normalizeSceneOutlines } from '@/lib/server/generation/outline-schema';
import { validateAppScene } from '@/lib/document-store/validators';
import { embeddedLabScene } from '@/lib/server/eduplus-native-generation';
import { nativeQuizQuestions } from '@/lib/eduplus/classroom-adapter';
import type { PublicCourse } from '@/lib/types/eduplus.generated';
import type { SceneOutline } from '@/lib/types/generation';

const course = fixture as PublicCourse;
const teaching = parseTeaching(teachingFixture);
it('uses English platform titles even when the canonical course topic is Chinese', () => {
  const result = embedLabOutlines(
    [],
    { ...course, topic: '课程主题', requiresLab: true },
    teaching,
    { english: true },
  );
  expect(result.length).toBeGreaterThan(4);
  expect(result.every((item) => !/[\u3400-\u9fff]/.test(item.title))).toBe(true);
});
it.each(['python', 'Python', 'PYTHON', 'python3', 'Python 3', 'Python 3.12', 'py', ' python '])(
  'replaces %s code outlines with the native lab pair during generation',
  (language) => {
    const outline: SceneOutline = {
      id: 'legacy-code',
      type: 'interactive',
      title: '代码练习',
      description: '练习',
      keyPoints: [],
      order: 0,
      widgetType: 'code',
      widgetOutline: {
        language: language as NonNullable<SceneOutline['widgetOutline']>['language'],
      },
    };
    expect(isPythonLab(outline)).toBe(true);
    const result = embedLabOutlines([outline], course, teaching);
    expect(result.some((item) => item.id === 'legacy-code')).toBe(false);
    expect(result.filter((item) => item.eduplus?.phase === 'guided-lab')).toHaveLength(1);
    expect(result.filter((item) => item.eduplus?.phase === 'oj-lab')).toHaveLength(1);
  },
);
it('retains explicitly non-Python code exercises', () => {
  expect(
    isPythonLab({
      id: 'js',
      type: 'interactive',
      title: 'JavaScript',
      description: '练习',
      keyPoints: [],
      order: 0,
      widgetType: 'code',
      widgetOutline: { language: 'javascript' },
    }),
  ).toBe(false);
});
const originals: SceneOutline[] = [
  {
    id: 'lecture',
    type: 'slide',
    title: '原生讲解',
    description: '概念',
    keyPoints: ['列表'],
    order: 0,
  },
  {
    id: 'sim',
    type: 'interactive',
    title: '原生模拟器',
    description: '逐步可视化',
    keyPoints: [],
    order: 1,
    widgetType: 'simulation',
    widgetOutline: { concept: '原生模拟器' },
  },
  {
    id: 'game',
    type: 'interactive',
    title: '原生游戏',
    description: '挑战',
    keyPoints: [],
    order: 2,
    widgetType: 'game',
    widgetOutline: { concept: '原生游戏' },
  },
  {
    id: 'code',
    type: 'interactive',
    title: 'Python 编程',
    description: '求和',
    keyPoints: [],
    order: 3,
    widgetType: 'code',
    widgetOutline: { language: 'python' },
  },
  { id: 'quiz', type: 'quiz', title: '原生检测', description: '检测', keyPoints: [], order: 4 },
];
describe('Lab embedded in the ordinary native course', () => {
  it('removes free-form extra demos and duplicate widgets from algorithm lab courses', () => {
    const extra = { ...originals[1], id: 'raw', widgetType: undefined, title: '互动演示' };
    const duplicate = { ...originals[1], id: 'sim-two' };
    const result = embedLabOutlines([...originals, extra, duplicate], course, teaching);
    expect(result.some((item) => item.id === 'raw' || item.id === 'sim-two')).toBe(false);
    expect(result.filter((item) => item.widgetType === 'simulation')).toHaveLength(1);
    expect(result.filter((item) => item.widgetType === 'game')).toHaveLength(1);
    expect(embedLabOutlines([extra], { ...course, requiresLab: false }, teaching)).toEqual([extra]);
  });
  it('removes a redundant static exercise only when a real autonomous lab is present', () => {
    const slide: SceneOutline = {
      id: 'redundant',
      type: 'slide',
      title: '综合练习',
      description: '重复的独立任务说明',
      keyPoints: [],
      order: 0,
    };
    expect(orderNativeLabOutlines([slide])).toHaveLength(1);
    const embedded = embedLabOutlines([...originals, slide], course, teaching);
    expect(embedded.some((item) => item.id === 'redundant')).toBe(false);
    expect(embedded.filter((item) => item.eduplus?.phase === 'oj-lab')).toHaveLength(1);
    const concrete = { ...slide, id: 'concrete', title: '二叉树实例分析' };
    expect(
      orderNativeLabOutlines([...embedded, concrete]).some((item) => item.id === 'concrete'),
    ).toBe(true);
  });
  it('retains a declared simulator when its widget outline is omitted', () => {
    const result = normalizeSceneOutlines([
      { id: 'sim', type: 'interactive', widgetType: 'simulation', title: '模拟器', order: 0 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.value[0].widgetOutline?.concept).toBe('模拟器');
  });
  it('normalizes widget names emitted as scene types so simulators, games and Python reach their generators', () => {
    const result = normalizeSceneOutlines(
      ['simulation', 'game', 'code', 'summary'].map((type, order) => ({
        id: `page-${order}`,
        type,
        order,
        title: type,
      })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.value.map((item) => item.type)).toEqual([
      'interactive',
      'interactive',
      'interactive',
      'slide',
    ]);
    expect(result.value.slice(0, 3).map((item) => item.widgetType)).toEqual([
      'simulation',
      'game',
      'code',
    ]);
    expect(isPythonLab(result.value[2])).toBe(true);
  });
  it('keeps native lecture, simulator, game and quiz identities and replaces Python with one shared pair', () => {
    const result = embedLabOutlines(originals, course, teaching);
    expect(result.filter((item) => !item.eduplus).map((item) => item.id)).toEqual([
      'lecture',
      'sim',
      'game',
      'quiz',
    ]);
    expect(result.filter((item) => item.eduplus).map((item) => item.eduplus?.phase)).toEqual([
      'guided-lab',
      'oj-lab',
      'quiz',
      'review',
    ]);
    expect(
      new Set(result.filter((item) => item.eduplus).map((item) => item.eduplus!.courseId)).size,
    ).toBe(1);
    expect(result.map((item) => item.order)).toEqual(result.map((_, index) => index));
    expect(originals[3].id).toBe('code');
    expect(embedLabOutlines(result, course, teaching)).toEqual(result);
  });
  it('uses upstream simulation and game types when the model omitted them, rather than a stand-alone demo', () => {
    const result = embedLabOutlines([originals[0], originals[3]], course, teaching);
    expect(
      result.slice(0, 5).map((item) => item.widgetType ?? item.eduplus?.phase ?? item.type),
    ).toEqual(['slide', 'simulation', 'game', 'guided-lab', 'oj-lab']);
  });
  it('orders native simulator and game before the Labs even when the model put code first', () => {
    const result = embedLabOutlines(
      [originals[0], originals[3], originals[1], originals[2], originals[4]],
      course,
      teaching,
    );
    expect(
      result.slice(0, 5).map((item) => item.widgetType ?? item.eduplus?.phase ?? item.type),
    ).toEqual(['slide', 'simulation', 'game', 'guided-lab', 'oj-lab']);
  });
  it('preserves non-Python code pages and does not create labs for theory', () => {
    expect(isPythonLab({ ...originals[3], widgetOutline: { language: 'javascript' } })).toBe(false);
    expect(
      embedLabOutlines(originals, { ...course, requiresLab: false, scenes: [] }, teaching),
    ).toEqual(originals);
    const extra = { ...originals[3], id: 'python-two', order: 5 };
    expect(
      embedLabOutlines([...originals, extra], course, teaching).some(
        (item) => item.id === 'python-two',
      ),
    ).toBe(false);
  });
  it('survives native outline confirmation and assembles fixed Lab plus the actual native quiz', () => {
    const result = embedLabOutlines(originals, course, teaching);
    const normalized = normalizeSceneOutlines(result);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) throw new Error(normalized.message);
    expect(normalized.value).toEqual(result);
    for (const outline of result.filter((item) => item.eduplus)) {
      const ref = outline.eduplus!;
      const content =
        ref.phase === 'quiz'
          ? { questions: nativeQuizQuestions(course.courseId, teaching) }
          : { html: '<h1>固定 Lab</h1>', eduplus: { courseId: ref.courseId, phase: ref.phase } };
      const scene = embeddedLabScene('stage-original', outline, content);
      expect(validateAppScene(scene).valid).toBe(true);
      expect(scene.stageId).toBe('stage-original');
      if (scene.type === 'interactive')
        expect(scene.content.eduplus?.courseId).toBe(course.courseId);
    }
  });
});
