// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { patchHtmlForIframe } from '@/lib/utils/iframe';

function install(win: Record<string, unknown> = {}) {
  const html = patchHtmlForIframe('<html><head></head><body></body></html>');
  const script = html.match(/<script data-iframe-observation-publisher>([\s\S]*?)<\/script>/)![1];
  // Only the developer-maintained shim is evaluated, never model HTML or student source.
  new Function('window', 'document', 'TextEncoder', script)(win, document, TextEncoder);
  return win.publishState as (observation?: unknown) => void;
}
beforeEach(() => {
  document.body.innerHTML = '<main id="experiment"></main>';
});
describe('shared observation publication helper', () => {
  it('publishes the actual supplied state before and after input changes', () => {
    const publish = install();
    publish({ summary: '12 + 15 = 27', state: { a: 12, b: 15, sum: 27 } });
    publish({ summary: '-1 + 1 = 0', state: { a: -1, b: 1, sum: 0 } });
    const nodes = document.querySelectorAll('script[data-maic-observation]');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].getAttribute('type')).toBe('application/json');
    expect(JSON.parse(nodes[0].textContent!)).toEqual({
      summary: '-1 + 1 = 0',
      state: { a: -1, b: 1, sum: 0 },
    });
  });
  it('does not override a lesson publisher or fabricate observations on invalid input', () => {
    const original = () => {};
    expect(install({ publishState: original })).toBe(original);
    const publish = install();
    publish({ summary: 'valid' });
    expect(() => publish()).toThrow('Invalid state publication');
    expect(document.querySelector('script[data-maic-observation]')).toBeNull();
    expect(() => publish({ summary: 'x'.repeat(33000) })).toThrow();
  });
  it('rejects ambiguous scopes and deeply nested data instead of retaining stale state', () => {
    const publish = install();
    let nested: unknown = { value: true };
    for (let i = 0; i < 66; i++) nested = { nested };
    expect(() => publish(nested)).toThrow('deeply nested');
    document.body.innerHTML = '<main id="experiment"></main><main id="experiment"></main>';
    expect(() => publish({})).toThrow('ambiguous');
  });
});
