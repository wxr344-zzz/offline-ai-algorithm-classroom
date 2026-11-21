import { describe, expect, it } from 'vitest';
import fixture from '@/contracts/examples/public-lab.json';
import type { PublicProblem } from '@/lib/types/eduplus.generated';
import {
  lcsLength,
  verifyAnswer,
  independentExpected,
  hasIndependentChecker,
} from '@/lib/eduplus/answer-verifier';
import { publicAssertions } from '@/lib/eduplus/public-assertions';
import {
  BrowserPracticeRunner,
  formatStdioOutput,
  makeDebugProblem,
} from '@/lib/eduplus/practice-runner';

const base = fixture.scenes[0].problem as PublicProblem;
const lcs: PublicProblem = {
  ...base,
  answerCheck: 'lcs-string',
  entryPoint: {
    className: 'Solution',
    methodName: 'solve',
    parameters: [
      { name: 'str1', type: 'str' },
      { name: 'str2', type: 'str' },
    ],
    returnType: 'str',
  },
};
const stdio: PublicProblem = {
  ...base,
  executionMode: 'stdio',
  answerCheck: 'lcs-edit-budget',
  entryPoint: {
    className: 'Solution',
    methodName: 'solve',
    parameters: [{ name: 'stdin', type: 'str' }],
    returnType: 'str',
  },
};
const input = JSON.stringify({
  planA: ['面向对象', '动态类型', '解释型'],
  planB: ['静态类型', '编译型', '面向对象'],
  budget: 15,
});

describe('independent answer authority', () => {
  it('judges an explicit JSON-string contract by typed values, not formatting', () => {
    const problem: PublicProblem = {
      ...base,
      answerCheck: 'json-value',
      entryPoint: { ...base.entryPoint, returnType: 'str' },
    };
    const expected = '{"order":[1,true],"label":"a "}';
    expect(
      verifyAnswer(problem, {}, '{ "label": "a ", "order": [1, true] }', expected).passed,
    ).toBe(true);
    for (const actual of [
      '{"order":[true,1],"label":"a "}',
      '{"order":[1,1],"label":"a "}',
      '{"order":[1,true],"label":"a"}',
      'not JSON',
    ])
      expect(verifyAnswer(problem, {}, actual, expected).passed).toBe(false);
    expect(verifyAnswer(problem, {}, { order: [1, true], label: 'a ' }, expected).passed).toBe(
      false,
    );
    expect(hasIndependentChecker(problem)).toBe(false);
    expect(() => verifyAnswer(problem, {}, 'NaN', 'NaN')).toThrow('判题协议错误');
    expect(
      verifyAnswer(
        { ...problem, answerCheck: null },
        {},
        '{ "label": "a ", "order": [1, true] }',
        expected,
      ).passed,
    ).toBe(false);
    const assertions = publicAssertions({
      ...problem,
      publicTestCases: [{ caseId: 'x', inputs: {}, expected, description: 'Example' }],
    });
    expect(assertions[0]).toContain('def _same_json_output');
    expect(assertions[0]).toContain('assert _same_json_output');
  });
  it('does not trim meaningful string data inside standard-output JSON', () => {
    expect(
      verifyAnswer({ ...stdio, answerCheck: null }, { stdin: 'x' }, '{"text":"x"}', '{"text":"x "}')
        .passed,
    ).toBe(false);
  });
  it('checks capped substring positions, overlap, Unicode and JSON whitespace independently', () => {
    const capped = { ...stdio, answerCheck: 'capped-matches' as const };
    const input = JSON.stringify({ text: 'hello world', pattern: 'o', scenario_limit: 2 });
    expect(independentExpected(capped, input)).toBe('[4,7]');
    expect(verifyAnswer(capped, { stdin: input }, '[4, 7]\n')).toEqual({
      verified: true,
      passed: true,
    });
    for (const actual of ['[4]', '[4,8]', '[true,7]', '"[4,7]"'])
      expect(verifyAnswer(capped, { stdin: input }, actual).passed).toBe(false);
    expect(
      independentExpected(
        capped,
        JSON.stringify({ text: 'aaaaa', pattern: 'aa', scenario_limit: 3 }),
      ),
    ).toBe('[0,1,2]');
    expect(
      independentExpected(
        capped,
        JSON.stringify({ text: '🙂甲🙂', pattern: '🙂', scenario_limit: 5 }),
      ),
    ).toBe('[0,2]');
    for (const [text, pattern, limit] of [
      ['abc', '', 2],
      ['', 'abc', 2],
      ['abc', 'a', 0],
    ] as const)
      expect(
        independentExpected(capped, JSON.stringify({ text, pattern, scenario_limit: limit })),
      ).toBe('[]');
    expect(() =>
      independentExpected(
        capped,
        JSON.stringify({ text: 'abc', pattern: 'a', scenario_limit: "pattern='x'" }),
      ),
    ).toThrow();
  });
  it('accepts either optimal LCS but rejects invented, short and out-of-order answers', () => {
    const data = { str1: 'AXYT', str2: 'AYZX' };
    for (const answer of ['AX', 'AY'])
      expect(verifyAnswer(lcs, data, answer)).toEqual({ verified: true, passed: true });
    for (const answer of ['AYZ', 'A', 'XA', ''])
      expect(verifyAnswer(lcs, data, answer)).toEqual({ verified: true, passed: false });
    expect(verifyAnswer(lcs, { str1: '甲🙂乙', str2: '🙂甲乙' }, '🙂乙').passed).toBe(true);
    expect(verifyAnswer(lcs, { str1: '', str2: 'abc' }, '').passed).toBe(true);
    expect(verifyAnswer(lcs, { str1: 'aaaa', str2: 'aa' }, 'aaa').passed).toBe(false);
  });
  it('uses built-in expected answers for generic strict judgements', () => {
    const unknown = {
      ...stdio,
      answerCheck: null,
      publicTestCases: [
        { caseId: 'x', description: 'expected', inputs: { stdin: input }, expected: '[1,2]' },
      ],
    };
    expect(makeDebugProblem(unknown, input).publicTestCases[0].expected).toBe('[1,2]');
    expect(verifyAnswer(unknown, { stdin: input }, '[1, 2]\n').passed).toBe(true);
    expect(verifyAnswer(unknown, { stdin: input }, '[1]').passed).toBe(false);
    expect(() => makeDebugProblem(unknown, '{}')).toThrow('内置标准答案');
    expect(makeDebugProblem(unknown, '{}', '').publicTestCases[0].expected).toBe('');
    expect(
      formatStdioOutput(unknown, input, {
        cases: [{ caseId: 'x', passed: false, actual: 'valid output' }],
        output: '',
      }),
    ).toContain('答案错误');
  });
  it('recomputes edit costs and rejects ambiguous inputs without eval', () => {
    expect(independentExpected(stdio, input)).toBe('YES 4');
    expect(independentExpected(stdio, JSON.stringify({ ...JSON.parse(input), budget: 3 }))).toBe(
      'NO 4',
    );
    expect(independentExpected(stdio, '{"planA":[],"planB":[],"budget":0}')).toBe('YES 0');
    for (const text of [
      'null',
      '[]',
      '{}',
      '{"planA":"[1]","planB":[],"budget":1}',
      '{"planA":[],"planB":[],"budget":true}',
      '{"planA":[],"planB":[],"budget":0,"extra":1}',
    ])
      expect(() => independentExpected(stdio, text)).toThrow();
  });
  it('overrides a worker verdict and hallucinated expected string with a property check', async () => {
    let emit!: (data: unknown) => void;
    const runner = new BrowserPracticeRunner((listener) => {
      emit = listener;
      return { send() {}, dispose() {} };
    });
    const problem = {
      ...lcs,
      publicTestCases: [
        {
          caseId: 'x',
          inputs: { str1: 'AXYT', str2: 'AYZX' },
          expected: 'AYZ',
          description: 'bad expected',
        },
      ],
    };
    const running = runner.run('#code', problem, () => {});
    emit({ type: 'ready' });
    emit({
      type: 'result',
      result: { cases: [{ caseId: 'x', passed: false, actual: 'AX' }], output: '' },
    });
    expect((await running).cases[0]).toEqual({
      caseId: 'x',
      passed: true,
      verified: true,
      actual: 'AX',
      verdict: 'Accepted',
    });
  });
  it('does not leave an unhandled callback or hang when a checker rejects the input', async () => {
    let emit!: (data: unknown) => void;
    const runner = new BrowserPracticeRunner((listener) => {
      emit = listener;
      return { send() {}, dispose() {} };
    });
    const running = runner.run(
      '#code',
      {
        ...lcs,
        publicTestCases: [
          {
            caseId: 'x',
            inputs: { str1: 'x'.repeat(1001), str2: 'x' },
            expected: 'x',
            description: 'over limit',
          },
        ],
      },
      () => {},
    );
    emit({ type: 'ready' });
    expect(() =>
      emit({
        type: 'result',
        result: { cases: [{ caseId: 'x', passed: true, actual: 'x' }], output: '' },
      }),
    ).not.toThrow();
    await expect(running).rejects.toThrow('1000');
  });
  it('keeps repeated-element lengths and memory bounds correct', () => {
    expect(lcsLength(['a', 'b', 'a'], ['b', 'a'])).toBe(2);
    expect(() => lcsLength(new Array(1001).fill('a'), new Array(1001).fill('a'))).toThrow();
  });
});
