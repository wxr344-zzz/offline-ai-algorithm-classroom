// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import type { PPTTableElement } from '@openmaic/dsl';
import { StaticTable as AppTable } from '@/components/slide-renderer/components/element/TableElement/StaticTable';
import { StaticTable as RendererTable } from '@/packages/@openmaic/renderer/src/elements/table/StaticTable';
import { normalizeTable } from '@/packages/@openmaic/renderer/src/elements/table/normalizeTable';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([AppTable, RendererTable])(
  'opens a legacy generated table without colWidths, ids or spans',
  (Component) => {
    const element = {
      id: 'old-table',
      width: 334.48,
      height: 39.82,
      type: 'table',
      colWidthSums: [0.25, 0.25, 0.25, 0.25],
      data: [
        [{ text: '过程', style: 'bold' }],
        [{ text: '原料' }, { text: '产物' }, { text: '能量状态' }],
      ],
    } as unknown as PPTTableElement;
    const before = JSON.stringify(element);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      expect(() =>
        act(() => root.render(createElement(Component, { elementInfo: element }))),
      ).not.toThrow();
      expect(host.querySelectorAll('td')).toHaveLength(4);
      expect(host.textContent).toBe('过程原料产物能量状态');
      expect(host.querySelectorAll('col')).toHaveLength(4);
      expect(JSON.stringify(element)).toBe(before);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  },
);

it('keeps valid imported column widths and merge spans unchanged', () => {
  const element = {
    id: 'imported',
    colWidths: [0.2, 0.3, 0.5],
    cellMinHeight: 24,
    data: [[{ id: 'h', text: 'Heading', colspan: 3, rowspan: 1, style: { bold: true } }]],
  } as PPTTableElement;
  const normalized = normalizeTable(element);
  expect(normalized.colWidths).toEqual(element.colWidths);
  expect(normalized.data).toEqual(element.data);
  expect(normalized.cellMinHeight).toBe(24);
});

it('handles missing rows and widths without inventing cell text', () => {
  const table = normalizeTable({ id: 'empty' } as PPTTableElement);
  expect(table.data).toEqual([]);
  expect(table.colWidths).toEqual([1]);
});
