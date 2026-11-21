import { describe, expect, it } from 'vitest';
import { stdioExpected } from '@/lib/eduplus/stdio-oracle';
import { formatStdioOutput, makeDebugProblem } from '@/lib/eduplus/practice-runner';
import fixture from '@/contracts/examples/public-lab.json';
import type { PublicProblem } from '@/lib/types/eduplus.generated';

const problem: PublicProblem = {
  ...(fixture.scenes[0].problem as PublicProblem),
  executionMode: 'stdio',
  standardIoProfile: 'budget-pair',
  publicTestCases: [],
};
describe('standard I/O practice', () => {
  it('checks delivery deadlines on directed roads, equality, zero weights and source exclusion', () => {
    expect(stdioExpected('delivery-deadline', '5 4 0 6\n0 1 4\n1 2 2\n2 3 1\n3 4 1')).toBe('2');
    expect(stdioExpected('delivery-deadline', '3 2 0 3\n0 1 0\n1 2 3')).toBe('2');
    expect(stdioExpected('delivery-deadline', '1 0 0 0')).toBe('0');
    expect(stdioExpected('delivery-deadline', '3 1 2 99\n0 1 2')).toBe('0');
    expect(() => stdioExpected('delivery-deadline', '2 1 0 3\n0 1 -1')).toThrow();
  });
  it('checks unseen custom inputs rather than only published examples', () => {
    const input = '5 13\n2 4 6 8 10\n';
    expect(makeDebugProblem(problem, input).publicTestCases[0].expected).toBe('12');
    const output = formatStdioOutput(problem, input, {
      cases: [{ caseId: 'custom-debug', passed: false, actual: '14\n' }],
      output: '',
    });
    expect(output).toContain('答案错误');
    expect(output).toContain('12');
    expect(
      formatStdioOutput(problem, input, {
        cases: [{ caseId: 'custom-debug', passed: true, actual: '12\n' }],
        output: '',
      }),
    ).toBe('12\n');
  });
  it('agrees with exhaustive pair enumeration including duplicates and empty inputs', () => {
    for (const prices of [[], [0], [6, 6, 3], [2, 7, 11, 15], [1, 2, 3, 4, 5]])
      for (let budget = 0; budget <= 18; budget++) {
        const choices = [0, ...prices];
        for (let i = 0; i < prices.length; i++)
          for (let j = i + 1; j < prices.length; j++) choices.push(prices[i] + prices[j]);
        const answer = Math.max(...choices.filter((value) => value <= budget));
        expect(
          stdioExpected('budget-pair', `${prices.length} ${budget}\n${prices.join(' ')}\n`),
        ).toBe(String(answer));
      }
  });
  it('covers all tree traversal branches and 0/1 capacity semantics', () => {
    expect(stdioExpected('tree-traversals', '5\n1 2 3 null 4')).toBe('1 2 4 3\n2 4 1 3\n4 2 3 1');
    expect(stdioExpected('tree-traversals', '0\n')).toBe('\n\n');
    expect(stdioExpected('knapsack', '3 5\n2 3\n3 4\n4 5')).toBe('7');
    expect(stdioExpected('knapsack', '1 10\n2 3')).toBe('3'); // Cannot choose one item repeatedly.
    expect(stdioExpected('knapsack', '0 0')).toBe('0');
  });
  it('rejects malformed and excessive inputs before starting Python', () => {
    for (const text of ['', '2 10\n1', '2 10\n-1 2', '1 NaN\n2', '10001 10'])
      expect(() => stdioExpected('budget-pair', text)).toThrow();
    expect(() => stdioExpected('tree-traversals', '4\n1 null 3 4')).toThrow();
    expect(() => stdioExpected('knapsack', '1 1001\n2 3')).toThrow();
    expect(stdioExpected(null, 'arbitrary')).toBeNull();
  });
  it('minimizes weight with overshooting, impossible targets and single-use items', () => {
    expect(stdioExpected('knapsack-minweight', '3 7\n2 3\n3 4\n4 5')).toBe('5');
    expect(stdioExpected('knapsack-minweight', '1 4\n2 3')).toBe('-1');
    expect(stdioExpected('knapsack-minweight', '1 4\n2 6')).toBe('2');
    expect(stdioExpected('knapsack-minweight', '0 0')).toBe('0');
    expect(() => stdioExpected('knapsack-minweight', '1 2\n1 101')).toThrow();
  });
});
