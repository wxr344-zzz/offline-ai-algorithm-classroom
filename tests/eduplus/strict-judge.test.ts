import { describe, expect, it, vi } from 'vitest';
import fixture from '@/contracts/examples/public-lab.json';
import type { PublicProblem } from '@/lib/types/eduplus.generated';
import { compareOutput } from '@/lib/eduplus/answer-verifier';
import { BrowserPracticeRunner } from '@/lib/eduplus/practice-runner';

const base = fixture.scenes[0].problem as PublicProblem;
describe('Strict Judge Mode', () => {
  it('marks a JSON-serializable return of the wrong type as Wrong Answer', async () => {
    let emit!: (message: unknown) => void;
    const runner = new BrowserPracticeRunner((listener) => {
      emit = listener;
      return { send() {}, dispose() {} };
    });
    const running = runner.run('# code', base, () => {});
    emit({ type: 'ready' });
    emit({
      type: 'result',
      result: {
        cases: [{ caseId: base.publicTestCases[0].caseId, passed: true, actual: { wrong: 6 } }],
        output: '',
      },
    });
    expect((await running).cases[0]).toMatchObject({ passed: false, verdict: 'Wrong Answer' });
  });
  it('compares nested JSON structurally, preserving array order and primitive types', () => {
    expect(
      compareOutput('{"b":[true,null,{"x":2}],"a":1}\n', '{"a":1,"b":[true,null,{"x":2}]}', true),
    ).toBe(true);
    for (const [actual, expected] of [
      ['[1,2]', '[2,1]'],
      ['true', '1'],
      ['"1"', '1'],
      ['null', '"null"'],
      ['{"x":1}', '{"x":1,"y":2}'],
      ['debug\n[1]', '[1]'],
      ['NaN', '1'],
    ])
      expect(compareOutput(actual, expected, true)).toBe(false);
    expect(compareOutput('x  \r\ny\t\r\n\r\n', 'x\ny\n', true)).toBe(true);
    expect(compareOutput(' x\ny', 'x\ny', true)).toBe(false);
    expect(compareOutput('1', 1)).toBe(false);
    expect(compareOutput(true, 1)).toBe(false);
    expect(compareOutput({ a: [1, 'x'], b: null }, { b: null, a: [1, 'x'] })).toBe(true);
  });

  it('keeps evaluating after WA, RE and a timed-out case, without trusting worker passed flags', async () => {
    vi.useFakeTimers();
    let emit!: (message: unknown) => void;
    const dispose = vi.fn();
    const runner = new BrowserPracticeRunner((listener) => {
      emit = listener;
      return { send() {}, dispose };
    });
    const tests = [0, 1, 2, 3].map((i) => ({
      caseId: String(i),
      inputs: { nums: [i] },
      expected: i,
      description: String(i),
    }));
    const running = runner.run('# code', { ...base, publicTestCases: tests }, () => {});
    try {
      emit({ type: 'ready' });
      emit({
        type: 'result',
        result: { cases: [{ caseId: '0', actual: 99, passed: true }], output: '' },
      });
      await Promise.resolve();
      emit({ type: 'ready' });
      emit({
        type: 'result',
        result: { cases: [{ caseId: '1', error: 'ZeroDivisionError', passed: true }], output: '' },
      });
      await Promise.resolve();
      emit({ type: 'ready' });
      await vi.advanceTimersByTimeAsync(base.executionPolicy.timeoutMs);
      emit({ type: 'ready' });
      emit({
        type: 'result',
        result: { cases: [{ caseId: '3', actual: 3, passed: false }], output: '' },
      });
      const result = await running;
      expect(result.cases.map((item) => item.verdict)).toEqual([
        'Wrong Answer',
        'Runtime Error',
        'Time Limit Exceeded',
        'Accepted',
      ]);
      expect(result.cases.filter((item) => item.passed)).toHaveLength(1);
      expect(dispose).toHaveBeenCalledTimes(4);
    } finally {
      runner.cancel();
      vi.useRealTimers();
    }
  });
});
