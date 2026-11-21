import type { Queryable } from '@openmaic/storage/document/pg';
import type {
  SceneOutline,
  GeneratedInteractiveContent,
  GeneratedQuizContent,
} from '@/lib/types/generation';
import type { Scene } from '@/lib/types/stage';
import type { OutlineResult } from '@/lib/server/generation/steps/outline';
import { getEduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import { callAgentForStorage, callTeachingCore, AgentAPIError } from './eduplus-agent-client';
import { nativeQuizQuestions } from '@/lib/eduplus/classroom-adapter';
import { embedLabOutlines, isPythonLab, nativeEmbeddedSceneId } from '@/lib/eduplus/native-outline';
import { normalizeSceneOutlines } from '@/lib/server/generation/outline-schema';
import { courseIntent, enforceCourseIntent, isAlgorithmCourse } from '@/lib/eduplus/course-intent';
import {
  withConceptQuestions,
  type AskModel,
} from '@/lib/server/generation/steps/concept-questions';
import { simulationPreview } from '@/lib/eduplus/simulation-preview';
import { isExamAlgorithmTopic } from '@/lib/eduplus/exam-topic';
import { cleanLectureText, lectureKeyPoints } from '@/lib/eduplus/lecture-content';
import { courseTarget } from '@/lib/server/generation/steps/speech-language';
import { translateTexts } from '@/lib/server/course-translation';
import { applyTeachingTexts, teachingTexts, labDisplayTexts } from '@/lib/eduplus/lab-display';
import { persistentCourseDisplay } from '@/lib/server/persistent-course-display';
import { contentLanguageTag } from '@/lib/eduplus/content-language';

export interface EmbeddedLabRecovery {
  courseId?: string;
  onCourseReady?: (courseId: string) => Promise<void>;
}

/** The regular homepage pipeline calls this, retaining the upstream outline and widget paths. */
/** Lab failures that a fresh attempt may not fix: the content, not the service. */
const LAB_FALLBACK_CODES = new Set([
  'ALGORITHM_CONTRACT_FAILED',
  'REFERENCE_EXECUTION_FAILED',
  'GENERATION_FAILED',
  'TEACHING_FAILED',
  'INVALID_AGENT_RESPONSE',
  'LAB_INTENT_MISMATCH',
  'UPSTREAM_ERROR',
  'AGENT_UPSTREAM_ERROR',
  'AGENT_TIMEOUT',
]);

export async function prepareEmbeddedLabs(
  ownerId: string,
  result: OutlineResult,
  requirement: string,
  signal?: AbortSignal,
  recovery?: EmbeddedLabRecovery,
  /**
   * labAgent: whether the learner selected the Lab agent. `false` publishes no
   * programming Lab (algorithm topics keep the maintained simulator and game,
   * which scene content routes by topic); `true` runs the algorithm classroom;
   * `undefined` keeps the keyword-based routing for older callers.
   */
  options: {
    labAgent?: boolean;
    /**
     * The last attempt: when the Lab of an algorithm topic still cannot be
     * verified (or times out), publish the classroom without the Lab and
     * algorithm-demo pages instead of failing it, and report why.
     */
    fallbackWithoutLab?: boolean;
    /**
     * With fallbackWithoutLab: the previous attempt already failed in a way a
     * new call would only repeat at length (the Agent retries an unverifiable
     * implementation itself), so leave the Lab out without calling it again.
     */
    skipLabCall?: boolean;
    /** The learner chose 深度交互: several interactive pages are intended. */
    interactiveMode?: boolean;
    onNotice?: (notice: { code: string; message: string }) => void;
    /** The course model, for the Lab quiz's concept questions (reviewed). */
    askModel?: AskModel;
  } = {},
): Promise<OutlineResult> {
  const normalized = normalizeSceneOutlines(result.outlines);
  if (!normalized.ok) throw new AgentAPIError(502, 'INVALID_OUTLINE', normalized.message);
  // The explicit vocational mode owns its procedural scenes and assessment path.
  // It must not be reclassified or rewritten as an algorithm/Python classroom.
  if (result.taskEngineMode) return { ...result, outlines: normalized.value };
  const algorithmCourse = isAlgorithmCourse(requirement);
  result = {
    ...result,
    outlines: enforceCourseIntent(normalized.value, requirement).map((item) => {
      // 不让模型把命名为“互动游戏/模拟器”的算法课环节标成静态 PPT（普通主题保持原生大纲）。
      const widget =
        algorithmCourse && item.type === 'slide' && !/介绍|说明/.test(item.title)
          ? /模拟器/.test(item.title)
            ? 'simulation'
            : /互动游戏|挑战游戏/.test(item.title)
              ? 'game'
              : null
          : null;
      return {
        ...item,
        ...(widget
          ? {
              type: 'interactive' as const,
              widgetType: widget as 'simulation' | 'game',
              widgetOutline: { concept: requirement },
            }
          : {}),
        description: cleanLectureText(item.description),
      };
    }),
  };
  const intent = courseIntent(requirement);
  const candidates = result.outlines.filter(isPythonLab);
  if (intent.project) return result;
  // Theory-only requests exclude programming exercises in every language.
  if (intent.theoryOnly) {
    const theory = result.outlines.filter(
      (item) => !(item.type === 'interactive' && item.widgetType === 'code'),
    );
    // A mistaken all-code outline must not turn into an empty classroom after
    // respecting the learner's opt-out. Generate a native concept page instead.
    if (!theory.some((item) => item.type === 'slide')) {
      let id = 'theory-concept-introduction';
      while (theory.some((item) => item.id === id)) id += '-intro';
      theory.unshift({
        id,
        type: 'slide',
        title: result.courseTitle || requirement.trim().slice(0, 120),
        description: requirement,
        keyPoints: [requirement],
        order: 0,
      });
    }
    return {
      ...result,
      outlines: finishOutlines(
        theory,
        requirement,
        result.languageDirective,
        options.interactiveMode,
      ),
    };
  }
  // No Lab agent: the native classroom. No Teacher call and no code pages.
  if (options.labAgent === false) {
    // No programming pages at all, in any language: a code page the local model
    // writes by itself fails to generate (reported: 逻辑回归 "生成失败").
    const native = result.outlines.filter((item) => !isCodePage(item));
    if (!native.length)
      throw new AgentAPIError(502, 'EMPTY_THEORY_OUTLINE', '没有有效理论讲解页，请重新生成大纲。');
    return {
      ...result,
      outlines: finishOutlines(
        native,
        requirement,
        result.languageDirective,
        options.interactiveMode,
      ),
    };
  }
  const store = await getEduplusCourseStore();
  let outlines = result.outlines;
  // The learner asked neither for programming nor for a known algorithm (e.g.
  // a mathematics theorem or a science topic). A Lab is then an optional extra:
  // if the Teacher still proposes one and it cannot be verified, publish the
  // native lesson without any code page instead of failing the whole course.
  // Unverified model code is still never published.
  const optionalLab =
    !intent.programming && !intent.explicitPractice && !isExamAlgorithmTopic(requirement);
  const optionalFailure = (error: unknown) =>
    optionalLab &&
    !signal?.aborted &&
    error instanceof AgentAPIError &&
    error.code !== 'REQUEST_CANCELLED' &&
    !(
      options.labAgent === true &&
      ['ALGORITHM_CONTRACT_FAILED', 'REFERENCE_EXECUTION_FAILED', 'LAB_INTENT_MISMATCH'].includes(
        error.code,
      )
    );
  const withoutLab = (items: SceneOutline[]) => items.filter((item) => !isCodePage(item));
  // An algorithm Lab that the local model could not get right is left out on
  // the last attempt; the rest of the classroom (slides, simulator, game,
  // quiz) is generated as in the native classroom. Unverified code is never published.
  const labFallback = (error: unknown) =>
    !!options.fallbackWithoutLab &&
    options.labAgent !== true &&
    !optionalLab &&
    !signal?.aborted &&
    error instanceof AgentAPIError &&
    LAB_FALLBACK_CODES.has(error.code);
  const fallBack = (items: SceneOutline[]) => {
    options.onNotice?.({
      code: 'LAB_UNAVAILABLE',
      message:
        '本课题的算法实现未能通过独立执行校验，本次课堂不含编程实验和算法推演，其余内容照常生成。',
    });
    return withoutLab(items);
  };
  // Teacher 对任何非项目、非明确理论请求做语义判断；不能用有限算法名单决定是否调用。
  for (const candidate of [candidates[0] ?? null]) {
    const prompt = candidate
      ? `原始教学需求：${requirement}。当前课程：${result.courseTitle ?? requirement}。当前考点：${candidate.title}。教学要求：${candidate.description}。知识点：${candidate.keyPoints.join('、')}。是否需要编程实验以原始需求为准；若需要，使用 Python 为当前考点分别设计引导编程与不同任务的综合情境自主编程，不能复用题目；自主题中等偏下、标准输入输出、不提供代码骨架；纯理论需求应 requires_lab=false。`
      : requirement;
    if (options.skipLabCall && options.fallbackWithoutLab && !recovery?.courseId) {
      if (options.labAgent === true)
        throw new AgentAPIError(
          502,
          'LAB_INTENT_MISMATCH',
          '所选 Lab 尚未通过校验，请恢复实验生成步骤；不会将缺少编程环节的课堂标为完整。',
        );
      outlines = optionalLab ? withoutLab(outlines) : fallBack(outlines);
      continue;
    }
    let course = recovery?.courseId ? await store.get(ownerId, recovery.courseId) : null;
    if (recovery?.courseId && !course)
      throw new AgentAPIError(404, 'COURSE_NOT_FOUND', '已保存的实验资产不存在或无权访问。');
    if (!course) {
      let generated: Awaited<ReturnType<typeof callAgentForStorage>>;
      try {
        generated = await callAgentForStorage(prompt.slice(0, 12000), signal, ownerId);
      } catch (error) {
        if (optionalFailure(error)) {
          outlines = withoutLab(outlines);
          continue;
        }
        if (labFallback(error)) {
          outlines = fallBack(outlines);
          continue;
        }
        throw error;
      }
      if (!generated.publicCourse.requiresLab) {
        if (
          intent.explicitPractice ||
          /算法|数据结构|algorithm|data structures/i.test(requirement) ||
          isExamAlgorithmTopic(requirement)
        ) {
          const mismatch = new AgentAPIError(
            502,
            'LAB_INTENT_MISMATCH',
            '编程环节未生成有效实验资产，请重试该生成步骤。',
          );
          if (labFallback(mismatch)) {
            outlines = fallBack(outlines);
            continue;
          }
          throw mismatch;
        }
        if (candidate) outlines = outlines.filter((item) => item.id !== candidate.id);
        continue;
      }
      course = await store.save(ownerId, generated);
      if (recovery) recovery.courseId = course.courseId;
      await recovery?.onCourseReady?.(course.courseId);
    }
    if (!(optionalLab && !algorithmCourse))
      result = { ...result, courseTitle: course.lessonPlan.title };
    let teaching: Awaited<ReturnType<typeof callTeachingCore>>;
    try {
      teaching = await callTeachingCore(course, signal);
    } catch (error) {
      if (optionalFailure(error)) {
        outlines = withoutLab(outlines);
        continue;
      }
      if (labFallback(error)) {
        outlines = fallBack(outlines);
        continue;
      }
      throw error;
    }
    // The quiz also asks about the algorithm itself, not only computed outputs.
    teaching = await withConceptQuestions(
      teaching,
      course,
      result.languageDirective,
      options.askModel,
      console,
    );
    // A course taught in another language: the teaching (overview, demo, quiz)
    // written by the Chinese teaching core is shown in that language, and the
    // Lab's own display text is translated now so the Lab opens without waiting.
    // Grading assets stay as generated; any failure keeps the original text.
    const target = courseTarget(result.languageDirective);
    const english = !!target && !target.startsWith('zh');
    if (target && target !== 'zh-CN' && options.askModel) {
      const map = await persistentCourseDisplay(
        store,
        ownerId,
        course.courseId,
        contentLanguageTag(target),
        [...teachingTexts(teaching), ...labDisplayTexts(course)],
        options.askModel,
      );
      teaching = applyTeachingTexts(teaching, map);
    }
    // The Lab is the programming part: a leftover code page in another language
    // is not generated on its own (the Lab runs Python; the home page says so).
    outlines = embedLabOutlines(outlines, course, teaching, {
      ordinary: optionalLab && !algorithmCourse,
      english,
    }).filter((item) => !isCodePage(item));
    if (target && target !== 'zh-CN' && options.askModel) {
      // The titles and descriptions of the pages the Lab added, in the course language.
      const added = outlines.filter((item) => item.id.startsWith(`eduplus-${course.courseId}-`));
      try {
        const map = await translateTexts(
          added.flatMap((item) => [item.title, item.description]),
          result.languageDirective,
          options.askModel,
        );
        outlines = outlines.map((item) =>
          added.includes(item)
            ? {
                ...item,
                title: map.get(item.title) ?? item.title,
                description: map.get(item.description) ?? item.description,
              }
            : item,
        );
      } catch (error) {
        console.warn('Lab page titles kept as written:', error);
      }
    }
    // An ordinary (non-algorithm) lesson that the Teacher gave an optional Lab
    // keeps its native pages exactly as without the Lab agent: its simulator,
    // lecture focus and quiz are about the subject, not about the Lab's Python
    // exercise (reported: with the Lab agent the gravity simulator was built
    // from the exercise's inputs - a "constant" slider, no readout, one
    // observation). Only the Lab pages are added.
    if (optionalLab && !algorithmCourse) {
      if (outlines.length > 100)
        throw new AgentAPIError(400, 'TOO_MANY_SCENES', '课程与实验超过 100 页，请缩小课程范围。');
      continue;
    }
    outlines = outlines.map((item) =>
      item.type === 'interactive' &&
      (item.widgetType === 'simulation' || item.widgetType === 'game')
        ? { ...item, algorithmDemo: { courseId: course.courseId, teaching } }
        : item,
    );
    // Native layout and page focus remain native; computational facts come
    // from the accepted course, never an earlier model's unrelated examples.
    // Each lecture page gets its own focus: its title plus its share of the
    // accepted course's knowledge points (point i goes to lecture page i mod
    // n), instead of the same overview and the whole list on every page
    // (reported: every slide repeating one summary). The model's own outline
    // examples are not used: computational facts come from the accepted course.
    const coursePoints = lectureKeyPoints(course.lessonPlan.knowledgePoints);
    const lecturePages = outlines.filter((item) => !item.eduplus && item.type === 'slide');
    const zh =
      !english && (/中文/.test(result.languageDirective) || /[\u4e00-\u9fff]/.test(course.topic));
    outlines = outlines.map((item) => {
      if (item.eduplus) return item;
      const page = lecturePages.indexOf(item);
      const share =
        page < 0 ? coursePoints : coursePoints.filter((_, i) => i % lecturePages.length === page);
      const title = cleanLectureText(item.title);
      const description =
        page <= 0 || !share.length
          ? `${course.topic}：${title}。${teaching.overview}`
          : `${course.topic}：${title}。${zh ? '本页重点：' : 'Focus of this page: '}${share.join(zh ? '；' : '; ')}`;
      return { ...item, description, keyPoints: share.length ? share : coursePoints };
    });
    if (/简体中文/.test(result.languageDirective)) {
      result = { ...result, courseTitle: course.lessonPlan.title };
      outlines = outlines.map((item) =>
        item.eduplus
          ? item
          : {
              ...item,
              title: /[\u4e00-\u9fff]/.test(item.title)
                ? item.title
                : `${course.topic}：${item.type === 'slide' ? '概念讲解' : item.type === 'quiz' ? '随堂检测' : item.widgetType === 'game' ? '互动游戏' : '交互演示'}`,
            },
      );
    }
    // Reuse the original native quiz slot, but source its questions from the same validated course.
    const nativeQuiz = outlines.find((item) => item.type === 'quiz' && !item.eduplus);
    const labQuiz = outlines.find(
      (item) => item.eduplus?.courseId === course.courseId && item.eduplus.phase === 'quiz',
    );
    if (nativeQuiz && labQuiz) {
      outlines = outlines
        .filter((item) => item.id !== labQuiz.id)
        .map((item) =>
          item.id === nativeQuiz.id
            ? {
                ...item,
                title: english ? 'Lab quiz' : `${course.topic}：随堂检测`,
                eduplus: labQuiz.eduplus,
              }
            : item,
        );
    }
    if (outlines.length > 100)
      throw new AgentAPIError(400, 'TOO_MANY_SCENES', '课程与实验超过 100 页，请缩小课程范围。');
  }
  if (!outlines.length)
    throw new AgentAPIError(502, 'EMPTY_THEORY_OUTLINE', '没有有效理论讲解页，请重新生成大纲。');
  return {
    ...result,
    outlines: finishOutlines(
      outlines,
      requirement,
      result.languageDirective,
      options.interactiveMode,
    ),
  };
}

function isCodePage(item: SceneOutline): boolean {
  return item.type === 'interactive' && item.widgetType === 'code' && !item.eduplus;
}

/**
 * The final outline. An algorithm classroom gets the EduPlus structure (one
 * simulator, the canonical page order, a concept page first); any other topic
 * keeps the native outline exactly as planned.
 */
type ActivityKind = 'quiz' | 'game' | 'simulation' | 'programming';

/** The activity a page title announces (a static slide must not pose as one). */
export function announcedActivity(title: string): ActivityKind | null {
  const t = title.normalize('NFKC');
  if (/\bcode\s+(?:practice|exercise|lab|challenge)\b/i.test(t)) return 'programming';
  if (
    /\b(?:guided|independent|autonomous)\s+(?:[A-Za-z+#]+\s+){0,2}(?:lab|coding|programming|practice|exercise)\b/i.test(
      t,
    )
  )
    return 'programming';
  if (
    /引导编程|自主编程|编程实验|编程练习|独立闯关|代码实践|coding\s*challenge|guided\s*(?:(?:python|java(?:script)?|typescript|c\+\+|c#|coding|programming)\s*)?(?:lab|practice|exercise)|oj\s*lab|coding\s*(?:lab|exercise|practice)|programming\s*(?:lab|exercise|practice)/i.test(
      t,
    )
  )
    return 'programming';
  if (
    /随堂检测|随堂测验|知识检测|概念检测|小测|测验|自测|\bquiz\b|self[-\s]?check|knowledge\s*check/i.test(
      t,
    )
  )
    return 'quiz';
  if (/游戏|闯关挑战|\bgame\b/i.test(t)) return 'game';
  if (/模拟器|交互模拟|交互演示|互动演示|\bsimulator\b|interactive\s*(?:demo|simulation)/i.test(t))
    return 'simulation';
  return null;
}

function realActivity(item: SceneOutline): ActivityKind | null {
  if (item.type === 'quiz' || item.eduplus?.phase === 'quiz') return 'quiz';
  if (item.eduplus?.phase === 'guided-lab' || item.eduplus?.phase === 'oj-lab')
    return 'programming';
  if (item.type !== 'interactive') return null;
  if (item.widgetType === 'game') return 'game';
  if (item.widgetType === 'code') return 'programming';
  if (item.widgetType === 'simulation' || item.algorithmDemo) return 'simulation';
  return null;
}

/**
 * A static slide titled as a game, programming exercise, quiz or simulator is
 * a placeholder the outline model left next to (or instead of) the real
 * activity. When the real activity exists the placeholder repeats it and goes;
 * when it does not, a quiz/game/simulation placeholder becomes that activity.
 * A programming placeholder without a Lab stays a lecture page under a neutral
 * title. Applies to every topic.
 */
export function withoutStaticActivityPages(
  outlines: SceneOutline[],
  languageDirective = '',
): SceneOutline[] {
  const present = new Set(outlines.map(realActivity).filter(Boolean));
  const chinese =
    /中文/.test(languageDirective) ||
    (!languageDirective && outlines.some((o) => /[\u4e00-\u9fff]/.test(o.title)));
  const result: SceneOutline[] = [];
  for (const item of outlines) {
    const kind = item.type === 'slide' ? announcedActivity(item.title) : null;
    if (!kind) {
      result.push(item);
      continue;
    }
    if (present.has(kind)) continue;
    if (kind === 'quiz') {
      result.push({ ...item, type: 'quiz' });
      present.add('quiz');
    } else if (kind === 'game' || kind === 'simulation') {
      result.push({
        ...item,
        type: 'interactive',
        widgetType: kind,
        widgetOutline: { concept: item.keyPoints[0] ?? item.title },
      });
      present.add(kind);
    } else {
      result.push({
        ...item,
        title: chinese ? '要点讲解' : 'Key ideas',
      });
    }
  }
  // Never leave a classroom without any lecture page.
  return result.some((item) => item.type === 'slide') ? result : outlines;
}

export function finishOutlines(
  outlines: SceneOutline[],
  requirement: string,
  languageDirective = '',
  // Retained only for reading historical requests. Simulator presence no longer
  // depends on a browser preference or an alternate outline template.
  _interactiveMode?: boolean,
): SceneOutline[] {
  outlines = withoutStaticActivityPages(outlines, languageDirective);
  outlines = ensureSimulation(outlines, requirement, languageDirective, false);
  outlines = completeLessonStructure(outlines, requirement, languageDirective);
  const hands = (item: SceneOutline) =>
    item.type === 'interactive' &&
    (item.widgetType === 'simulation' ||
      item.widgetType === 'diagram' ||
      item.widgetType === 'visualization3d' ||
      !!item.algorithmDemo);
  const result = isAlgorithmCourse(requirement)
    ? orderAlgorithmClassroom(outlines, requirement, languageDirective)
    : (() => {
        // Keep all simulation pages before the first assessment or closing page,
        // even if the model originally put them after the quiz. No widget repair
        // is allowed to change this teaching order later.
        const lectures = outlines.filter(
          (item) => item.type === 'slide' && !SUMMARY.test(item.title),
        );
        const simulations = outlines.filter(hands);
        const activities = outlines.filter(
          (item) => item.type !== 'slide' && item.type !== 'quiz' && !hands(item),
        );
        const quizzes = outlines.filter((item) => item.type === 'quiz');
        const closing = outlines.filter(
          (item) => item.type === 'slide' && SUMMARY.test(item.title),
        );
        return [...lectures, ...simulations, ...activities, ...quizzes, ...closing];
      })();
  return result.map((item, order) => ({ ...item, order }));
}

const SUMMARY = /总结|复盘|小结|回顾|summary|recap|review/i;

/** Complete missing teaching phases before generating their real content. */
function completeLessonStructure(
  items: SceneOutline[],
  requirement: string,
  language: string,
): SceneOutline[] {
  if (items.some((item) => item.type === 'pbl')) return items;
  const result = [...items];
  const chinese = /中文/.test(language) || (!language && /[\u4e00-\u9fff]/.test(requirement));
  const topic = requirement.trim().slice(0, 160);
  const points = [
    ...new Set(
      items
        .filter((item) => item.type === 'slide' && !SUMMARY.test(item.title))
        .flatMap((item) => item.keyPoints),
    ),
  ];
  const add = (id: string, type: SceneOutline['type'], title: string, description: string) => {
    while (result.some((item) => item.id === id)) id += '-1';
    result.push({
      id,
      type,
      title,
      description,
      keyPoints: points.length ? points : [topic],
      order: 0,
    });
  };
  if (!result.some((item) => item.type === 'slide' && !SUMMARY.test(item.title)))
    add(
      'lesson-concepts',
      'slide',
      chinese ? '概念与核心步骤' : 'Concepts and key steps',
      chinese
        ? `解释“${topic}”的定义、用途、核心机制与必要前提。`
        : `Explain the definition, purpose, mechanism and prerequisites of "${topic}".`,
    );
  if (result.filter((item) => item.type === 'slide' && !SUMMARY.test(item.title)).length < 2)
    add(
      'lesson-worked-example',
      'slide',
      chinese ? '原理与实例分析' : 'Principles and worked example',
      chinese
        ? `围绕“${topic}”详细解释关键机制，给出一个完整具体实例并分析过程和结果；承接概念介绍，不重复封面和学习目标。`
        : `Explain the mechanism of "${topic}" through a concrete worked example, its process and result. Build on the introduction without repeating objectives.`,
    );
  if (!result.some((item) => item.type === 'quiz'))
    add(
      'lesson-knowledge-check',
      'quiz',
      chinese ? '随堂检测' : 'Knowledge check',
      chinese
        ? '检测本课已讲解的概念、机制与实例推理，不考界面格式或未讲解内容。'
        : 'Assess the concepts, mechanisms and example reasoning taught in this lesson, not interface formats or untaught material.',
    );
  if (!result.some((item) => item.type === 'slide' && SUMMARY.test(item.title)))
    add(
      'lesson-summary',
      'slide',
      chinese ? '课程总结' : 'Lesson summary',
      chinese
        ? `总结“${topic}”的关键机制、实例结论和易错点；不引入新主题，也不重复整段定义。`
        : `Summarize the key mechanism, example conclusions and common mistakes of "${topic}", without introducing new topics or repeating whole definitions.`,
    );
  return result;
}

/**
 * An algorithm classroom in teaching order: concept pages, the simulator, the
 * game, guided and independent programming, the quiz, then the summary and
 * the review. The model's order of pages of one kind is kept. Without any
 * concept page (the model planned only activities) one is added first.
 */
export function orderAlgorithmClassroom(
  outlines: SceneOutline[],
  requirement: string,
  languageDirective = '',
): SceneOutline[] {
  const rank = (item: SceneOutline): number => {
    if (item.eduplus?.phase === 'guided-lab') return 3;
    if (item.eduplus?.phase === 'oj-lab') return 4;
    if (item.eduplus?.phase === 'review') return 7;
    if (item.type === 'quiz') return 5;
    if (item.type === 'slide') return SUMMARY.test(item.title) ? 6 : 0;
    if (item.type === 'interactive') {
      if (item.widgetType === 'game') return 2;
      if (item.widgetType === 'code') return 3;
      return 1;
    }
    return 6;
  };
  const ordered = outlines
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => item);
  if (ordered.some((item) => rank(item) === 0)) return ordered;
  const topic = requirement.trim().slice(0, 120);
  const english = !/中文/.test(languageDirective) && !/[\u4e00-\u9fff]/.test(topic);
  let id = 'algorithm-concept-introduction';
  while (ordered.some((item) => item.id === id)) id += '-1';
  const concept: SceneOutline = {
    id,
    type: 'slide',
    title: english ? 'Concepts and key steps' : '概念与核心步骤',
    description: english
      ? `Introduce "${topic}": what problem it solves, its key idea and its steps, with a small example.`
      : `讲解“${topic}”：要解决的问题、核心思想和执行步骤，并配一个小例子。`,
    keyPoints: [topic],
    order: 0,
  };
  return [concept, ...ordered];
}

/**
 * One hands-on simulator per lesson. A second simulation, diagram or 3D page
 * written by the local model rarely works (it ends as a step-card fallback
 * whose buttons do nothing) and repeats the simulator. Games, Labs and
 * algorithm demonstrations are kept.
 */
function oneSimulator(outlines: SceneOutline[], languageDirective = ''): SceneOutline[] {
  const simulatorLike = (item: SceneOutline) =>
    item.type === 'interactive' &&
    !item.eduplus &&
    (item.widgetType === 'simulation' ||
      item.widgetType === 'diagram' ||
      item.widgetType === 'visualization3d');
  const keep =
    outlines.find((item) => simulatorLike(item) && item.widgetType === 'simulation') ??
    outlines.find(simulatorLike);
  if (!keep) return outlines;
  const kept = outlines.filter((item) => !simulatorLike(item) || item === keep);
  const merged = outlines.filter(simulatorLike);
  if (kept.length === outlines.length && keep.widgetType === 'simulation') return outlines;
  // A diagram/3D page that stays as the only one becomes the lesson's simulator
  // (built from a checked design), so no second simulator is added after it.
  return kept.map((item) =>
    item === keep && (item.widgetType !== 'simulation' || merged.length > 1)
      ? {
          ...item,
          widgetType: 'simulation' as const,
          ...(merged.length > 1
            ? {
                title: /中文/.test(languageDirective) ? '交互模拟' : 'Interactive simulation',
                description: merged.map((page) => page.description).join('\n'),
                keyPoints: [...new Set(merged.flatMap((page) => page.keyPoints))].slice(0, 6),
              }
            : {}),
        }
      : item,
  );
}

/** Every ordinary lesson keeps one hands-on simulator. When the outline model
 * omits it, add a native simulator page (the regular widget generator builds
 * it; algorithm topics are still routed to the maintained simulator later). */
export function ensureSimulation(
  outlines: SceneOutline[],
  requirement: string,
  languageDirective = '',
  /** 深度交互 mode plans several interactive pages on purpose: keep them all. */
  interactiveMode = false,
): SceneOutline[] {
  if (!interactiveMode) outlines = oneSimulator(outlines, languageDirective);
  if (!outlines.length || outlines.some((item) => item.widgetType === 'simulation'))
    return outlines;
  const topic = requirement.trim().slice(0, 120);
  const chinese =
    /中文/.test(languageDirective) || (!languageDirective && /[\u4e00-\u9fff]/.test(topic));
  const slide = outlines.find((item) => item.type === 'slide');
  let id = 'native-simulation';
  while (outlines.some((item) => item.id === id)) id += '-1';
  const simulation: SceneOutline = {
    id,
    type: 'interactive',
    title: chinese ? '交互模拟' : 'Interactive simulation',
    description: chinese
      ? `围绕“${topic}”设计与主题相符的可操作模拟：学生调整参数或逐步操作，观察变化并得出结论。不涉及编程。`
      : `A hands-on simulation for "${topic}": learners adjust parameters or step through the process and observe the result. No programming.`,
    keyPoints: slide?.keyPoints.length ? slide.keyPoints : [topic],
    order: 0,
    widgetType: 'simulation',
    widgetOutline: { concept: topic },
  };
  // After the concept explanation, before summaries, assessments and Lab phases.
  const at = outlines.findIndex(
    (item, index) =>
      index > 0 &&
      (item.type === 'quiz' ||
        item.eduplus ||
        item.widgetType === 'code' ||
        /总结|复盘|summary/i.test(item.title)),
  );
  const position = at === -1 ? outlines.length : at;
  return [...outlines.slice(0, position), simulation, ...outlines.slice(position)];
}

export async function embeddedLabContent(
  ownerId: string,
  outline: SceneOutline,
): Promise<GeneratedInteractiveContent | GeneratedQuizContent> {
  const ref = outline.eduplus!;
  const course = await (await getEduplusCourseStore()).get(ownerId, ref.courseId);
  if (!course) throw new AgentAPIError(404, 'COURSE_NOT_FOUND', '实验资产不存在或无权访问。');
  if (ref.phase === 'quiz') return { questions: nativeQuizQuestions(ref.courseId, ref.teaching) };
  const escapeHTML = (text: string) =>
    text.replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
  const lab = course.scenes.find((scene) => scene.sceneType === ref.phase);
  const objectives = course.lessonPlan.objectives
    .map((item) => `<li>${escapeHTML(item)}</li>`)
    .join('');
  const context = lab
    ? `<h2>实验说明</h2><p style="white-space:pre-wrap">${escapeHTML(lab.sceneType === 'guided-lab' ? lab.problem.instructions.replace(/应用场景\s*[：:]\s*/g, '') : lab.problem.instructions)}</p>` +
      `<h2>约束</h2><ul>${lab.problem.constraints.map((item) => `<li>${escapeHTML(item)}</li>`).join('')}</ul>` +
      `<h2>公开示例</h2><ul>${lab.problem.publicTestCases.map((item) => `<li>${escapeHTML(JSON.stringify(item.inputs))} → ${escapeHTML(JSON.stringify(item.expected))}</li>`).join('')}</ul>` +
      `<h2>编程入口</h2><pre>${escapeHTML(lab.interactiveCode)}</pre>` +
      (lab.sceneType === 'guided-lab'
        ? `<h2>引导步骤</h2><ol>${lab.teachingSteps.map((step) => `<li>${escapeHTML(step.title)}：${escapeHTML(step.instruction)} ${escapeHTML(step.hint)}</li>`).join('')}</ol>`
        : '')
    : '<p>复盘当前实验的已保存作答、练习记录和测验。</p>';
  return {
    html: `<h1>${escapeHTML(outline.title)}</h1><h2>学习目标</h2><ul>${objectives}</ul>${context}`,
    eduplus: { courseId: ref.courseId, phase: ref.phase },
  };
}

export async function embeddedAlgorithmContent(
  ownerId: string,
  outline: SceneOutline,
): Promise<GeneratedInteractiveContent> {
  const ref = outline.algorithmDemo;
  if (!ref || (outline.widgetType !== 'simulation' && outline.widgetType !== 'game'))
    throw new AgentAPIError(502, 'INVALID_ALGORITHM_DEMO', '算法互动环节缺少有效的推演规格。');
  const course = await (await getEduplusCourseStore()).get(ownerId, ref.courseId);
  if (!course) throw new AgentAPIError(404, 'COURSE_NOT_FOUND', '算法实验资产不存在或无权访问。');
  return {
    html: simulationPreview(course.topic),
    simulation: { topic: course.topic, mode: outline.widgetType, courseId: course.courseId },
    widgetType: outline.widgetType,
  };
}

export function embeddedLabScene(
  stageId: string,
  outline: SceneOutline,
  content: GeneratedInteractiveContent | GeneratedQuizContent,
  /** The Lab agent of this course, when the learner selected it: it tutors the programming phases. */
  tutorAgentId?: string,
  /** The course language: the platform's own lines follow it. */
  languageDirective?: string,
): Scene & { outlineId: string } {
  const id = nativeEmbeddedSceneId(stageId, outline);
  const ref = outline.eduplus!;
  const lab = ref.phase === 'guided-lab' || ref.phase === 'oj-lab';
  const en = courseTarget(languageDirective) === 'en';
  const tutor =
    lab && tutorAgentId
      ? en
        ? ' The Lab tutor will give you hints if you get stuck.'
        : '遇到困难时，实验导师会给你提示。'
      : '';
  const text = en
    ? ref.phase === 'guided-lab'
      ? `Now for the guided Lab. Complete the code using the explanation and demonstration so far, run the public tests and save your draft.${tutor}`
      : ref.phase === 'oj-lab'
        ? `Now solve the transfer problem on the same topic on your own, starting from a blank editor. "Run code" runs only the input you enter; "Run public tests" judges every public sample and shows the pass count and each verdict.${tutor}`
        : ref.phase === 'quiz'
          ? 'Take the quiz to check your understanding of this topic.'
          : 'Review the saved answers, practice runs and quiz of this Lab.'
    : ref.phase === 'guided-lab'
      ? `现在进入引导编程。结合前面的讲解和演示完成代码，运行公开测试并保存草稿。${tutor}`
      : ref.phase === 'oj-lab'
        ? `现在独立完成同一考点下的迁移题，请从空白作答区独立实现。“运行代码”只运行你在输入框中填写的数据；点击“运行公开测试”会逐项评测公开样例，并显示通过数与各项判题结果。${tutor}`
        : ref.phase === 'quiz'
          ? '完成随堂测验，检查对当前知识点的理解。'
          : '复盘当前实验的已保存作答、练习记录和测验。';
  const holdTopic = en
    ? lab && tutorAgentId
      ? 'Finish this Lab step before moving on; ask the Lab tutor if you need help.'
      : 'Finish this step before moving on; ask the teacher if you need help.'
    : lab && tutorAgentId
      ? '完成当前实验阶段后再继续；需要帮助时向实验导师提问。'
      : '完成当前实验阶段后再继续；需要帮助时向老师提问。';
  const holdPrompt = en
    ? 'Give a hint based on the current public problem statement and topic, never the full answer.'
    : '结合当前公开题面和知识点给出提示，不给完整答案。';
  return {
    id,
    stageId,
    outlineId: outline.id,
    order: outline.order,
    title: outline.title,
    type: ref.phase === 'quiz' ? 'quiz' : 'interactive',
    content:
      ref.phase === 'quiz'
        ? { type: 'quiz', ...(content as GeneratedQuizContent) }
        : { type: 'interactive', ...(content as GeneratedInteractiveContent) },
    actions: [
      { id: `${id}-speech`, type: 'speech', text },
      ...(ref.phase !== 'review'
        ? [
            {
              id: `${id}-hold`,
              type: 'discussion' as const,
              topic: holdTopic,
              prompt: holdPrompt,
              // The Lab agent leads the help discussion of the programming phases.
              ...(lab && tutorAgentId ? { agentId: tutorAgentId } : {}),
            },
          ]
        : []),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as Scene & { outlineId: string };
}

/** Run document + asset binding share the same owner/lease-fenced transaction. */
export async function bindEmbeddedLabsIn(
  tx: Queryable,
  ownerId: string,
  stageId: string,
  outlines: readonly SceneOutline[],
  actualSceneIds?: ReadonlyMap<string, string>,
): Promise<void> {
  const seen = new Set<string>();
  for (const outline of outlines) {
    const ref = outline.eduplus;
    if (!ref || seen.has(ref.courseId)) continue;
    seen.add(ref.courseId);
    const quiz = outlines.find(
      (item) => item.eduplus?.courseId === ref.courseId && item.eduplus.phase === 'quiz',
    );
    const mapping = {
      stageId,
      teaching: ref.teaching,
      ...(quiz
        ? { quizSceneId: actualSceneIds?.get(quiz.id) ?? nativeEmbeddedSceneId(stageId, quiz) }
        : {}),
    };
    const result = await tx.query(
      `UPDATE eduplus_courses SET classroom_data=$3::jsonb
      WHERE course_id=$1 AND owner_id=$2 AND (classroom_data IS NULL OR classroom_data->>'stageId'=$4) RETURNING course_id`,
      [ref.courseId, ownerId, JSON.stringify(mapping), stageId],
    );
    if (!result.rows.length)
      throw new AgentAPIError(
        409,
        'LAB_BINDING_REFUSED',
        '实验资产已绑定其他课程或无权访问，未覆盖课程。',
      );
  }
}
