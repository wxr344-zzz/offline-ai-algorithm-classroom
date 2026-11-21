import { describe, expect, it } from 'vitest';
import { patchHtmlForIframe } from '@/lib/utils/iframe';

describe('patchHtmlForIframe', () => {
  it('serves the injected KaTeX runtime locally and gives transparent legacy pages a readable default', () => {
    const html = patchHtmlForIframe(
      '<head><script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script><link href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"></head><body></body>',
    );
    expect(html).toContain('/vendor/eduplus/katex/katex.min.js');
    expect(html).toContain('/vendor/eduplus/katex/katex.min.css');
    expect(html).not.toContain('cdn.jsdelivr.net/npm/katex');
    expect(html).toContain('background-color: #fff');
  });
  it('injects the storage shim and sizing CSS after <head>', () => {
    const out = patchHtmlForIframe(
      '<!DOCTYPE html><html><head><title>t</title></head><body></body></html>',
    );
    expect(out).toContain('data-iframe-storage-shim');
    expect(out).toContain('data-iframe-patch');
  });

  it('runs the storage shim before the page scripts', () => {
    const html =
      '<!DOCTYPE html><html><head><script>window.__x = localStorage.getItem("k");</script></head><body></body></html>';
    const out = patchHtmlForIframe(html);
    // The shim must appear before the page's own <script> so storage is safe by then.
    expect(out.indexOf('data-iframe-storage-shim')).toBeLessThan(out.indexOf('window.__x'));
  });

  it('the shim provides a working in-memory storage when the real one throws', () => {
    // Execute the injected shim against a fake window whose localStorage getter
    // throws (mirroring a null-origin sandboxed iframe), then assert the shim
    // installed a usable in-memory store.
    const out = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = out.match(/<script data-iframe-storage-shim>([\s\S]*?)<\/script>/)?.[1];
    expect(shim).toBeTruthy();

    const win: Record<string, unknown> = {};
    Object.defineProperty(win, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('sandboxed');
      },
    });
    Object.defineProperty(win, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('sandboxed');
      },
    });
    new Function('window', shim as string)(win);

    const ls = win.localStorage as Storage;
    expect(ls.getItem('missing')).toBeNull();
    ls.setItem('a', '1');
    expect(ls.getItem('a')).toBe('1');
    expect(ls.length).toBe(1);
    ls.removeItem('a');
    expect(ls.getItem('a')).toBeNull();
  });

  it('creates a head when the authored document has none', () => {
    const out = patchHtmlForIframe('<div>no head</div>');
    expect(out.startsWith('<head>\n<script data-iframe-error-shim>')).toBe(true);
    expect(out.indexOf('</head>')).toBeLessThan(out.indexOf('<div>'));
  });

  it('does not treat head-like text in comments or scripts as the document head', () => {
    const authoredScript = 'const template = "<head>"; window.__template = template;';
    const html = `<!doctype html><!-- <head> --><html><body><script>${authoredScript}</script></body></html>`;
    const out = patchHtmlForIframe(html);

    expect(out).toContain(`<script>${authoredScript}</script>`);
    expect(out.indexOf('data-iframe-error-shim')).toBeLessThan(out.indexOf('<body>'));
  });

  it('injects the error-capture shim before the storage shim and page scripts', () => {
    const html = '<!DOCTYPE html><html><head><script>boom()</script></head><body></body></html>';
    const out = patchHtmlForIframe(html);
    expect(out).toContain('data-iframe-error-shim');
    // error shim runs first → before storage shim → before page scripts, so it
    // catches errors from everything that follows.
    expect(out.indexOf('data-iframe-error-shim')).toBeLessThan(
      out.indexOf('data-iframe-storage-shim'),
    );
    expect(out.indexOf('data-iframe-storage-shim')).toBeLessThan(out.indexOf('boom()'));
  });

  it('the error shim posts runtime errors (onerror / resource / rejection / console.error) to the parent', () => {
    const out = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = out.match(/<script data-iframe-error-shim>([\s\S]*?)<\/script>/)?.[1];
    expect(shim).toBeTruthy();

    const posts: Array<[Record<string, unknown>, string]> = [];
    const handlers: Record<string, (e: unknown) => void> = {};
    const win = {
      parent: { postMessage: (m: Record<string, unknown>, o: string) => posts.push([m, o]) },
      addEventListener: (t: string, cb: (e: unknown) => void) => {
        handlers[t] = cb;
      },
      console: { error: (..._args: unknown[]) => {} },
    };
    new Function('window', shim as string)(win);

    handlers.error({ message: 'JSON.parse boom', filename: 'p.html', lineno: 12 });
    expect(posts[0][0]).toMatchObject({ kind: 'runtime-error', errorKind: 'error' });
    expect(posts[0][0].message).toContain('JSON.parse boom');
    expect(posts[0][1]).toBe('*');

    handlers.error({ target: { src: 'https://cdn/katex.js' } });
    expect(String(posts[1][0].message)).toContain('Failed to load resource');

    handlers.unhandledrejection({ reason: { message: 'rej' } });
    expect(posts[2][0]).toMatchObject({ errorKind: 'unhandledrejection' });

    win.console.error('console boom');
    expect(posts[3][0]).toMatchObject({ errorKind: 'console.error' });
    expect(String(posts[3][0].message)).toContain('console boom');

    // The browser's benign ResizeObserver notice is not a widget failure.
    handlers.error({ message: 'ResizeObserver loop completed with undelivered notifications.' });
    handlers.error({ message: 'ResizeObserver loop limit exceeded' });
    expect(posts).toHaveLength(4);
    expect(out).toMatch(/canvas \{ display: block; \}/);
  });

  it('the error shim buffers errors and re-emits them on a parent replay request', () => {
    // Guards the subscribe-after-insert race: a page that throws synchronously
    // while srcDoc parses may post before the parent subscribes. The shim must
    // re-emit the whole buffer when the parent asks, so nothing is lost.
    const out = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = out.match(/<script data-iframe-error-shim>([\s\S]*?)<\/script>/)?.[1];
    const posts: Array<[Record<string, unknown>, string]> = [];
    const handlers: Record<string, (e: unknown) => void> = {};
    const win = {
      parent: { postMessage: (m: Record<string, unknown>, o: string) => posts.push([m, o]) },
      addEventListener: (t: string, cb: (e: unknown) => void) => {
        handlers[t] = cb;
      },
      console: { error: (..._args: unknown[]) => {} },
    };
    new Function('window', shim as string)(win);

    // Two errors fire "before the parent subscribed".
    handlers.error({ message: 'first boom' });
    handlers.unhandledrejection({ reason: { message: 'second boom' } });
    expect(posts).toHaveLength(2);

    // Parent now subscribes and requests a replay.
    handlers.message({ data: { __maicErrorReplayRequest: true } });
    expect(posts).toHaveLength(4);
    expect(String(posts[2][0].message)).toContain('first boom');
    expect(String(posts[3][0].message)).toContain('second boom');
    expect(posts[2][0]).toMatchObject({ kind: 'runtime-error', errorKind: 'error' });

    // An unrelated message must NOT trigger a replay.
    handlers.message({ data: { foo: 1 } });
    expect(posts).toHaveLength(4);
  });

  it('keeps a widget running when its state report runs before the state exists', () => {
    // Reproduces a generated native widget: publishCurrentState() is called
    // before `state` is constructed and used to abort the whole script.
    const page = patchHtmlForIframe(`<html><head></head><body><div id="experiment"></div><script>
let state;
function publishCurrentState(){ publishState({ summary: 'step ' + state.step }); }
publishCurrentState();
state = { step: 1 };
window.__reached = state.step;
</script></body></html>`);
    const script = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].find((m) =>
      m[1].includes('__reached'),
    )![1];
    const published: unknown[] = [];
    const warnings: string[] = [];
    const fakeWindow: Record<string, unknown> = {};
    new Function('window', 'document', 'console', 'publishState', script)(
      fakeWindow,
      { querySelectorAll: () => [] },
      { warn: (m: string) => warnings.push(m) },
      (o: unknown) => published.push(o),
    );
    expect(fakeWindow.__reached).toBe(1);
    expect(warnings[0]).toContain("reading 'step'");
    expect(published).toEqual([]);
  });

  it('leaves external, JSON, platform and unrelated scripts unchanged', () => {
    const source =
      '<script src="a.js"></script>' +
      '<script type="application/json">{"publishState":1}</script>' +
      '<script>function render(){ return 1; }</script>';
    const page = patchHtmlForIframe(`<html><head></head><body>${source}</body></html>`);
    expect(page).toContain(source);
    expect(page).not.toContain('__maicUncontained_publishCurrentState');
  });
});
