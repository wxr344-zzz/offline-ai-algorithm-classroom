import { describe, expect, it } from 'vitest';
import course from '@/contracts/examples/public-lab.json';
import { makeDebugProblem } from '@/lib/eduplus/practice-runner';
import type { PublicProblem } from '@/lib/types/eduplus.generated';
const problem = course.scenes[0].problem as PublicProblem;
describe('strict custom input', () => {
  it('passes input verbatim, reuses built-in answers and requires expected outputs for unseen cases', () => {
    const stdio: PublicProblem = {
      ...problem,
      executionMode: 'stdio',
      entryPoint: {
        className: 'Solution',
        methodName: 'solve',
        parameters: [{ name: 'stdin', type: 'str' }],
        returnType: 'str',
      },
      publicTestCases: [
        { caseId: 'example', description: '示例', inputs: { stdin: '2 7\n' }, expected: '9' },
      ],
    };
    expect(makeDebugProblem(stdio, '2 7\n').publicTestCases[0]).toMatchObject({
      inputs: { stdin: '2 7\n' },
      expected: '9',
    });
    expect(() => makeDebugProblem(stdio, '3 8\n')).toThrow('内置标准答案');
    expect(makeDebugProblem(stdio, '3 8\n', '11').publicTestCases[0].expected).toBe('11');
    expect(() => makeDebugProblem(stdio, 'x'.repeat(12001))).toThrow();
  });
  it('uses the same signature, policy and version without changing public cases', () => {
    const original = JSON.stringify(problem.publicTestCases);
    const debug = makeDebugProblem(problem, JSON.stringify(problem.publicTestCases[0].inputs));
    expect(debug.entryPoint).toBe(problem.entryPoint);
    expect(debug.executionPolicy).toBe(problem.executionPolicy);
    expect(debug.problemVersion).toBe(problem.problemVersion);
    expect(debug.publicTestCases).toHaveLength(1);
    expect(debug.publicTestCases[0].caseId).toBe('custom-debug');
    expect(JSON.stringify(problem.publicTestCases)).toBe(original);
  });
  it('rejects malformed JSON, unexpected parameters and wrong types before initializing Python', () => {
    for (const text of ['{', 'null', '[]', '{}', '{"extra":1}', '{"nums":true}', ' '.repeat(12001)])
      expect(() => makeDebugProblem(problem, text)).toThrow();
    const integers = {
      ...problem,
      entryPoint: { ...problem.entryPoint, parameters: [{ name: 'a', type: 'int' as const }] },
    };
    expect(() => makeDebugProblem(integers, '{"a":9007199254740992}')).toThrow('安全整数');
    expect(() => makeDebugProblem(integers, '{"a":true}')).toThrow('int');
  });
});
