// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const prompt = readFileSync(
  'packages/@openmaic/generation/templates/code-content/system.md',
  'utf8',
);
const source = prompt.match(
  /## Complete Python Widget Runtime Pattern[\s\S]*?```javascript\n([\s\S]*?)```/,
)?.[1];
if (!source) throw new Error('Missing canonical Pyodide initialization example');

type Runtime = { loadPackage: ReturnType<typeof vi.fn> };
type LabWindow = Window & { loadPyodide?: () => Promise<Runtime> };
const labWindow = window as LabWindow;
const install = () =>
  new Function('window', 'document', 'editor', `${source}\nreturn { initPyodide };`)(
    window,
    document,
    { dispose: vi.fn() },
  ) as { initPyodide: () => Promise<Runtime | null> };

beforeEach(() => {
  document.body.innerHTML =
    '<button id="run-btn" disabled></button><div id="status"></div><pre id="output"></pre>';
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  delete labWindow.loadPyodide;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

it('waits for DOM readiness and shares concurrent initialization', async () => {
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
  const runtime = { loadPackage: vi.fn().mockResolvedValue(undefined) };
  labWindow.loadPyodide = vi.fn().mockResolvedValue(runtime);
  const api = install();
  const first = api.initPyodide();
  expect(api.initPyodide()).toBe(first);
  expect(labWindow.loadPyodide).not.toHaveBeenCalled();
  document.dispatchEvent(new Event('DOMContentLoaded'));
  expect(await first).toBe(runtime);
  expect(labWindow.loadPyodide).toHaveBeenCalledTimes(1);
  expect(runtime.loadPackage).toHaveBeenCalledWith(['numpy']);
  expect(document.getElementById('status')?.textContent).toBe('Python ready');
  expect((document.getElementById('run-btn') as HTMLButtonElement).disabled).toBe(false);
});

it('renders a local fallback for a missing status element instead of rejecting', async () => {
  document.getElementById('status')?.remove();
  labWindow.loadPyodide = vi.fn();
  expect(await install().initPyodide()).toBeNull();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('#status');
  expect(labWindow.loadPyodide).not.toHaveBeenCalled();
});

it('rechecks nodes removed while the engine is loading', async () => {
  let resolve!: (runtime: Runtime) => void;
  labWindow.loadPyodide = vi.fn(
    () =>
      new Promise<Runtime>((done) => {
        resolve = done;
      }),
  );
  const pending = install().initPyodide();
  await Promise.resolve();
  document.getElementById('status')?.remove();
  resolve({ loadPackage: vi.fn().mockResolvedValue(undefined) });
  expect(await pending).toBeNull();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('#status');
});

it('ignores a late completion after disposal', async () => {
  let resolve!: (runtime: Runtime) => void;
  labWindow.loadPyodide = vi.fn(
    () =>
      new Promise<Runtime>((done) => {
        resolve = done;
      }),
  );
  const pending = install().initPyodide();
  await Promise.resolve();
  window.dispatchEvent(new Event('pagehide'));
  const runtime = { loadPackage: vi.fn() };
  resolve(runtime);
  expect(await pending).toBeNull();
  expect(runtime.loadPackage).not.toHaveBeenCalled();
  expect(document.getElementById('status')?.textContent).toBe('Loading Python...');
});

it('catches engine loading failures', async () => {
  labWindow.loadPyodide = vi.fn().mockRejectedValue(new Error('CDN unavailable'));
  expect(await install().initPyodide()).toBeNull();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('CDN unavailable');
});
