import { expect, it } from 'vitest';
import { insertionTrace } from '@/lib/eduplus/insertion-trace';
it('preserves duplicates and every unprocessed element at each insertion', () => {
  const course = {
    topic: '插入排序算法',
    scenes: [{ problem: { entryPoint: { parameters: [{ name: 'nums' }] } } }],
  } as never;
  for (const nums of [[3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5], [], [2], [4, 3, 2, 1], [0, -1, -1]]) {
    const result = insertionTrace(course, { nums })!;
    expect(result.outcome).toEqual([...nums].sort((a, b) => a - b));
    if (nums.length)
      for (const step of result.steps)
        expect(step.values.map(Number).sort((a, b) => a - b)).toEqual(
          [...nums].sort((a, b) => a - b),
        );
  }
});
