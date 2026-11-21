import type { PublicProblem } from '@/lib/types/eduplus.generated';
import type { PracticeResult } from '@/lib/types/eduplus-practice';
import { deepEqual, independentExpected, verifyAnswer } from './answer-verifier';

export interface PracticeTransport {
  send(message: unknown): void;
  dispose(): void;
}
export type TransportFactory = (onMessage: (message: unknown) => void) => PracticeTransport;
export function formatStdioOutput(
  problem: PublicProblem,
  input: string,
  result: PracticeResult | null,
  error = '',
  executionOnly = false,
): string {
  if (error) return error;
  const item = result?.cases[0];
  if (!item) return '';
  if (item.error) return `${item.verdict ?? 'Runtime Error'}：${item.error}`;
  const actual = String(item.actual ?? '');
  if (executionOnly) return actual;
  const expected =
    independentExpected(problem, input) ??
    problem.publicTestCases.find((test) => deepEqual(test.inputs, { stdin: input }))?.expected;
  if (!item.passed)
    return `答案错误：实际输出与预期不一致。\n实际输出：\n${actual}\n预期输出：\n${expected}`;
  return actual;
}
/** Custom tests need an oracle, a matching built-in test, or an explicit expected answer. */
export function makeDebugProblem(
  problem: PublicProblem,
  text: string,
  expectedText?: string,
  executionOnly = false,
): PublicProblem {
  if (text.length > 12000) throw new Error('自定义输入不能超过 12000 个字符。');
  if (problem.executionMode === 'stdio') {
    return {
      ...problem,
      publicTestCases: [
        {
          caseId: 'custom-debug',
          description: '标准输入调试',
          inputs: { stdin: text },
          expected: executionOnly ? null : customExpected(problem, { stdin: text }, expectedText),
        },
      ],
    };
  }
  let inputs: unknown;
  try {
    inputs = JSON.parse(text);
  } catch {
    throw new Error('自定义输入必须是有效的 JSON 对象。');
  }
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs))
    throw new Error('请按参数名提供 JSON 对象，例如 {"a":12,"b":15}。');
  const keys = Object.keys(inputs);
  const parameters = problem.entryPoint.parameters;
  if (
    keys.length !== parameters.length ||
    keys.some((key) => !parameters.some((parameter) => parameter.name === key))
  )
    throw new Error(
      `输入参数必须为：${parameters.map((parameter) => parameter.name).join('、')}。`,
    );
  for (const parameter of parameters)
    if (!validActual((inputs as Record<string, unknown>)[parameter.name], parameter.type, 12000))
      throw new Error(
        `参数 ${parameter.name} 必须符合 ${parameter.type}，整数应在安全整数范围内。`,
      );
  return {
    ...problem,
    publicTestCases: [
      {
        caseId: 'custom-debug',
        description: '自定义调试',
        inputs: inputs as Record<string, import('@/lib/types/eduplus.generated').JsonValue>,
        expected: executionOnly
          ? null
          : customExpected(
              problem,
              inputs as Record<string, import('@/lib/types/eduplus.generated').JsonValue>,
              expectedText,
            ),
      },
    ],
  };
}
function customExpected(
  problem: PublicProblem,
  inputs: Record<string, import('@/lib/types/eduplus.generated').JsonValue>,
  text?: string,
) {
  if (typeof inputs.stdin === 'string') {
    const value = independentExpected(problem, inputs.stdin);
    if (value !== null) return value;
  }
  const known = problem.publicTestCases.find((test) => deepEqual(test.inputs, inputs));
  if (known) return known.expected;
  if (text === undefined)
    throw new Error('自定义输入没有内置标准答案或可用的校验器，请使用内置样例。');
  if (problem.executionMode === 'stdio') return text;
  try {
    return JSON.parse(text) as import('@/lib/types/eduplus.generated').JsonValue;
  } catch {
    throw new Error('函数预期返回值必须填写有效 JSON，字符串需要双引号。');
  }
}
function validActual(value: unknown, kind: string, limit: number): boolean {
  if (kind === 'int') return typeof value === 'number' && Number.isSafeInteger(value);
  if (kind === 'bool') return typeof value === 'boolean';
  if (kind === 'str') return typeof value === 'string' && value.length <= limit;
  if (kind.startsWith('list['))
    return (
      Array.isArray(value) &&
      value.length <= limit &&
      value.every((item) => validActual(item, kind.slice(5, -1), limit))
    );
  return false;
}
function validTransportValue(value: unknown, limit: number, depth = 0): boolean {
  if (depth > 20) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number')
    return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
  if (typeof value === 'string') return value.length <= limit;
  if (Array.isArray(value))
    return (
      value.length <= limit && value.every((item) => validTransportValue(item, limit, depth + 1))
    );
  if (value && typeof value === 'object')
    return (
      Object.keys(value).length <= limit &&
      Object.values(value).every((item) => validTransportValue(item, limit, depth + 1))
    );
  return false;
}
export function createFrameTransport(onMessage: (message: unknown) => void): PracticeTransport {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = '隔离 Python 运行环境';
  frame.sandbox.add('allow-scripts');
  const channel = new MessageChannel();
  let disposed = false;
  let connected = false;
  channel.port1.onmessage = ({ data }) => onMessage(data);
  channel.port1.start();
  // iframe.load is not a readiness handshake: the initial about:blank load
  // can consume the transferable port before the runtime installs its listener.
  const connect = (event: MessageEvent) => {
    if (
      disposed ||
      connected ||
      event.source !== frame.contentWindow ||
      event.data?.type !== 'eduplus-runtime-awaiting-port'
    )
      return;
    connected = true;
    try {
      frame.contentWindow?.postMessage({ type: 'connect' }, '*', [channel.port2]);
    } catch {
      onMessage({ type: 'error', message: '运行环境通信初始化失败，请重试。' });
    }
  };
  window.addEventListener('message', connect);
  frame.onerror = () => onMessage({ type: 'error', message: '运行环境加载失败。' });
  frame.src = '/api/eduplus/runtime';
  document.body.appendChild(frame);
  return {
    send: (message) => channel.port1.postMessage(message),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('message', connect);
      channel.port1.postMessage({ type: 'dispose' });
      channel.port1.close();
      channel.port2.close();
      frame.remove(); // Removing the frame also tears down its worker and opaque storage context.
    },
  };
}

/** One fresh worker per run. Generation counter rejects events from cancelled/old executions. */
export class BrowserPracticeRunner {
  private epoch = 0;
  private cleanup?: () => void;
  constructor(private readonly createTransport: TransportFactory = createFrameTransport) {}
  cancel(): void {
    this.epoch++;
    this.cleanup?.();
  }
  async run(
    code: string,
    problem: PublicProblem,
    onStatus: (status: 'loading' | 'running') => void,
    judge = true,
  ): Promise<PracticeResult> {
    this.cancel();
    const epoch = this.epoch;
    const cases: PracticeResult['cases'] = [];
    let output = '';
    for (const test of problem.publicTestCases) {
      if (epoch !== this.epoch) throw new DOMException('运行已停止', 'AbortError');
      const result = await this.runCase(
        code,
        { ...problem, publicTestCases: [test] },
        onStatus,
        epoch,
        judge,
      );
      cases.push(...result.cases);
      output = (output + result.output).slice(0, problem.executionPolicy.maxOutputChars);
    }
    return { cases, output };
  }
  private runCase(
    code: string,
    problem: PublicProblem,
    onStatus: (status: 'loading' | 'running') => void,
    epoch: number,
    judge: boolean,
  ): Promise<PracticeResult> {
    onStatus('loading');
    return new Promise((resolve, reject) => {
      let transport: PracticeTransport | undefined;
      let settled = false;
      let started = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: Error, result?: PracticeResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        transport?.dispose();
        if (this.cleanup === cancel) this.cleanup = undefined;
        if (error) reject(error);
        else resolve(result!);
      };
      const cancel = () => finish(new DOMException('运行已停止', 'AbortError'));
      this.cleanup = cancel;
      timer = setTimeout(
        () => finish(new Error('Python 初始化超时，请检查本地运行资源后重试。')),
        90000,
      );
      try {
        transport = this.createTransport((unknownMessage) => {
          if (
            epoch !== this.epoch ||
            settled ||
            !unknownMessage ||
            typeof unknownMessage !== 'object'
          )
            return;
          const message = unknownMessage as Record<string, unknown>;
          if (message.type === 'ready' && !started) {
            started = true;
            clearTimeout(timer);
            onStatus('running');
            // Start the budget before handing over code; a forged/missing 'running' event cannot disable it.
            timer = setTimeout(
              () =>
                finish(undefined, {
                  cases: problem.publicTestCases.map((test) => ({
                    caseId: test.caseId,
                    passed: false,
                    verified: true,
                    verdict: 'Time Limit Exceeded',
                    error: `Time Limit Exceeded：运行超过 ${problem.executionPolicy.timeoutMs} 毫秒，已终止。`,
                  })),
                  output: '',
                }),
              problem.executionPolicy.timeoutMs,
            );
            transport?.send({
              type: 'run',
              payload: {
                code,
                entry: problem.entryPoint,
                mode: problem.executionMode ?? 'function',
                cases: problem.publicTestCases,
                limit: problem.executionPolicy.maxOutputChars,
              },
            });
          } else if (message.type === 'result' && started) {
            const result = message.result as PracticeResult | undefined;
            if (
              !result ||
              !Array.isArray(result.cases) ||
              typeof result.output !== 'string' ||
              result.cases.length !== problem.publicTestCases.length ||
              result.cases.some(
                (item, index) =>
                  !item ||
                  item.caseId !== problem.publicTestCases[index].caseId ||
                  typeof item.passed !== 'boolean' ||
                  (item.error !== undefined
                    ? typeof item.error !== 'string' || item.error.length > 2000
                    : !validTransportValue(item.actual, problem.executionPolicy.maxOutputChars)),
              )
            )
              finish(new Error('运行环境返回了无效结果。'));
            else {
              try {
                // Whitelist fields before serializing: a worker may send circular/extra properties.
                const safe = {
                  cases: result.cases.map((item, index) => ({
                    caseId: item.caseId,
                    ...(item.error !== undefined
                      ? { passed: false, verified: true, verdict: 'Runtime Error' as const }
                      : (() => {
                          if (!judge) return { passed: false, verified: false };
                          const judgement = verifyAnswer(
                            problem,
                            problem.publicTestCases[index].inputs,
                            item.actual!,
                            problem.publicTestCases[index].expected,
                          );
                          return {
                            ...judgement,
                            verdict: judgement.passed
                              ? ('Accepted' as const)
                              : ('Wrong Answer' as const),
                          };
                        })()),
                    ...(item.error !== undefined ? { error: item.error } : { actual: item.actual }),
                  })),
                  output: result.output.slice(0, problem.executionPolicy.maxOutputChars + 20),
                };
                if (JSON.stringify(safe).length > 250000)
                  finish(new Error('运行结果超出显示上限。'));
                else finish(undefined, safe);
              } catch (error) {
                finish(error instanceof Error ? error : new Error('独立判题器无法验证该输入。'));
              }
            }
          } else if (message.type === 'error') {
            if (started)
              finish(undefined, {
                cases: problem.publicTestCases.map((test) => ({
                  caseId: test.caseId,
                  passed: false,
                  verified: true,
                  verdict: 'Runtime Error',
                  error: String(message.message ?? '运行失败。').slice(0, 2000),
                })),
                output: '',
              });
            else
              finish(
                new Error(
                  typeof message.message === 'string'
                    ? message.message.slice(0, 2000)
                    : '运行失败。',
                ),
              );
          }
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error('无法创建运行环境。'));
      }
    });
  }
}
