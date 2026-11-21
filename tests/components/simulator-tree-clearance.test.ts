// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Topology } from '@/components/eduplus/exam-simulator';

it('keeps L/R edge labels between variable-height nodes and all nodes inside the SVG', () => {
  const view = {
    kind: 'tree' as const,
    name: 'BST',
    nodes: [
      { id: '30', label: '30\n高度=4\n根' },
      { id: '25', label: '25' },
      { id: '10', label: '10\n叶节点' },
      { id: '28', label: '28' },
      { id: '27', label: '27' },
    ],
    edges: [
      { source: '30', target: '25', label: 'L' },
      { source: '25', target: '10', label: 'L' },
      { source: '25', target: '28', label: 'R' },
      { source: '28', target: '27', label: 'L' },
    ],
  };
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(createElement(Topology, { view }));
  const svg = host.querySelector('svg')!;
  const [, , width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
  const boxes = [...svg.querySelectorAll('g[transform]')].map((g) => {
    const [x, y] = g
      .getAttribute('transform')!
      .match(/[\d.-]+/g)!
      .map(Number);
    const rect = g.querySelector('rect')!;
    const left = x + Number(rect.getAttribute('x')),
      top = y + Number(rect.getAttribute('y'));
    return {
      left,
      top,
      right: left + Number(rect.getAttribute('width')),
      bottom: top + Number(rect.getAttribute('height')),
    };
  });
  boxes.forEach((b) => {
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.top).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(width);
    expect(b.bottom).toBeLessThanOrEqual(height);
  });
  const labels = [...svg.querySelectorAll('text')].filter(
    (t) => t.textContent === 'L' || t.textContent === 'R',
  );
  expect(labels).toHaveLength(4);
  labels.forEach((t) => {
    const x = Number(t.getAttribute('x')),
      y = Number(t.getAttribute('y'));
    boxes.forEach((b) =>
      expect(x + 14 > b.left && x - 4 < b.right && y + 4 > b.top && y - 16 < b.bottom).toBe(false),
    );
  });
});
