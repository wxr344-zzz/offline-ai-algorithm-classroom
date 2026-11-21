import type { PublicCourse } from '@/lib/types/eduplus.generated';
import type { ClassroomTeaching } from '@/lib/types/eduplus-teaching.generated';
import type { AppDocumentOutline } from '@/lib/document-store/persistence-types';
import type { Scene, Stage, QuizQuestion } from '@/lib/types/stage';
import { parseTeaching } from './classroom-contract';

export const nativeStageId = (courseId: string) => `stage-eduplus-${courseId}`;
export const nativeQuizSceneId = (courseId: string) => `${nativeStageId(courseId)}-quiz`;
export function nativeQuizQuestions(courseId: string, teaching: ClassroomTeaching): QuizQuestion[] {
  return teaching.questions.map((q, index) => ({
    id: `${nativeQuizSceneId(courseId)}-q${index + 1}`,
    type: 'single',
    question: q.question,
    options: q.options.map((label, i) => ({ label, value: ['A', 'B', 'C', 'D'][i] })),
    answer: [q.answer],
    analysis: q.analysis,
    hasAnswer: true,
    points: 1,
  }));
}
function escapeHTML(text: string) {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}
/** Native document plus fixed Lab references. Private grading assets never enter the Stage. */
export function buildNativeClassroom(
  course: PublicCourse,
  input: ClassroomTeaching,
  now = Date.now(),
): {
  stage: Stage;
  scenes: Scene[];
  outline: AppDocumentOutline;
} {
  const teaching = parseTeaching(input);
  const stageId = nativeStageId(course.courseId);
  const phases = course.requiresLab
    ? (['concept', 'demo', 'guided-lab', 'oj-lab', 'quiz', 'review'] as const)
    : (['concept', 'demo', 'quiz', 'review'] as const);
  const titles = {
    concept: '概念引入',
    demo: '公开示例观察',
    'guided-lab': '引导编程',
    'oj-lab': '独立练习',
    quiz: '随堂检测',
    review: '学习复盘与导出',
  };
  const scenes: Scene[] = phases.map((phase, index) => {
    const text =
      phase === 'concept'
        ? teaching.overview
        : phase === 'demo'
          ? teaching.demoExplanation
          : phase === 'quiz'
            ? '请完成概念测验。概念掌握与编程测试分别记录。'
            : phase === 'review'
              ? '复盘已保存的判题记录与作答，查看各次评测的通过数。'
              : phase === 'guided-lab'
                ? '根据分步提示完成代码，并运行公开测试。'
                : '独立完成同一考点下的迁移题：任务与引导题不同，从空白作答区实现，不查看引导步骤。';
    const base = {
      id: `${stageId}-${phase}`,
      stageId,
      title: titles[phase],
      order: index,
      createdAt: now,
      updatedAt: now,
      actions: [
        { id: `${stageId}-${phase}-speech`, type: 'speech' as const, text },
        ...(phase === 'demo' || phase === 'guided-lab' || phase === 'oj-lab' || phase === 'quiz'
          ? [
              {
                id: `${stageId}-${phase}-hold`,
                type: 'discussion' as const,
                topic:
                  phase === 'demo'
                    ? `围绕“${course.topic}”观察公开示例，讨论输入、预期输出和边界条件。`
                    : '请完成当前阶段并保存作答，再继续下一阶段；需要帮助时可发起讨论。',
                prompt: '结合当前公开教学信息讨论，给思路，不给完整实验答案，不宣称知道隐藏用例。',
              },
            ]
          : []),
      ],
    };
    if (phase === 'quiz')
      return {
        ...base,
        type: 'quiz',
        content: { type: 'quiz', questions: nativeQuizQuestions(course.courseId, teaching) },
      };
    // Each Lab page shows its own task; the OJ transfer task is not the guided problem.
    const labContext = (
      course.scenes.find((scene) => scene.sceneType === phase) ?? course.scenes[0]
    )?.problem;
    const publicContext =
      labContext && ['demo', 'guided-lab', 'oj-lab'].includes(phase)
        ? `<h2>公开题目规格</h2><pre>${escapeHTML(
            JSON.stringify(
              {
                title: labContext.title,
                instructions: labContext.instructions,
                constraints: labContext.constraints,
                entryPoint: labContext.entryPoint,
                publicTestCases: labContext.publicTestCases,
              },
              null,
              2,
            ),
          )}</pre>`
        : '';
    return {
      ...base,
      type: 'interactive',
      content: {
        type: 'interactive',
        html: `<h1>${escapeHTML(titles[phase])}</h1><p>${escapeHTML(text)}</p><p>${escapeHTML(course.topic)}</p>${publicContext}`,
        eduplus: { courseId: course.courseId, phase },
      },
      ...(phase === 'demo'
        ? {
            multiAgent: {
              enabled: true,
              agentIds: ['default-1', 'default-2', 'default-3'],
              directorPrompt:
                '围绕当前主题与公开示例讨论，先观察输入输出再分析边界；不宣称知道隐藏用例或正式成绩。',
            },
          }
        : {}),
    };
  });
  return {
    stage: {
      id: stageId,
      name: course.lessonPlan.title,
      description: `EduPlus · ${course.topic}`,
      createdAt: now,
      updatedAt: now,
      agentIds: ['default-1', 'default-2', 'default-3'],
    },
    scenes,
    outline: {
      generationComplete: true,
      producer: 'server-job',
      producerRef: `eduplus:${course.courseId}`,
      outlines: scenes.map((scene) => ({
        id: scene.id,
        type: scene.type,
        title: scene.title,
        description: scene.title,
        keyPoints: course.lessonPlan.knowledgePoints,
        order: scene.order,
      })),
      createdAt: now,
      updatedAt: now,
    },
  };
}
