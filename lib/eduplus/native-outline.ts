import type { SceneOutline } from '@/lib/types/generation';
import type { PublicCourse } from '@/lib/types/eduplus.generated';
import type { ClassroomTeaching } from '@/lib/types/eduplus-teaching.generated';

export function isPythonLab(outline: SceneOutline): boolean {
  return (
    outline.type === 'interactive' &&
    outline.widgetType === 'code' &&
    (!outline.widgetOutline?.language ||
      /^(?:python(?:\s*3(?:\.\d+)?)?|py)$/i.test(String(outline.widgetOutline.language).trim()))
  );
}

/** Add Lab phases without replacing slides, simulators, games, PBL or existing quizzes. */
export function embedLabOutlines(
  originals: readonly SceneOutline[],
  course: PublicCourse,
  teaching: ClassroomTeaching,
  options: {
    /**
     * An ordinary (non-algorithm) lesson: only the Lab phases are added. Its
     * simulator stays the native subject simulator (added later when the
     * lesson planned none), never an algorithm-step page with "input / current
     * step / state" variables (reported: a stiff gravity simulator with the Lab).
     */
    ordinary?: boolean;
    /** Course language for the added page titles. */
    english?: boolean;
  } = {},
): SceneOutline[] {
  if (!course.requiresLab) return originals.map((item) => ({ ...item }));
  if (originals.some((item) => item.eduplus?.courseId === course.courseId))
    return originals.map((item) => ({ ...item }));
  // Algorithm labs own one simulator and one game. Untyped/free-form demos
  // otherwise bypass the maintained renderer and introduce a third, unrelated page.
  const widgets = new Set<string>();
  originals = originals.filter((item) => {
    if (options.ordinary || item.type !== 'interactive' || isPythonLab(item)) return true;
    if (item.widgetType === 'simulation' || item.widgetType === 'game') {
      if (widgets.has(item.widgetType)) return false;
      widgets.add(item.widgetType);
      return true;
    }
    return item.widgetType === 'code';
  });
  const result: SceneOutline[] = [];
  let inserted = false;
  const make = (
    phase: NonNullable<SceneOutline['eduplus']>['phase'],
    title: string,
  ): SceneOutline => ({
    id: `eduplus-${course.courseId}-${phase}`,
    type: phase === 'quiz' ? 'quiz' : 'interactive',
    title,
    description: `${course.topic}：${title}`,
    keyPoints: course.lessonPlan.knowledgePoints,
    order: 0,
    eduplus: { courseId: course.courseId, phase, teaching },
  });
  const insert = () => {
    // Use the original simulation/game generators, never substitute an input bar chart for them.
    if (!options.ordinary && !originals.some((item) => item.widgetType === 'simulation'))
      result.push({
        id: `eduplus-${course.courseId}-simulation`,
        type: 'interactive',
        title: options.english ? 'Interactive simulator' : `${course.topic}：交互模拟器`,
        description:
          '通过参数调整、逐步操作和状态变化演示当前算法或编程概念。使用原生 Canvas/JavaScript，不执行学生 Python。',
        keyPoints: course.lessonPlan.knowledgePoints,
        widgetType: 'simulation',
        widgetOutline: { concept: course.topic, keyVariables: ['输入', '当前步骤', '状态'] },
        order: 0,
      });
    if (!options.ordinary && !originals.some((item) => item.widgetType === 'game'))
      result.push({
        id: `eduplus-${course.courseId}-game`,
        type: 'interactive',
        title: options.english ? 'Interactive game' : `${course.topic}：互动游戏`,
        description: '用排序、拖拽、匹配或操作步骤构建与当前知识点相关的可玩挑战；不是纯选择题。',
        keyPoints: course.lessonPlan.knowledgePoints,
        widgetType: 'game',
        widgetOutline: {
          concept: course.topic,
          gameType: 'puzzle',
          challenge: `通过操作理解${course.topic}`,
          playerControls: ['点击', '拖拽'],
        },
        order: 0,
      });
    result.push(
      make('guided-lab', options.english ? 'Guided coding' : `${course.topic}：引导编程`),
      make('oj-lab', options.english ? 'Coding challenge' : `${course.topic}：自主编程闯关`),
    );
    inserted = true;
  };
  for (const item of originals) {
    if (isPythonLab(item)) {
      if (!inserted) {
        insert();
      }
      continue; // 同一课程只生成一对完整实验，禁止余下 code 页回到自由 HTML 运行器。
    }
    result.push({ ...item });
  }
  if (!inserted) {
    const quizIndex = result.findIndex((item) => item.type === 'quiz');
    const tail = quizIndex >= 0 ? result.splice(quizIndex) : [];
    insert();
    result.push(...tail);
  }
  result.push(
    make('quiz', options.english ? 'Lab quiz' : `${course.topic}：实验随堂检测`),
    make('review', options.english ? 'Review and export' : '学习复盘与导出'),
  );
  return orderNativeLabOutlines(result);
}

/** A demonstration belongs before its Lab, even if the model put its code outline first. */
export function orderNativeLabOutlines(outlines: readonly SceneOutline[]): SceneOutline[] {
  // 已有可运行的自主编程页时，不再保留模型额外生成的同名静态练习说明页。
  // 具体题目的讲解页（如“二叉树实例分析”）不会被这个规则移除。
  if (outlines.some((item) => item.eduplus?.phase === 'oj-lab'))
    outlines = outlines.filter(
      (item) =>
        !(
          item.type === 'slide' &&
          /^(综合练习|自主编程|自主练习|独立练习|编程练习)$/.test(item.title.trim())
        ),
    );
  if (outlines.filter((item) => item.eduplus?.phase === 'guided-lab').length === 1) {
    const labs = outlines.filter(
      (item) => item.eduplus?.phase === 'guided-lab' || item.eduplus?.phase === 'oj-lab',
    );
    const review = outlines.filter((item) => item.eduplus?.phase === 'review');
    const quizzes = outlines.filter((item) => item.type === 'quiz');
    const demos = outlines.filter((item) => item.type === 'interactive' && !item.eduplus);
    const lectures = outlines.filter((item) => item.type !== 'quiz' && item.type !== 'interactive');
    const summaries = lectures.filter((item) => /总结|复盘/.test(item.title));
    const concepts = lectures.filter((item) => !summaries.includes(item));
    return [
      ...concepts,
      ...demos,
      ...labs.filter((item) => item.eduplus?.phase === 'guided-lab'),
      ...labs.filter((item) => item.eduplus?.phase === 'oj-lab'),
      ...summaries,
      ...quizzes,
      ...review,
    ].map((item, order) => ({ ...item, order }));
  }
  const result: SceneOutline[] = [];
  const lifted = new Set<string>();
  for (const [index, item] of outlines.entries()) {
    if (lifted.has(item.id)) continue;
    if (item.eduplus?.phase === 'guided-lab') {
      for (const later of outlines.slice(index + 1)) {
        if (later.type === 'slide' || later.eduplus?.phase === 'guided-lab') break;
        if (later.widgetType === 'simulation' || later.widgetType === 'game') {
          result.push({ ...later });
          lifted.add(later.id);
        }
      }
    }
    result.push({ ...item });
  }
  return result.map((item, order) => ({ ...item, order }));
}

export function nativeEmbeddedSceneId(stageId: string, outline: SceneOutline): string {
  return `${stageId}-${outline.id}`;
}
