import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '@/contracts/examples/public-lab.json';
import { BrowserPracticeRunner, type PracticeTransport } from '@/lib/eduplus/practice-runner';
import type { PublicProblem } from '@/lib/types/eduplus.generated';
const problem = fixture.scenes[0].problem as PublicProblem;
let emit: (message: unknown) => void;
let transport: PracticeTransport;
let runner: BrowserPracticeRunner;
beforeEach(() => {
  vi.useFakeTimers();
  transport = { send: vi.fn(), dispose: vi.fn() };
  runner = new BrowserPracticeRunner((listener) => {
    emit = listener;
    return transport;
  });
});
afterEach(() => {
  runner.cancel();
  vi.useRealTimers();
});
function goodResult() {
  return {
    cases: problem.publicTestCases.map((item) => ({
      caseId: item.caseId,
      passed: true,
      actual: item.expected,
    })),
    output: 'hello',
  };
}
describe('practice lifecycle', () => {
  it('executes one custom input without asserting it against a fabricated expected value', async () => {
    const custom = {
      ...problem,
      publicTestCases: [
        {
          caseId: 'custom-debug',
          description: 'custom',
          inputs: problem.publicTestCases[0].inputs,
          expected: null,
        },
      ],
    };
    const running = runner.run('# custom', custom, vi.fn(), false);
    emit({ type: 'ready' });
    emit({
      type: 'result',
      result: { cases: [{ caseId: 'custom-debug', passed: true, actual: 12345 }], output: '' },
    });
    const result = await running;
    expect(result.cases[0]).toMatchObject({
      caseId: 'custom-debug',
      actual: 12345,
      verified: false,
    });
    expect(result.cases[0].verdict).toBeUndefined();
    expect(transport.send).toHaveBeenCalledTimes(1);
  });
  it('loads once and resolves only matching case results', async () => {
    const status = vi.fn();
    const running = runner.run('# code', problem, status);
    emit({ type: 'ready' });
    emit({ type: 'ready' });
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ cases: problem.publicTestCases }),
      }),
    );
    emit({ type: 'result', result: goodResult() });
    expect(await running).toEqual({
      ...goodResult(),
      cases: goodResult().cases.map((item) => ({
        ...item,
        passed: true,
        verified: true,
        verdict: 'Accepted',
      })),
    });
    expect(status.mock.calls.map(([value]) => value)).toEqual(['loading', 'running']);
    expect(transport.dispose).toHaveBeenCalledOnce();
  });
  it('terminates initialization and execution on separate time budgets', async () => {
    const first = runner.run('# code', problem, vi.fn());
    const checkFirst = expect(first).rejects.toThrow('初始化超时');
    await vi.advanceTimersByTimeAsync(90000);
    await checkFirst;
    const next = runner.run('while True: pass', problem, vi.fn());
    const checkNext = expect(next).resolves.toMatchObject({
      cases: [{ passed: false, verdict: 'Time Limit Exceeded' }],
    });
    emit({ type: 'ready' });
    // No 'running' message is required to arm the execution deadline.
    await vi.advanceTimersByTimeAsync(problem.executionPolicy.timeoutMs);
    await checkNext;
    expect(transport.dispose).toHaveBeenCalledTimes(2);
  });
  it('cancels and discards late events from an older epoch', async () => {
    const previous = runner.run('# first', problem, vi.fn());
    const previousCheck = expect(previous).rejects.toMatchObject({ name: 'AbortError' });
    const oldEmit = emit;
    const next = runner.run('# next', problem, vi.fn());
    await previousCheck;
    oldEmit({ type: 'ready' });
    oldEmit({ type: 'result', result: goodResult() });
    expect(transport.send).not.toHaveBeenCalled();
    emit({ type: 'ready' });
    emit({ type: 'result', result: goodResult() });
    expect(await next).toEqual({
      ...goodResult(),
      cases: goodResult().cases.map((item) => ({
        ...item,
        passed: true,
        verified: true,
        verdict: 'Accepted',
      })),
    });
  });
  it('handles worker errors and refuses malformed or foreign case results', async () => {
    const fail = runner.run('# code', problem, vi.fn());
    emit({ type: 'error', message: 'missing wasm' });
    await expect(fail).rejects.toThrow('missing wasm');
    const malformed = runner.run('# code', problem, vi.fn());
    emit({ type: 'ready' });
    emit({ type: 'result', result: { cases: [{ caseId: 'other', passed: true }], output: '' } });
    await expect(malformed).rejects.toThrow('无效结果');
  });
  it('rejects synchronous worker construction failures', async () => {
    const unavailable = new BrowserPracticeRunner(() => {
      throw new Error('blocked');
    });
    await expect(unavailable.run('# code', problem, vi.fn())).rejects.toThrow('blocked');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('refuses circular actual values without throwing out of the message handler', async () => {
    const running = runner.run('# code', problem, vi.fn());
    emit({ type: 'ready' });
    const circular: unknown[] = [];
    circular.push(circular);
    const result = goodResult();
    const malicious = {
      ...result,
      cases: result.cases.map((item) => ({ ...item, actual: circular })),
    };
    expect(() => emit({ type: 'result', result: malicious })).not.toThrow();
    await expect(running).rejects.toThrow('无效结果');
  });
});
