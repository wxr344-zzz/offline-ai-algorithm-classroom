// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ExamSimulator } from '@/components/eduplus/exam-simulator';

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(createElement(ExamSimulator, { reference: { topic: '跳跃查找算法' } })),
  );
}
const catalog = {
  profiles: [
    {
      id: 'insertion',
      title: '直接插入排序',
      aliases: [],
      section: '排序',
      default: { array: [3, 1] },
    },
  ],
};

it('keeps the requested topic on failure instead of silently selecting the first catalog algorithm', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/trace')
        ? { ok: false, json: async () => ({ error: { message: '输入参数需要补充目标值' } }) }
        : { ok: true, json: async () => catalog },
    ),
  );
  await mount();
  expect(host.querySelector('h2')?.textContent).toContain('跳跃查找');
  expect(host.querySelector('h2')?.textContent).not.toContain('插入排序');
  expect((host.querySelector('[aria-label="算法目录"]') as HTMLSelectElement).value).toBe('');
  expect(host.textContent).not.toContain('可在目录中选择具体算法');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('目标值');
});

it('renders an unlisted executed trace and resubmits its original topic with custom input', async () => {
  const requests: Record<string, unknown>[] = [];
  const trace = {
    version: 1,
    engine: 'python-sandbox',
    algorithm: 'dynamic-jump',
    title: '跳跃查找',
    input: { array: [1, 3, 5], target: 3 },
    inputDescription: '数组有序，target为查找值',
    verified: true,
    outcome: 1,
    verification: {
      checkedInputs: 5,
      kind: 'execution-crosscheck',
      deterministicReplay: true,
      sourceHash: 'hash',
      snapshots: 'python-line-trace',
    },
    frames: [
      {
        index: 0,
        label: 'solve 第3行执行前',
        explanation: '即将执行：while i < n:',
        state: { i: 0 },
        views: [
          {
            kind: 'matrix',
            name: '真实表格',
            values: [
              [1, 2],
              [3, 4],
            ],
            rows: [0, 1],
            columns: [0, 1],
            active: [],
            dependencies: [],
          },
        ],
      },
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/trace')) {
        requests.push(JSON.parse(String(init?.body)));
        return { ok: true, json: async () => trace };
      }
      return { ok: true, json: async () => catalog };
    }),
  );
  await mount();
  expect(host.querySelector('h2')?.textContent).toContain('跳跃查找');
  expect(host.textContent).toContain('已校验 5 组');
  expect(host.querySelectorAll('td').length).toBeGreaterThanOrEqual(4);
  const run = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === '应用输入并重新计算',
  )!;
  await act(async () => run.click());
  expect(requests[1]).toEqual({
    lang: 'zh-CN',
    algorithm: 'dynamic-jump',
    topic: '跳跃查找算法',
    input: trace.input,
  });
  expect((host.querySelector('[aria-label="算法目录"]') as HTMLSelectElement).value).toBe(
    'dynamic-jump',
  );
});
