'use client';

import { useEffect, useRef, useState } from 'react';
import { useCourseLanguage } from '@/lib/eduplus/use-course-language';

interface Disposable {
  dispose(): void;
}
interface CodeEditor extends Disposable {
  getValue(): string;
  setValue(value: string): void;
  updateOptions(options: { readOnly: boolean }): void;
  getModel(): Disposable | null;
  onDidChangeModelContent(handler: () => void): Disposable;
  addCommand(keybinding: number, handler: () => void, context?: string): string | null;
  trigger(source: string, command: string, payload: unknown): void;
}
interface MonacoAPI {
  editor: { create(container: HTMLElement, options: Record<string, unknown>): CodeEditor };
  KeyCode: { Tab: number };
  KeyMod: { Shift: number };
}
interface AMDLoader {
  (modules: string[], loaded: () => void, failed: (error: unknown) => void): void;
  config(options: { paths: Record<string, string> }): void;
}
type MonacoWindow = Window & {
  monaco?: MonacoAPI;
  require?: AMDLoader;
  MonacoEnvironment?: { getWorkerUrl(): string };
};
let loaderPromise: Promise<MonacoAPI> | undefined;
function loadMonaco(): Promise<MonacoAPI> {
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise<MonacoAPI>((resolve, reject) => {
    const target = window as unknown as MonacoWindow;
    if (target.monaco) {
      resolve(target.monaco);
      return;
    }
    const script = document.createElement('script');
    const timer = setTimeout(() => reject(new Error('编辑器加载超时')), 20000);
    const fail = () => {
      clearTimeout(timer);
      reject(new Error('编辑器加载失败'));
    };
    script.src = '/vendor/eduplus/monaco/vs/loader.js';
    script.onerror = fail;
    script.onload = () => {
      if (!target.require) {
        fail();
        return;
      }
      target.MonacoEnvironment = {
        getWorkerUrl: () => '/vendor/eduplus/monaco/vs/base/worker/workerMain.js',
      };
      target.require.config({ paths: { vs: '/vendor/eduplus/monaco/vs' } });
      target.require(
        ['vs/editor/editor.main'],
        () => {
          clearTimeout(timer);
          if (target.monaco) resolve(target.monaco);
          else fail();
        },
        fail,
      );
    };
    document.head.appendChild(script);
  }).catch((error) => {
    loaderPromise = undefined;
    throw error;
  });
  return loaderPromise;
}

export function PythonEditor({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
}) {
  const english = useCourseLanguage() === 'en';
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<CodeEditor | null>(null);
  const callback = useRef(onChange);
  const latest = useRef(value);
  const [ready, setReady] = useState(false);
  const [plain, setPlain] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    callback.current = onChange;
    latest.current = value;
  });
  useEffect(() => {
    let mounted = true;
    let subscription: Disposable | undefined;
    let instance: CodeEditor | undefined;
    loadMonaco()
      .then((monaco) => {
        // Check after await; Strict Mode/unmount can invalidate the original DOM ref.
        if (!mounted || !container.current) return;
        instance = monaco.editor.create(container.current, {
          value: latest.current,
          language: 'python',
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 14,
          scrollBeyondLastLine: false,
          tabSize: 4,
          insertSpaces: true,
          detectIndentation: false,
          tabFocusMode: false,
          tabCompletion: 'off',
          // A plain textarea for input: classroom shortcuts recognise it as typing.
          editContext: false,
          ariaLabel: english ? 'Python code editor' : 'Python 代码编辑器',
          theme: 'vs-dark',
        });
        // Monaco's global Ctrl+M focus mode overrides tabFocusMode:false.
        // Explicit editor-local bindings keep Tab as indentation in either mode.
        const writable = 'editorTextFocus && !editorReadonly';
        instance.addCommand(
          monaco.KeyCode.Tab,
          () => instance!.trigger('keyboard', 'tab', {}),
          writable,
        );
        instance.addCommand(
          monaco.KeyMod.Shift | monaco.KeyCode.Tab,
          () => instance!.trigger('keyboard', 'outdent', {}),
          writable,
        );
        editor.current = instance;
        subscription = instance.onDidChangeModelContent(() =>
          callback.current(instance!.getValue()),
        );
        setReady(true);
      })
      .catch(() => {
        if (mounted)
          setFailure(
            english
              ? 'Monaco is unavailable; you can keep using the text editor.'
              : 'Monaco 暂不可用，可以继续使用文本编辑器。',
          );
      });
    return () => {
      mounted = false;
      subscription?.dispose();
      const model = instance?.getModel();
      instance?.dispose();
      model?.dispose();
      if (editor.current === instance) editor.current = null;
    };
  }, []);
  useEffect(() => {
    if (editor.current && editor.current.getValue() !== value) editor.current.setValue(value);
  }, [value]);
  useEffect(() => {
    editor.current?.updateOptions({ readOnly: Boolean(disabled) });
  }, [disabled, ready]);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setPlain((previous) => !previous)}
        className="text-xs underline"
      >
        {plain
          ? english
            ? 'Use the Monaco editor'
            : '使用 Monaco 编辑器'
          : english
            ? 'Use the text editor'
            : '使用文本编辑器'}
      </button>
      {failure && <p className="text-xs text-muted-foreground">{failure}</p>}
      <div
        ref={container}
        className={`h-80 overflow-hidden rounded-lg border ${!ready || plain ? 'hidden' : ''} ${disabled ? 'pointer-events-none opacity-70' : ''}`}
      />
      {(!ready || plain) && (
        <textarea
          aria-label={english ? 'Python code' : 'Python 代码'}
          spellCheck={false}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;
            event.preventDefault();
            const input = event.currentTarget;
            const edit = indentPython(
              value,
              input.selectionStart,
              input.selectionEnd,
              event.shiftKey,
            );
            onChange(edit.value);
            requestAnimationFrame(() => input.setSelectionRange(edit.start, edit.end));
          }}
          maxLength={100000}
          className="h-80 w-full rounded-lg border bg-background p-3 font-mono text-sm"
        />
      )}
    </div>
  );
}

/** Text fallback uses the same four-space indentation as Monaco. */
export function indentPython(value: string, start: number, end: number, outdent = false) {
  if (!outdent && start === end) {
    const column = start - (start ? value.lastIndexOf('\n', start - 1) + 1 : 0);
    const spaces = ' '.repeat(4 - (column % 4));
    return {
      value: value.slice(0, start) + spaces + value.slice(end),
      start: start + spaces.length,
      end: start + spaces.length,
    };
  }
  const first = start ? value.lastIndexOf('\n', start - 1) + 1 : 0;
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const segment = value.slice(first, last);
  let delta = 0;
  let firstDelta = 0;
  const lines = segment.split('\n').map((line, i) => {
    const removed = outdent
      ? line.startsWith('\t')
        ? 1
        : Math.min(4, /^ */.exec(line)![0].length)
      : 0;
    const change = outdent ? -removed : 4;
    delta += change;
    if (!i) firstDelta = change;
    return outdent ? line.slice(removed) : '    ' + line;
  });
  return {
    value: value.slice(0, first) + lines.join('\n') + value.slice(last),
    start: Math.max(first, start + firstDelta),
    end: Math.max(first, end + delta),
  };
}
