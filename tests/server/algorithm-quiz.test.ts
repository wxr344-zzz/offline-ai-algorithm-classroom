import { expect, it } from 'vitest';
import snapshots from '@/lib/server/generation/steps/algorithm-quiz-snapshots.generated.json';
import { deterministicAlgorithmQuiz } from '@/lib/server/generation/steps/algorithm-quiz';
import type { GeneratedQuizContent, SceneOutline } from '@/lib/types/generation';

const content: GeneratedQuizContent = {
  questions: [0, 1].map((i) => ({
    id: `q${i}`,
    type: 'single',
    question: 'Incorrect draft',
    answer: ['Z'],
    analysis: 'Incorrect analysis',
    points: 5,
  })),
};
const outline = (title: string): SceneOutline => ({
  id: 'quiz',
  type: 'quiz',
  title,
  description: title,
  keyPoints: [],
  order: 0,
});

const ids = (snapshots as unknown as Array<{ id: string }>).map((entry) => entry.id);
it.each(ids)('uses maintained execution samples for %s, or defers to independent review', (id) => {
  const result = deterministicAlgorithmQuiz(content, outline(id), id, '简体中文');
  // Too few distinct verifiable facts: the caller falls back to independent review.
  if (!result) return;
  expect(result.questions).toHaveLength(2);
  for (const [index, q] of result.questions.entries()) {
    expect(q.id).toBe(`q${index}`);
    expect(q.points).toBe(5);
    expect(q.answer).toHaveLength(1);
    expect(q.options?.filter((option) => q.answer?.includes(option.value))).toHaveLength(1);
    expect(new Set(q.options?.map((option) => option.label)).size).toBe(q.options?.length);
    expect(q.question).not.toContain('Incorrect');
    expect(q.analysis).not.toContain('Incorrect');
    // Questions name what the simulator shows, never raw JSON paths or snapshot internals.
    expect(q.question).not.toMatch(/执行快照|\.(?:values|rows|groups|nodes|state)\b|\[\d+\]的值/);
  }
});

it('covers most maintained algorithms deterministically', () => {
  const covered = ids.filter((id) =>
    deterministicAlgorithmQuiz(content, outline(id), id, '简体中文'),
  );
  expect(covered.length).toBeGreaterThanOrEqual(65);
});

it('asks about the cell a DP step just computed, not the fixed [0][0] boundary', () => {
  const four = { questions: [0, 1, 2, 3].map((i) => ({ ...content.questions[0], id: `q${i}` })) };
  const result = deterministicAlgorithmQuiz(
    four,
    outline('knapsack-01'),
    'knapsack-01',
    '简体中文',
  );
  const steps = result!.questions.slice(1).map((q) => q.question);
  expect(steps.some((q) => /第 \d+ 行第 \d+ 列刚算出的值/.test(q))).toBe(true);
  expect(new Set(steps).size).toBe(steps.length);
});

it('keeps English lesson text and never inherits answers for an unfamiliar variant', () => {
  const result = deterministicAlgorithmQuiz(
    content,
    outline('Binary Search Quiz'),
    'Explain binary search, theory only',
    'Teach in locale en-US',
  );
  expect(result?.questions[0].question).toContain('Run Binary Search');
  expect(result?.questions[0].question).not.toMatch(/[\u4e00-\u9fff]/);
  expect(result?.questions[1].question).toContain('pointer mid');
  expect(result?.questions[1].question).not.toMatch(/[\u4e00-\u9fff]/);
  // [1,3,5,7,9,11] searching 7: mid 2 → 4 → 3; the selected step is the second comparison.
  expect(
    result?.questions[1].options?.find((o) => result.questions[1].answer?.includes(o.value))?.label,
  ).toBe('4');
  expect(
    deterministicAlgorithmQuiz(content, outline('Binary Search Quiz'), 'binary search', '繁體中文'),
  ).toBeUndefined();
  expect(
    deterministicAlgorithmQuiz(
      content,
      outline('Bidirectional Binary Search Quiz'),
      'Explain bidirectional binary search',
      'Teach in locale en-US',
    ),
  ).toBeUndefined();
});
