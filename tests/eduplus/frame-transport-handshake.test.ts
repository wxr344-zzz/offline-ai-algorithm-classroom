import { afterEach, expect, it, vi } from 'vitest';
import { createFrameTransport } from '@/lib/eduplus/practice-runner';
afterEach(() => vi.unstubAllGlobals());
it('waits for this runtime frame, ignores early load and foreign messages, and transfers the port once', () => {
  let handler: (event: unknown) => void = () => {};
  const frame = {
    hidden: false,
    title: '',
    src: '',
    sandbox: { add: vi.fn() },
    contentWindow: { postMessage: vi.fn() },
    remove: vi.fn(),
    onload: undefined as undefined | (() => void),
    onerror: undefined,
  };
  const p1 = { onmessage: null, start: vi.fn(), postMessage: vi.fn(), close: vi.fn() };
  const p2 = { close: vi.fn() };
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = p1;
      port2 = p2;
    },
  );
  const remove = vi.fn();
  vi.stubGlobal('window', {
    addEventListener: vi.fn((_name, fn) => {
      handler = fn;
    }),
    removeEventListener: remove,
  });
  vi.stubGlobal('document', { createElement: vi.fn(() => frame), body: { appendChild: vi.fn() } });
  const transport = createFrameTransport(vi.fn());
  frame.onload?.();
  expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
  handler({ source: {}, data: { type: 'eduplus-runtime-awaiting-port' } });
  expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
  handler({ source: frame.contentWindow, data: { type: 'eduplus-runtime-awaiting-port' } });
  handler({ source: frame.contentWindow, data: { type: 'eduplus-runtime-awaiting-port' } });
  expect(frame.contentWindow.postMessage).toHaveBeenCalledExactlyOnceWith(
    { type: 'connect' },
    '*',
    [p2],
  );
  transport.dispose();
  expect(remove).toHaveBeenCalledWith('message', handler);
  expect(frame.remove).toHaveBeenCalledOnce();
});
