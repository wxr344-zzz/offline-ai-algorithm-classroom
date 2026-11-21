// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '@/contracts/examples/public-lab.json';
import type { LabScene } from '@/lib/types/eduplus-practice';
import { LabPractice } from '@/components/eduplus/lab-practice';

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/components/eduplus/python-editor', () => ({ PythonEditor: () => null }));
vi.mock('@/lib/eduplus/practice-runner', async (original) => ({
  ...(await original<typeof import('@/lib/eduplus/practice-runner')>()),
  BrowserPracticeRunner: class {
    run = run;
    cancel() {}
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('strict judge UI and record totals', () => {
  it.each(['function', 'stdio'] as const)(
    'removes only the separate expected-answer editor in %s mode',
    async (mode) => {
      const base = fixture.scenes[0] as LabScene;
      const scene: LabScene = { ...base, problem: { ...base.problem, executionMode: mode } };
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                sceneId: scene.sceneId,
                problemVersion: scene.problem.problemVersion,
                code: scene.interactiveCode,
                revision: 0,
                updatedAt: null,
              }),
              { status: 200 },
            ),
        ),
      );
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      try {
        await act(async () => root.render(React.createElement(LabPractice, { scene })));
        expect(host.querySelector('[aria-label="自定义预期输出"]')).toBeNull();
        expect(host.querySelector('[aria-label="自定义预期返回值"]')).toBeNull();
        expect(host.textContent).not.toMatch(/你填写的预期|预期返回值（JSON）|自定义预期输出/);
        expect(
          host.querySelector(
            mode === 'stdio' ? '[aria-label="标准输入"]' : '[aria-label="自定义调试输入"]',
          ),
        ).not.toBeNull();
        if (mode === 'stdio')
          expect(host.querySelector('[aria-label="标准输出或错误"]')).not.toBeNull();
        expect(host.textContent).toContain('运行公开测试');
        expect(host.textContent).toContain('保存草稿');
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );
  it('renders every verdict and posts all cases, including runtime errors, as the denominator', async () => {
    const base = fixture.scenes[0] as LabScene;
    const scene = {
      ...base,
      problem: {
        ...base.problem,
        publicTestCases: [0, 1, 2, 3].map((i) => ({
          ...base.problem.publicTestCases[0],
          caseId: String(i),
        })),
      },
    };
    const cases = [
      { caseId: '0', passed: true, verified: true, actual: 6, verdict: 'Accepted' },
      { caseId: '1', passed: false, verified: true, actual: 0, verdict: 'Wrong Answer' },
      {
        caseId: '2',
        passed: false,
        verified: true,
        error: 'ZeroDivisionError',
        verdict: 'Runtime Error',
      },
      {
        caseId: '3',
        passed: false,
        verified: true,
        error: 'timeout',
        verdict: 'Time Limit Exceeded',
      },
    ];
    run.mockResolvedValue({ cases, output: '' });
    const fetchMock = vi.fn(
      async (_url: string, options?: RequestInit) =>
        new Response(
          JSON.stringify(
            options?.method === 'POST'
              ? {}
              : {
                  sceneId: scene.sceneId,
                  problemVersion: scene.problem.problemVersion,
                  code: scene.interactiveCode,
                  revision: 0,
                  updatedAt: null,
                },
          ),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(React.createElement(LabPractice, { scene }));
      });
      const button = Array.from(host.querySelectorAll('button')).find(
        (item) => item.textContent === '运行公开测试',
      )!;
      await act(async () => {
        button.click();
      });
      expect(host.textContent).toContain('1 / 4 通过');
      for (const verdict of ['Accepted', 'Wrong Answer', 'Runtime Error', 'Time Limit Exceeded'])
        expect(host.textContent).toContain(verdict);
      expect(host.querySelectorAll('.text-green-600').length).toBeGreaterThan(0);
      expect(host.querySelectorAll('.text-red-600').length).toBeGreaterThan(0);
      expect(host.textContent).not.toMatch(/待验证|不计对错|候选输出|正式判题暂未启用/);
      const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!;
      expect(JSON.parse(String(post[1]?.body))).toMatchObject({
        status: 'completed',
        passed: 1,
        total: 4,
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
