import { z } from 'zod';
import type { PublicCourse } from '@/lib/types/eduplus.generated';
import type { ClassroomTeaching, TeachingQuestion } from '@/lib/types/eduplus-teaching.generated';
import type { GeneratedQuizContent, SceneOutline } from '@/lib/types/generation';
import { reviewQuizContent } from './quiz-review';

export type AskModel = (system: string, prompt: string) => Promise<string>;

const draftSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(4).max(2000),
        options: z.array(z.string().min(1).max(300)).length(4),
        answer: z.enum(['A', 'B', 'C', 'D']),
        analysis: z.string().min(4).max(2000),
      }),
    )
    .min(1)
    .max(3),
});

const LETTERS = ['A', 'B', 'C', 'D'] as const;

/**
 * The Lab's quiz asks about the algorithm itself, not only about inputs and
 * outputs of the demonstration (reported: every question was "hand-compute
 * these two inputs"). Up to three concept questions are written from the
 * course's knowledge points and reviewed facts, then checked by the same
 * independent review as native quizzes; they come first, followed by one
 * computed question and the step question, whose answers come from execution.
 * Without a model, or when the questions do not pass review, the verified
 * questions stay as they were.
 */
export async function withConceptQuestions(
  teaching: ClassroomTeaching,
  course: Pick<PublicCourse, 'topic' | 'lessonPlan'>,
  languageDirective: string,
  ask: AskModel | undefined,
  log?: { warn: (...args: unknown[]) => void },
): Promise<ClassroomTeaching> {
  if (!ask) return teaching;
  const english = /\blocale en\b|\blocale en-|\bEnglish\b/i.test(languageDirective);
  const facts = teaching.overview.slice(0, 2400);
  const points = course.lessonPlan.knowledgePoints.slice(0, 8).join('；');
  const system = english
    ? 'Write 3 single-choice concept questions about the algorithm for a classroom quiz. Test understanding of its idea, steps, conditions, correctness, complexity or typical use, NOT the output for a particular input. Each question has exactly 4 options and exactly one correct option; distractors are plausible misconceptions. Base every claim on the supplied facts; do not invent variants. Return ONLY JSON {"questions":[{"question":"...","options":["...","...","...","..."],"answer":"A","analysis":"why the answer is right and the others are wrong"}]}.'
    : '为课堂随堂检测编写 3 道关于该算法本身的单选概念题。考查核心思想、执行步骤、前提或终止条件、正确性、复杂度或典型应用，不要考某个具体输入的输出结果。每题恰好 4 个选项且只有一个正确，干扰项是常见误解。所有结论必须以给定事实为依据，不要虚构变体。只返回 JSON {"questions":[{"question":"题干","options":["选项","选项","选项","选项"],"answer":"A","analysis":"说明正确选项的依据以及其他选项错在哪里"}]}。';
  const prompt = JSON.stringify({ topic: course.topic, knowledgePoints: points, facts });
  try {
    const raw = await ask(system, prompt);
    const draft = draftSchema.parse(
      JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()),
    );
    const usable = draft.questions.filter(
      (q) => new Set(q.options.map((o) => o.trim())).size === 4,
    );
    if (!usable.length) return teaching;
    const content: GeneratedQuizContent = {
      questions: usable.map((q, i) => ({
        id: `concept-${i + 1}`,
        type: 'single' as const,
        question: q.question,
        options: q.options.map((label, j) => ({ value: LETTERS[j], label })),
        answer: [q.answer],
        analysis: q.analysis,
        hasAnswer: true,
        points: 1,
      })),
    };
    const outline: SceneOutline = {
      id: 'concept-questions',
      type: 'quiz',
      title: course.topic,
      description: course.topic,
      keyPoints: course.lessonPlan.knowledgePoints,
      order: 0,
    };
    const reviewed = await reviewQuizContent(
      content,
      outline,
      course.topic,
      languageDirective,
      ask,
      {
        deterministic: false,
      },
    );
    const concept: TeachingQuestion[] = [];
    for (const q of reviewed.questions) {
      const labels = (q.options ?? []).map((o) => o.label.trim());
      const answer = q.answer?.[0];
      const index = (q.options ?? []).findIndex((o) => o.value === answer);
      if (
        q.type !== 'single' ||
        labels.length !== 4 ||
        new Set(labels).size !== 4 ||
        index < 0 ||
        !q.analysis?.trim()
      )
        continue;
      concept.push({
        question: q.question,
        options: labels,
        answer: LETTERS[index],
        analysis: q.analysis,
      });
    }
    if (!concept.length) return teaching;
    // Computed question and step question (their answers come from execution).
    const verified = [teaching.questions[0], teaching.questions[2] ?? teaching.questions[1]].filter(
      (q): q is TeachingQuestion => !!q,
    );
    const questions = [...concept, ...verified].slice(0, 6);
    return questions.length >= 3 ? { ...teaching, questions } : teaching;
  } catch (error) {
    log?.warn(
      'Concept questions for the Lab quiz were not usable; keeping the verified questions:',
      error,
    );
    return teaching;
  }
}
