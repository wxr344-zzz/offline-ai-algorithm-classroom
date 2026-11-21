'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { IframePoolEntry } from '@/lib/store/interactive-iframe-pool';

interface Props {
  readonly children?: ReactNode;
  readonly resetKey: string;
  readonly entry: IframePoolEntry;
  readonly visible: boolean;
}

function Fallback({
  entry,
  visible,
  retry,
}: Pick<Props, 'entry' | 'visible'> & { retry: () => void }) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      data-testid="interactive-render-fallback"
      className="rounded-md border bg-background p-4 text-foreground shadow"
      style={{
        position: 'fixed',
        left: entry.rect?.left ?? 16,
        top: entry.rect?.top ?? 16,
        width: Math.max(1, entry.rect?.width ?? 320),
        zIndex: 4,
        display: visible ? 'block' : 'none',
      }}
    >
      <p>{t('chat.interactiveRuntimeError.title')}</p>
      <button type="button" className="mt-3 rounded border px-3 py-1" onClick={retry}>
        {t('common.retry')}
      </button>
    </div>
  );
}

/** Render/lifecycle failures are local to one scene. Async iframe errors use its existing message bridge. */
export class InteractiveSceneErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Interactive scene rendering failed', error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  private retry = () => this.setState({ failed: false });

  render() {
    return this.state.failed ? (
      <Fallback entry={this.props.entry} visible={this.props.visible} retry={this.retry} />
    ) : (
      this.props.children
    );
  }
}
