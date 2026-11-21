import { expect, it, vi } from 'vitest';
import { reviewQuizContent } from '@/lib/server/generation/steps/quiz-review';
import type { GeneratedQuizContent, SceneOutline } from '@/lib/types/generation';

const outline: SceneOutline = {
  id: 'quiz',
  type: 'quiz',
  title: '分数加法',
  description: '通分后相加',
  keyPoints: ['通分'],
  order: 1,
};
const content: GeneratedQuizContent = {
  questions: [
    {
      id: 'q1',
      type: 'single',
      question: '1/2 + 1/4 = ?',
      options: [
        { value: 'A', label: '3/4' },
        { value: 'B', label: '2/6' },
      ],
      answer: ['B'],
      analysis: 'ORIGINAL_WRONG_EXPLANATION',
      points: 5,
    },
  ],
};
const reviewed = {
  questions: [{ ...content.questions[0], answer: ['A'], analysis: '2/4 + 1/4 = 3/4', points: 99 }],
};
const approved = JSON.stringify({ valid: true, issues: [] });

it('hides the draft answer and explanation and preserves scoring after independent review', async () => {
  const ask = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(reviewed))
    .mockResolvedValueOnce(approved);
  const result = await reviewQuizContent(content, outline, '讲解分数', '简体中文', ask);
  expect(ask.mock.calls[0][1]).not.toContain('ORIGINAL_WRONG_EXPLANATION');
  expect(JSON.parse(ask.mock.calls[0][1]).questions[0]).not.toHaveProperty('answer');
  expect(result.questions[0]).toMatchObject({
    id: 'q1',
    answer: ['A'],
    points: 5,
    hasAnswer: true,
  });
  expect(content.questions[0].answer).toEqual(['B']);
});

it('repairs an invalid answer reference rather than publishing a structurally contradictory quiz', async () => {
  const ask = vi
    .fn()
    .mockResolvedValueOnce(
      JSON.stringify({ questions: [{ ...reviewed.questions[0], answer: ['Z'] }] }),
    )
    .mockResolvedValueOnce(JSON.stringify(reviewed))
    .mockResolvedValueOnce(approved);
  const result = await reviewQuizContent(content, outline, '讲解分数', '简体中文', ask);
  expect(result.questions[0].answer).toEqual(['A']);
  expect(ask).toHaveBeenCalledTimes(3);
  expect(ask.mock.calls[1][1]).toContain('feedback');
});

it('does not publish a rewritten question with a different identity', async () => {
  const ask = vi
    .fn()
    .mockResolvedValue(JSON.stringify({ questions: [{ ...reviewed.questions[0], id: 'other' }] }));
  await expect(reviewQuizContent(content, outline, '讲解分数', '简体中文', ask)).rejects.toThrow(
    '独立复核未通过',
  );
  expect(ask).toHaveBeenCalledTimes(2);
});

it('requires multiple-answer cardinality and never silently interprets a single answer as multiple', async () => {
  const ask = vi
    .fn()
    .mockResolvedValue(
      JSON.stringify({ questions: [{ ...reviewed.questions[0], type: 'multiple' }] }),
    );
  await expect(reviewQuizContent(content, outline, '讲解分数', '简体中文', ask)).rejects.toThrow(
    '独立复核未通过',
  );
});

it('repairs a factual contradiction flagged by the independent examiner, with specific feedback', async () => {
  const ask = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(reviewed))
    .mockResolvedValueOnce(
      JSON.stringify({
        valid: false,
        issues: ['The selected label conflicts with the computed fraction.'],
      }),
    )
    .mockResolvedValueOnce(JSON.stringify(reviewed))
    .mockResolvedValueOnce(approved);
  const result = await reviewQuizContent(content, outline, '讲解分数', '简体中文', ask);
  expect(result.questions[0].answer).toEqual(['A']);
  expect(ask.mock.calls[2][1]).toContain('selected label conflicts');
  expect(ask.mock.calls[1][1]).toContain('2/4 + 1/4 = 3/4');
});

it('never publishes a structurally valid quiz rejected by the examiner twice', async () => {
  const ask = vi
    .fn()
    .mockImplementation(async (system) =>
      system.startsWith('You are an independent examiner')
        ? JSON.stringify({ valid: false, issues: ['The explanation contradicts the answer.'] })
        : JSON.stringify(reviewed),
    );
  await expect(reviewQuizContent(content, outline, '讲解分数', '简体中文', ask)).rejects.toThrow(
    '独立复核未通过',
  );
  expect(ask).toHaveBeenCalledTimes(4);
});

it("an algorithm quiz keeps the model's concept questions and adds one computed question (reported: only input/output questions)", async () => {
  const { algorithmCourseQuiz } = await import('@/lib/server/generation/steps/quiz-review');
  const concept = (id: string) => ({
    id,
    type: 'single' as const,
    question: `快速排序的概念题 ${id}`,
    options: [
      { value: 'A', label: '选取枢轴并划分' },
      { value: 'B', label: '相邻交换' },
    ],
    answer: ['A'],
    analysis: '划分是快速排序的核心',
    points: 1,
  });
  const quiz: GeneratedQuizContent = { questions: [concept('q1'), concept('q2'), concept('q3')] };
  const quick: SceneOutline = { ...outline, title: '快速排序随堂检测', keyPoints: ['划分'] };
  const ask = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify({ questions: quiz.questions.slice(0, 2) }))
    .mockResolvedValueOnce(approved);
  const result = await algorithmCourseQuiz(quiz, quick, '请为我讲解快速排序', '简体中文', ask);
  expect(result.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
  expect(result.questions[0]!.question).toContain('概念题');
  expect(result.questions[2]!.question).toContain('输入');
  // A review that cannot finish keeps the questions as written; never fails the page.
  const failing = vi.fn().mockResolvedValue('not json');
  const kept = await algorithmCourseQuiz(quiz, quick, '请为我讲解快速排序', '简体中文', failing);
  expect(kept.questions.slice(0, 2).map((q) => q.question)).toEqual([
    quiz.questions[0]!.question,
    quiz.questions[1]!.question,
  ]);
  // An ordinary topic has no computed question: the model's questions only.
  const plain = await algorithmCourseQuiz(quiz, outline, '讲解分数', '简体中文', failing);
  expect(plain.questions).toHaveLength(3);
});

it('a single-choice question with several answers becomes multiple choice; duplicate options go', async () => {
  const { consistentChoiceQuestions } = await import('@/lib/server/generation/steps/quiz-review');
  const result = consistentChoiceQuestions({
    questions: [
      {
        id: 'q1',
        type: 'single',
        question: '哪些是牛顿定律？',
        options: [
          { value: 'A', label: '惯性定律' },
          { value: 'B', label: '加速度定律' },
          { value: 'C', label: '惯性定律 ' },
        ],
        answer: ['A', 'B'],
        analysis: 'A、B 都是',
      },
    ],
  });
  expect(result.questions[0]).toMatchObject({ type: 'multiple', answer: ['A', 'B'] });
  expect(result.questions[0]!.options).toHaveLength(2);
});
