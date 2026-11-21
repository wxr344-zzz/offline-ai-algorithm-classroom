/**
 * Reference output for a learner's own Lab input ("运行代码"), so a custom run
 * can say whether the learner's output is right, as an online judge does.
 *
 * The private reference solution runs in the same WASM sandbox that accepted
 * it at generation time (scripts/lesson-reference-sandbox.mjs, Pyodide in a
 * resource-limited worker, never the host interpreter). Only the computed
 * output leaves the server, never the code.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { JsonValue } from '@/lib/types/eduplus.generated';

export type ReferenceOutput =
  | { expected: JsonValue }
  | { unavailable: 'invalid-input' | 'reference-failed' | 'sandbox-unavailable'; message: string };

const SANDBOX_TIMEOUT_MS = 45_000;
const cache = new Map<string, ReferenceOutput>();
const CACHE_LIMIT = 200;

/** The class and method a reference solution defines (class Solution: def solve(self, …)). */
export function referenceEntry(code: string): { className: string; methodName: string } | null {
  const cls = /^class\s+([A-Za-z_]\w*)\s*[:(]/m.exec(code);
  if (!cls) return null;
  const after = code.slice(cls.index);
  const method = /^\s+def\s+([A-Za-z_]\w*)\s*\(\s*self\b/m.exec(after);
  return method ? { className: cls[1]!, methodName: method[1]! } : null;
}

type SandboxResult = {
  jobs?: Array<Array<{ actual?: JsonValue; error?: string }>>;
  error?: string;
};

function runSandbox(payload: unknown, signal?: AbortSignal): Promise<SandboxResult> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), 'scripts', 'lesson-reference-sandbox.mjs');
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: {
        NODE_ENV: process.env.NODE_ENV ?? 'production',
        SYSTEMROOT: process.env.SYSTEMROOT ?? '',
        TEMP: process.env.TEMP ?? '',
        TMP: process.env.TMP ?? '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => child.kill(), SANDBOX_TIMEOUT_MS);
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
      if (out.length > 2_000_000) child.kill();
    });
    child.on('error', (error: Error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      try {
        resolve(JSON.parse(out) as SandboxResult);
      } catch {
        reject(new Error('sandbox returned no result'));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

/** Compute the reference solution's output for one input (cached per input). */
export async function computeReferenceOutput(
  reference: { code: string; key: string },
  inputs: Record<string, JsonValue>,
  signal?: AbortSignal,
): Promise<ReferenceOutput> {
  const cacheKey = `${reference.key}\u0000${JSON.stringify(inputs)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const entry = referenceEntry(reference.code);
  if (!entry) return { unavailable: 'reference-failed', message: '参考解法缺少可调用的入口。' };
  let result: SandboxResult;
  try {
    result = await runSandbox(
      [{ code: reference.code, entry, cases: [{ caseId: 'custom', inputs, expected: null }] }],
      signal,
    );
  } catch {
    return { unavailable: 'sandbox-unavailable', message: '参考执行器暂时不可用，请稍后再试。' };
  }
  const item = result.jobs?.[0]?.[0];
  let output: ReferenceOutput;
  if (item && item.error === undefined && 'actual' in item)
    output = { expected: item.actual as JsonValue };
  else {
    const error = String(item?.error ?? result.error ?? '');
    output = /有效域|有效输入|invalid input|ValueError/i.test(error)
      ? {
          unavailable: 'invalid-input',
          message: '这份输入不在本题的有效输入范围内，无法给出参考结果；请按题面的输入约定填写。',
        }
      : {
          unavailable: 'reference-failed',
          message:
            '这份输入无法得到参考结果（可能超出题目约定的格式或规模），请按题面的输入约定填写。',
        };
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, output);
  return output;
}
