import { describe, expect, it } from 'vitest';
import type { PPTElement } from '@openmaic/dsl';
import { avoidDecorativeTextOverlap } from '@/lib/edit/decorative-text-clearance';
import { migrateSlideContent } from '@/lib/edit/slide-schema';
import type { SlideContent } from '@/lib/types/stage';

const text = {
  id: 'text',
  type: 'text',
  left: 70,
  top: 180,
  width: 500,
  height: 160,
  content: '<p>完全背包</p>',
} as PPTElement;
const line = {
  id: 'orange',
  type: 'shape',
  left: 80,
  top: 220,
  width: 4,
  height: 80,
  fill: '#ED7D31',
  rotate: 0,
} as PPTElement;
describe('native orange decoration clearance', () => {
  it('moves only the overlapping orange bar into the native margin', () => {
    const original = [text, line];
    const result = avoidDecorativeTextOverlap(original);
    expect(result[0]).toBe(text);
    expect(result[1]).toEqual({ ...line, left: 56 });
    expect(original[1]).toBe(line);
    expect(avoidDecorativeTextOverlap(result)).toBe(result);
  });
  it('never reflows slides or moves text; a theme-coloured bar crossing the lines also moves to the margin', () => {
    const original = [text, { ...line, fill: '#0000FF' } as PPTElement];
    const result = avoidDecorativeTextOverlap(original);
    expect(result[0]).toBe(text);
    expect(result[1]).toMatchObject({ left: 56, fill: '#0000FF' });
    // A coloured stroke below the rendered line (inside an oversized box) stays.
    const below = [text, { ...line, top: 260, fill: '#0000FF' } as PPTElement];
    expect(avoidDecorativeTextOverlap(below)).toBe(below);
  });
  it('repairs saved schemaVersion 1 slides on load', () => {
    const slide = {
      type: 'slide',
      schemaVersion: 1,
      canvas: { viewportSize: 1000, viewportRatio: 0.5625, elements: [text, line] },
    } as unknown as SlideContent;
    const fixed = migrateSlideContent(slide);
    expect(fixed.canvas.elements[0]).toBe(text);
    expect(fixed.canvas.elements[1].left).toBe(56);
  });
  it('repairs short accents inside text and orphaned bars after native reflow', () => {
    const short = { ...line, height: 15 } as PPTElement;
    const orphan = { ...line, id: 'orphan', left: 56, top: 450 } as PPTElement;
    const fixed = avoidDecorativeTextOverlap([text, short, orphan]);
    expect(fixed[1].left).toBe(56);
    expect(fixed[2].top).toBe(220);
    expect(fixed[0]).toBe(text);
    expect(avoidDecorativeTextOverlap(fixed)).toBe(fixed);
  });
});

describe('gray divider clearance', () => {
  const para = (id: string, top: number, width = 800) =>
    ({ id, type: 'text', left: 100, top, width, height: 40, content: '<p>x</p>' }) as PPTElement;
  const rule = {
    id: 'rule',
    type: 'line',
    left: 100,
    top: 330,
    width: 1,
    start: [0, 0],
    end: [780, 0],
    color: '#cccccc',
    style: 'solid',
    points: ['', ''],
  } as unknown as PPTElement;

  it('moves a long gray rule that crosses a paragraph into the gap below it', () => {
    const items = [para('p3', 310), para('p4', 400), rule];
    const result = avoidDecorativeTextOverlap(items);
    const moved = result.find((e) => e.id === 'rule')!;
    // Into the free gap just above the paragraph, clear of all text.
    expect(moved.top).toBe(299.5);
    expect(result).not.toBe(items);
    expect(result.filter((e) => e.type === 'text')).toEqual(items.slice(0, 2));
  });

  it('leaves short gray strokes beside small labels alone; dark dividers only when they cross text', () => {
    const label = [para('label', 310, 80), rule];
    expect(avoidDecorativeTextOverlap(label)).toBe(label);
    // A dark divider drawn across a paragraph's lines (reported: lines covering text) moves.
    const dark = [para('p', 310), { ...rule, color: '#333333' } as PPTElement];
    expect(avoidDecorativeTextOverlap(dark)).not.toBe(dark);
    // Between labels it is left alone.
    const between = [para('p', 250), { ...rule, color: '#333333' } as PPTElement];
    expect(avoidDecorativeTextOverlap(between)).toBe(between);
  });
});
