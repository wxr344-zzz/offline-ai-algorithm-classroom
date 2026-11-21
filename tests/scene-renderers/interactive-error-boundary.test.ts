// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { InteractiveSceneErrorBoundary } from '@/components/scene-renderers/InteractiveSceneErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@/lib/hooks/use-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

afterEach(() => vi.restoreAllMocks());

it('contains a scene render failure, retries, and resets on new content', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let broken = true;
  function Scene() {
    if (broken) throw new Error('failed scene');
    return createElement('span', null, 'scene ready');
  }
  const render = (resetKey: string) =>
    createElement(
      'div',
      null,
      createElement('span', null, 'other page content'),
      createElement(
        InteractiveSceneErrorBoundary,
        { resetKey, visible: true, entry: { rect: null, clip: null, owner: 'owner', tick: 1 } },
        createElement(Scene),
      ),
    );
  try {
    await act(async () => root.render(render('first')));
    expect(host.textContent).toContain('other page content');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    broken = false;
    await act(async () => host.querySelector('button')?.click());
    expect(host.textContent).toContain('scene ready');
    broken = true;
    await act(async () => root.render(render('first')));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    broken = false;
    await act(async () => root.render(render('changed')));
    expect(host.textContent).toContain('scene ready');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
