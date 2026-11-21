import { describe, expect, it } from 'vitest';
import type { PPTElement } from '@openmaic/dsl';
import { removeEmptyBlocks } from '@/lib/edit/empty-shape-cleanup';

const RECT = 'M 0 0 L 1 0 L 1 1 L 0 1 Z';
const shape = (id: string, left: number, top: number, width: number, height: number, extra = {}) =>
  ({
    id,
    type: 'shape',
    left,
    top,
    width,
    height,
    rotate: 0,
    path: RECT,
    viewBox: [1, 1],
    fill: '#f0e68c',
    fixedRatio: false,
    ...extra,
  }) as unknown as PPTElement;
const text = (id: string, left: number, top: number, width: number, height: number) =>
  ({
    id,
    type: 'text',
    left,
    top,
    width,
    height,
    rotate: 0,
    content: '<p>说明</p>',
  }) as unknown as PPTElement;

describe('empty block cleanup', () => {
  it('drops the unlabelled yellow boxes of the reported 光合作用 slide', () => {
    const items = [
      text('title', 60, 40, 600, 60),
      text('body', 60, 140, 880, 80),
      shape('box1', 400, 280, 200, 75),
      shape('box2', 400, 380, 200, 75),
    ];
    expect(removeEmptyBlocks(items).map((e) => e.id)).toEqual(['title', 'body']);
  });

  it('keeps blocks that carry or underlie content, accents, backgrounds and other shapes', () => {
    const items = [
      shape('card', 60, 150, 400, 120),
      text('on-card', 80, 170, 360, 80),
      shape('labelled', 500, 150, 200, 80, { text: { content: '<p>光反应</p>' } }),
      shape('accent', 40, 300, 4, 40, { fill: '#ed7d31' }),
      shape('background', 0, 0, 1000, 562.5),
      shape('bullet', 60, 400, 12, 12),
      shape('arrow', 300, 400, 120, 40, {
        path: 'M 0 0.5 L 0.8 0.5 L 0.8 0 L 1 0.5 L 0.8 1 L 0.8 0.5',
      }),
    ];
    expect(removeEmptyBlocks(items)).toBe(items);
  });
});
