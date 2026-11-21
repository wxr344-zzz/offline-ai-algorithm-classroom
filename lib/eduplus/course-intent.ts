import type { SceneOutline } from '@/lib/types/generation';
import { isExamAlgorithmTopic } from '@/lib/eduplus/exam-topic';

// Keep this pattern identical to EXPLICIT_THEORY_PATTERN in agent_workflow.py.
// A missing prerequisite ("不需要编程基础") is not an opt-out of practice.
const THEORY_ONLY =
  /(?:不需要|不要|不用|无需|無需|不必|不涉及|不包含|不含|不做|不安排|不进行|不進行|没有|沒有)(?:任何|安排|进行|進行|做|写|寫|编写|編寫|涉及|包含|额外|額外|专门|專門)?(?:编程|編程|上机|上機|实验|實驗|代码|代碼|程式|写代码|寫程式|动手实践|動手實踐|实操|實操)(?!基础|基礎|经验|經驗|背景|知识|知識|能力|门槛|門檻)|纯理论|純理論|(?<!不要)(?<!不能)(?<!不)(?<!别)(?<!別)(?:只|仅|僅)(?:讲|講|讲解|講解|介绍|介紹|学习|學習)?(?:理论|理論|概念|原理)(?!与|與|和|及|、|加|\+)|不(?:写代码|寫程式)|\btheory[- ]only\b|\bconcepts?[- ]only\b|\b(?:no|without)\s+(?:any\s+)?(?:code|coding|programming|labs?)(?!\s+(?:experience|background|knowledge|prerequisites?|required|needed|skills?))\b/i;

/** Recognised algorithm/data-structure vocabulary. Unknown algorithm names are
 * still classified semantically by the Python Teacher; this only prevents a
 * named algorithm from being treated as a non-programming lesson. */
const PROGRAMMING_TOPIC =
  /python|算法|演算法|数据结构|資料結構|程序设计|程式設計|编程|編程|写代码|寫程式|coding|programming|algorithm|data structures?|排序|查找|检索算法|递归|遞迴|遞歸|链表|鏈表|二叉树|二元樹|二叉樹|树的遍历|樹的遍歷|图的遍历|圖的遍歷|动态规划|動態規劃|贪心|貪心|回溯|分治|哈希表?|散列表|雜湊|最短路|生成树|生成樹|二分|栈|堆栈|堆疊|队列|隊列|佇列|leetcode|力扣|\b(?:sorting|quick ?sort|merge ?sort|binary search|recursion|linked list|binary tree|dynamic programming|greedy|backtracking|hash (?:table|map)|graph traversal|shortest path|bfs|dfs)\b/i;

/**
 * Whether the request is about an algorithm, a data structure or programming
 * (also when only its theory is wanted). Only these classrooms use the EduPlus
 * algorithm design (Lab, maintained simulator, page order and checks); every
 * other topic keeps the native OpenMAIC classroom.
 */
export function isAlgorithmCourse(requirement: string): boolean {
  return PROGRAMMING_TOPIC.test(requirement) || isExamAlgorithmTopic(requirement);
}

/** Select the teaching mode from the user's request, never from model-produced titles. */
export function courseIntent(requirement: string) {
  const theoryOnly = THEORY_ONLY.test(requirement);
  const noProject =
    /(?:不要|不需要|不用|禁止|无需|不采用|不使用)[^，。；,;\n]{0,12}(?:PBL|项目式|项目制)|(?:no|without)\s+(?:PBL|project-based)/i.test(
      requirement,
    );
  const project =
    !noProject &&
    /(?:项目式学习|项目制学习|项目驱动学习|PBL\s*(?:项目|课程|学习)|(?:采用|使用|设计|生成|开展|做|要).{0,8}\bPBL\b|project[ -]based\s+learning|(?:开发|搭建|完成|制作|做)(?:一个|一套|完整的|一个完整的).{0,16}项目)/i.test(
      requirement,
    );
  const programming =
    !theoryOnly && (PROGRAMMING_TOPIC.test(requirement) || isExamAlgorithmTopic(requirement));
  const explicitPractice =
    !theoryOnly &&
    /编程实验|编程练习|算法实验|写代码|引导编程|独立闯关|\b(?:guided|independent)\s+(?:python\s+)?(?:coding|programming|practice|labs?)\b|\b(?:coding|programming|python)\s+(?:lab|exercise|practice)\b/i.test(
      requirement,
    );
  return { project, theoryOnly, programming, explicitPractice };
}

/**
 * @param labAgent whether the learner selected the Lab agent. `false` plans no
 * programming pages at all; `undefined` keeps the keyword-based behaviour.
 */
export function courseIntentDirective(requirement: string, labAgent?: boolean): string {
  const intent = courseIntent(requirement);
  if (intent.project)
    return '用户明确要求项目式学习，允许 pbl，但项目主题、导师任务和语言必须与原始需求一致；禁止套用无关示例项目。';
  const algorithm = isAlgorithmCourse(requirement);
  // An ordinary topic (a science, mathematics or humanities subject) is planned
  // the native way: the model decides which pages the content needs.
  const practice = !algorithm
    ? '先判断主题是否属于算法、数据结构或编程：若属于，按顺序包含概念讲解（至少一页）、交互推演、操作游戏，并规划 type=interactive、widgetType=code、widgetOutline.language=python 的实验，平台负责装配完整流程；若不属于（如自然科学、数学定理、人文、通识主题），不要生成编程实验，其余页面的类型、数量和顺序按课程内容自行决定，并在概念讲解之后安排一个 type=interactive、widgetType=simulation 的交互模拟页（学生调整参数、观察变化）。'
    : intent.theoryOnly
      ? '用户明确只讲理论，禁止生成编程实验（不得规划 widgetType=code 的页面）；仍须包含一个 type=interactive、widgetType=simulation 的交互推演/模拟器页，以及随堂检测与复盘。'
      : labAgent === false
        ? '用户没有选择 Lab agent：禁止规划编程实验（不得规划 widgetType=code 的页面）。按顺序包含：概念讲解（至少一页）、一个 type=interactive、widgetType=simulation 的模拟器页（学生可调整参数或逐步操作、观察变化）、一个 type=interactive、widgetType=game 的操作游戏页、随堂检测与复盘。'
        : '本课涉及算法、数据结构或编程，即使只要求“讲解”，默认必须按顺序包含：概念讲解（至少一页）、交互推演、操作游戏、引导编程、独立情境编程、随堂检测和复盘。规划 type=interactive、widgetType=code、widgetOutline.language=python 的实验；平台负责装配完整流程。不要把编程环节写成静态 PPT。';
  return `课程模式强约束：用户未要求项目式学习，禁止生成 type=pbl 或 pblConfig，禁止把“实践案例”“算法练习”转换为项目工作台。围绕用户指定主题组织教学。${practice} 不得更换课程主题、套用 Text Analysis Project 或虚构无关导师。`;
}

/** Enforce the mode even when the LLM ignores the prompt. Preserve unrelated scene IDs. */
export function enforceCourseIntent(
  outlines: readonly SceneOutline[],
  requirement: string,
): SceneOutline[] {
  const intent = courseIntent(requirement);
  if (intent.project) return outlines.map((item) => ({ ...item }));
  const topic = requirement.trim().slice(0, 240);
  const corrected = outlines.map((item): SceneOutline => {
    if (item.type !== 'pbl') return { ...item };
    // Rebuild instead of retaining a possibly unrelated pblConfig/project description.
    return {
      id: item.id,
      type: intent.programming ? 'interactive' : 'slide',
      title: intent.programming ? '当前考点编程练习' : '当前主题讲解',
      description: `严格围绕原始教学需求：${topic}。不得沿用原项目主题。`,
      keyPoints: [topic],
      order: item.order,
      ...(intent.programming
        ? {
            widgetType: 'code' as const,
            widgetOutline: { language: 'python' as const, concept: topic },
          }
        : {}),
    };
  });
  // A model may emit only a PBL page. A normal lesson still needs a concept introduction.
  if (intent.programming && !corrected.some((item) => item.type === 'slide')) {
    let id = 'eduplus-concept-introduction';
    while (corrected.some((item) => item.id === id)) id += '-intro';
    corrected.unshift({
      id,
      type: 'slide',
      title: '概念引入与教学目标',
      description: topic,
      keyPoints: [topic],
      order: 0,
    });
  }
  return corrected.map((item, order) => ({ ...item, order }));
}
