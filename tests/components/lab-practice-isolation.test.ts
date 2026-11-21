// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '@/contracts/examples/public-lab.json';
import type { LabScene } from '@/lib/types/eduplus-practice';

const calls = vi.hoisted(() => ({ run: vi.fn(), cancel: vi.fn() }));
vi.mock('@/components/eduplus/python-editor', () => ({
  PythonEditor: () => createElement('div', null, 'Editor'),
}));
vi.mock('@/lib/eduplus/practice-runner', async (original) => ({
  ...(await original<typeof import('@/lib/eduplus/practice-runner')>()),
  BrowserPracticeRunner: class {
    run = calls.run;
    cancel = calls.cancel;
    dispose = vi.fn();
  },
}));
import { LabPractice } from '@/components/eduplus/lab-practice';

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

describe('custom and public test results are independent', () => {
  for (const stdio of [false, true])
    it(stdio ? 'OJ stdio' : 'guided function', async () => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      const scene = structuredClone(fixture.scenes[0]) as LabScene;
      scene.sceneId += stdio ? '-stdio-isolation' : '-function-isolation';
      if (stdio) {
        scene.problem.executionMode = 'stdio';
        scene.problem.publicTestCases.forEach((c, i) => {
          c.inputs = { stdin: String(i) };
          c.expected = String(i);
        });
      }
      const requests: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          requests.push(url);
          return {
            ok: true,
            json: async () =>
              url.includes('/drafts/')
                ? {
                    sceneId: scene.sceneId,
                    problemVersion: scene.problem.problemVersion,
                    code: scene.interactiveCode,
                    revision: 0,
                    updatedAt: null,
                  }
                : { ok: true },
          };
        }),
      );
      calls.run.mockReset().mockImplementation(async (_code, problem) => ({
        cases: problem.publicTestCases.map((c: { caseId: string; expected: unknown }) => ({
          caseId: c.caseId,
          passed: true,
          actual: c.expected ?? 'custom-output',
          verdict: 'Accepted',
        })),
        output: '',
      }));
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
      await act(async () => root.render(createElement(LabPractice, { scene })));
      const click = async (text: string) => {
        const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;
        expect(button).toBeTruthy();
        await act(async () => button.click());
      };
      await click('运行公开测试');
      const suite = host.querySelector('[aria-label="公开测试结果"]')!;
      const snapshot = suite.innerHTML;
      const practiceCount = requests.filter((u) => u.endsWith('/practice')).length;
      await click(stdio ? '运行代码' : '运行自定义输入');
      expect(calls.run).toHaveBeenCalledTimes(2);
      expect(calls.run.mock.calls[1][1].publicTestCases).toHaveLength(1);
      expect(calls.run.mock.calls[1][1].publicTestCases[0].caseId).toBe('custom-debug');
      expect(calls.run.mock.calls[1][3]).toBe(false);
      expect(host.querySelector('[aria-label="公开测试结果"]')).toBe(suite);
      expect(suite.innerHTML).toBe(snapshot);
      expect(requests.filter((u) => u.endsWith('/practice'))).toHaveLength(practiceCount);
      const output = stdio
        ? (host.querySelector('[aria-label="标准输出或错误"]') as HTMLTextAreaElement).value
        : (host.querySelector('[aria-label="自定义输出或错误"]') as HTMLTextAreaElement).value;
      const input = host.querySelector(
        stdio ? '[aria-label="标准输入"]' : '[aria-label="自定义调试输入"]',
      ) as HTMLTextAreaElement;
      const inputBefore = input.value;
      await click('运行公开测试');
      expect(calls.run).toHaveBeenCalledTimes(3);
      expect(input.value).toBe(inputBefore);
      expect(
        stdio
          ? (host.querySelector('[aria-label="标准输出或错误"]') as HTMLTextAreaElement).value
          : (host.querySelector('[aria-label="自定义输出或错误"]') as HTMLTextAreaElement).value,
      ).toBe(output);
    });
});
