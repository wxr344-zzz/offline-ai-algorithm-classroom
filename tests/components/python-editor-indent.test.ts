// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { indentPython, PythonEditor } from '@/components/eduplus/python-editor';

describe('Python editor Tab indentation', () => {
  it('indents a caret to a four-space stop and outdents selected lines', () => {
    expect(indentPython('ab', 2, 2)).toEqual({ value: 'ab  ', start: 4, end: 4 });
    expect(indentPython('\nx', 0, 0)).toEqual({ value: '    \nx', start: 4, end: 4 });
    const text = 'one\ntwo\nthree';
    const indented = indentPython(text, 0, 8);
    expect(indented.value).toBe('    one\n    two\nthree');
    expect(indentPython(indented.value, indented.start, indented.end, true).value).toBe(text);
    expect(indentPython('  x', 2, 2, true)).toEqual({ value: 'x', start: 0, end: 0 });
  });
  it('keeps Tab in the editor and leaves the run button untouched', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const addCommand = vi.fn();
    const trigger = vi.fn();
    const create = vi.fn((_container: HTMLElement, _options: Record<string, unknown>) => ({
      getValue: () => 'x',
      setValue: vi.fn(),
      updateOptions: vi.fn(),
      onDidChangeModelContent: () => ({ dispose() {} }),
      getModel: () => null,
      dispose() {},
      addCommand,
      trigger,
    }));
    Object.assign(window, {
      monaco: { editor: { create }, KeyCode: { Tab: 2 }, KeyMod: { Shift: 1024 } },
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const run = vi.fn();
    function Harness() {
      const [value, setValue] = useState('x');
      return createElement(
        'div',
        null,
        createElement(PythonEditor, { value, onChange: setValue }),
        createElement('button', { onClick: run }, '运行公开测试'),
      );
    }
    try {
      await act(async () => root.render(createElement(Harness)));
      expect(create.mock.calls[0][1]).toMatchObject({
        tabFocusMode: false,
        insertSpaces: true,
        tabSize: 4,
      });
      expect(addCommand.mock.calls.map((call) => call[0])).toEqual([2, 1026]);
      addCommand.mock.calls[0][1]();
      addCommand.mock.calls[1][1]();
      expect(trigger.mock.calls.map((call) => call[1])).toEqual(['tab', 'outdent']);
      await act(async () => host.querySelector('button')!.click());
      const input = host.querySelector('textarea')!;
      input.focus();
      input.setSelectionRange(1, 1);
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      await act(async () => input.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(input.value).toBe('x   ');
      expect(document.activeElement).toBe(input);
      expect(run).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
