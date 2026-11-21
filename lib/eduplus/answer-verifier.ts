import type { JsonValue, PublicProblem } from '@/lib/types/eduplus.generated';
import { stdioExpected } from './stdio-oracle';

/** Whether unseen custom inputs can be checked without a supplied expected answer. */
export function hasIndependentChecker(problem: PublicProblem): boolean {
  return (
    (!!problem.answerCheck && problem.answerCheck !== 'json-value') || !!problem.standardIoProfile
  );
}

export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '');
}

/** Type-strict JSON equality: object key order is irrelevant; array order is significant. */
export function deepEqual(actual: unknown, expected: unknown, normalizeStrings = false): boolean {
  if (typeof actual !== typeof expected) return false;
  if (typeof actual === 'string' && typeof expected === 'string')
    return normalizeStrings
      ? normalizeOutput(actual) === normalizeOutput(expected)
      : actual === expected;
  if (actual === null || expected === null || typeof actual !== 'object')
    return actual === expected;
  if (Array.isArray(actual) || Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.length === expected.length &&
      actual.every((value, i) => deepEqual(value, expected[i], normalizeStrings))
    );
  const a = actual as Record<string, unknown>,
    b = expected as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key], normalizeStrings))
  );
}

export function compareOutput(actual: JsonValue, expected: JsonValue, stdio = false): boolean {
  if (!stdio) return deepEqual(actual, expected, true);
  if (typeof actual !== 'string') return false;
  let parsedExpected: unknown;
  try {
    parsedExpected = typeof expected === 'string' ? JSON.parse(expected) : expected;
  } catch {
    return typeof expected === 'string' && normalizeOutput(actual) === normalizeOutput(expected);
  }
  try {
    return deepEqual(JSON.parse(actual), parsedExpected);
  } catch {
    return false;
  }
}

export function lcsLength(a: readonly string[], b: readonly string[]): number {
  if (a.length * b.length > 1_000_000) throw new Error('输入过大：LCS 比较最多允许 100 万个状态。');
  let row = new Uint16Array(b.length + 1);
  for (const x of a) {
    const previous = row;
    row = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j++)
      row[j] = x === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], row[j - 1]);
  }
  return row[b.length];
}

function subsequence(candidate: string[], source: string[]) {
  let i = 0;
  for (const value of source) if (i < candidate.length && candidate[i] === value) i++;
  return i === candidate.length;
}

export function independentExpected(problem: PublicProblem, text: string): string | null {
  if (problem.answerCheck === 'capped-matches') {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('输入必须是有效的 JSON 对象。');
    }
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      Object.keys(data).sort().join(',') !== 'pattern,scenario_limit,text' ||
      typeof data.text !== 'string' ||
      typeof data.pattern !== 'string' ||
      Array.from(data.text).length > 2000 ||
      Array.from(data.pattern).length > 2000 ||
      !Number.isInteger(data.scenario_limit) ||
      Number(data.scenario_limit) < 0 ||
      Number(data.scenario_limit) > 2000
    )
      throw new Error(
        '输入需要 text、pattern 字符串和 0 到 2000 的整数 scenario_limit，字符串各不超过 2000 字符。',
      );
    const source = Array.from(data.text),
      pattern = Array.from(data.pattern),
      positions: number[] = [];
    // Enumerating starts is independent of the audited KMP reference.
    for (
      let i = 0;
      pattern.length > 0 &&
      i + pattern.length <= source.length &&
      positions.length < Number(data.scenario_limit);
      i++
    )
      if (pattern.every((char, j) => source[i + j] === char)) positions.push(i);
    return JSON.stringify(positions);
  }
  if (problem.answerCheck === 'lcs-edit-budget') {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('输入格式错误：请填写一行 JSON 对象。');
    }
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      Object.keys(data).sort().join(',') !== 'budget,planA,planB' ||
      !Number.isInteger(data.budget) ||
      Number(data.budget) < 0 ||
      Number(data.budget) > 400 ||
      [data.planA, data.planB].some(
        (seq) =>
          !Array.isArray(seq) ||
          seq.length > 200 ||
          seq.some((v) => typeof v !== 'string' || Array.from(v).length > 100),
      )
    )
      throw new Error(
        '输入格式错误：planA、planB 必须为最多 200 项的字符串数组，budget 为 0 到 400 的整数。',
      );
    const a = data.planA as string[],
      b = data.planB as string[];
    const cost = a.length + b.length - 2 * lcsLength(a, b);
    return `${cost <= Number(data.budget) ? 'YES' : 'NO'} ${cost}`;
  }
  return stdioExpected(problem.standardIoProfile, text);
}

export function verifyAnswer(
  problem: PublicProblem,
  inputs: Record<string, JsonValue>,
  actual: JsonValue,
  expected?: JsonValue,
) {
  if (problem.answerCheck === 'capped-matches' && typeof inputs.stdin === 'string') {
    const expected = independentExpected(problem, inputs.stdin)!;
    let candidate: unknown;
    try {
      candidate = typeof actual === 'string' ? JSON.parse(actual) : null;
    } catch {
      candidate = null;
    }
    return {
      verified: true,
      passed:
        Array.isArray(candidate) &&
        candidate.every((x) => typeof x === 'number' && Number.isInteger(x)) &&
        JSON.stringify(candidate) === expected,
    };
  }
  if (problem.answerCheck === 'lcs-string') {
    if (typeof inputs.str1 !== 'string' || typeof inputs.str2 !== 'string')
      throw new Error('LCS 判题协议错误：需要 str1、str2 字符串。');
    const a = Array.from(inputs.str1),
      b = Array.from(inputs.str2);
    if (a.length > 1000 || b.length > 1000) throw new Error('输入字符串不能超过 1000 个字符。');
    const candidate = typeof actual === 'string' ? Array.from(actual) : null;
    return {
      verified: true,
      passed:
        !!candidate &&
        subsequence(candidate, a) &&
        subsequence(candidate, b) &&
        candidate.length === lcsLength(a, b),
    };
  }
  if (problem.executionMode === 'stdio' && typeof inputs.stdin === 'string') {
    const expected = independentExpected(problem, inputs.stdin);
    if (expected !== null)
      return {
        verified: true,
        passed: compareOutput(actual, expected, true),
      };
  }
  const test =
    expected !== undefined
      ? { expected }
      : problem.publicTestCases.find((item) => deepEqual(item.inputs, inputs));
  if (!test) throw new Error('该输入缺少标准答案，请提供预期输出后评测。');
  if (problem.answerCheck === 'json-value') {
    if (typeof test.expected !== 'string')
      throw new Error('JSON 判题协议错误：标准答案必须是 JSON 字符串。');
    try {
      JSON.parse(test.expected);
    } catch {
      throw new Error('JSON 判题协议错误：标准答案不是有效 JSON。');
    }
    return { verified: true, passed: compareOutput(actual, test.expected, true) };
  }
  return {
    verified: true,
    passed: compareOutput(actual, test.expected, problem.executionMode === 'stdio'),
  };
}
