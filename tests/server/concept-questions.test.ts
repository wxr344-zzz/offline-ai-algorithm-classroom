import { expect, it, vi } from 'vitest';
import { withConceptQuestions } from '@/lib/server/generation/steps/concept-questions';
import type { ClassroomTeaching } from '@/lib/types/eduplus-teaching.generated';

const computed = (n: number) => ({
  question: `手算输入 ${n} 的结果是什么？`,
  options: ['[1]', '[2]', '[3]', '[4]'],
  answer: 'A' as const,
  analysis: '由执行得到',
});
const teaching: ClassroomTeaching = {
  overview: '中序遍历依次处理左子树、根、右子树',
  demoExplanation: '逐步观察',
  questions: [computed(1), computed(2), computed(3)],
};
const course = {
  topic: '二叉树中序遍历',
  lessonPlan: { title: '二叉树中序遍历', objectives: [], knowledgePoints: ['左根右'] },
} as never;
const draft = {
  questions: [1, 2, 3].map((n) => ({
    question: `关于中序遍历的说法 ${n}，正确的是？`,
    options: ['左-根-右', '根-左-右', '左-右-根', '按层访问'],
    answer: 'A',
    analysis: '中序遍历先左子树，再根，再右子树',
  })),
};
const reviewed = {
  questions: draft.questions.map((q, i) => ({
    id: `concept-${i + 1}`,
    type: 'single',
    question: q.question,
    options: q.options.map((label, j) => ({ value: 'ABCD'[j], label })),
    answer: ['A'],
    analysis: q.analysis,
    points: 1,
  })),
};

it('puts reviewed concept questions before the computed and step questions', async () => {
  const ask = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(draft))
    .mockResolvedValueOnce(JSON.stringify(reviewed))
    .mockResolvedValueOnce(JSON.stringify({ valid: true, issues: [] }));
  const result = await withConceptQuestions(teaching, course, '全课程使用简体中文', ask);
  expect(result.questions).toHaveLength(5);
  expect(result.questions.slice(0, 3).every((q) => q.question.includes('中序遍历的说法'))).toBe(
    true,
  );
  expect(result.questions[3]).toEqual(teaching.questions[0]);
  expect(result.questions[4]).toEqual(teaching.questions[2]);
  expect(result.questions[0]).toMatchObject({ answer: 'A', options: draft.questions[0]!.options });
});

it('keeps the verified questions when there is no model or the questions fail review', async () => {
  expect(await withConceptQuestions(teaching, course, '', undefined)).toBe(teaching);
  const ask = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(draft))
    .mockResolvedValue(JSON.stringify({ valid: false, issues: ['wrong'] }));
  expect(await withConceptQuestions(teaching, course, '', ask)).toBe(teaching);
});
