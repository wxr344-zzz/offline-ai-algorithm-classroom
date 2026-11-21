import { describe, expect, it } from 'vitest';
import type { PPTElement } from '@openmaic/dsl';
import { hasUnreadableSlide, layoutReadableSlide } from '@/lib/edit/readable-slide-layout';

const text = (id: string, top: number, words: string, size = 20) =>
  ({
    id,
    type: 'text',
    left: 60,
    top,
    width: 880,
    height: 70,
    rotate: 0,
    content: `<p style="font-size:${size}px">${words}</p>`,
  }) as PPTElement;
const plain = (elements: PPTElement[]) =>
  elements
    .filter((e) => e.type === 'text')
    .map((e) => e.content.replace(/<[^>]*>/g, ''))
    .join('');

describe('readable native slide layout', () => {
  it('keeps list numbering when short lists become spaced text boxes', () => {
    const body = text('body', 120, '', 18);
    if (body.type === 'text')
      body.content = '<ol start="5"><li>Observe the input.</li><li>Compare the result.</li></ol>';
    const rows = layoutReadableSlide([text('title', 30, 'Steps', 32), body]);
    const html = rows
      .filter((e) => e.type === 'text')
      .map((e) => e.content)
      .join('');
    expect(html).toContain('start="5"');
    expect(html).toContain('start="6"');
    expect(hasUnreadableSlide(rows)).toBe(false);
  });
  it('spaces a sparse list across readable paragraphs rather than leaving a compact corner block', () => {
    const body = text('body', 110, '', 18);
    if (body.type === 'text')
      body.content =
        '<p>Overview of the topic.</p><p>First key relationship.</p><p>Second key relationship.</p>';
    const result = layoutReadableSlide([text('title', 30, 'Introduction', 32), body]);
    const rows = result.filter((e) => e.type === 'text' && e.id !== 'title');
    expect(rows).toHaveLength(3);
    expect(rows[1]!.top - rows[0]!.top).toBeGreaterThan(40);
    expect(hasUnreadableSlide(result)).toBe(false);
    expect(plain(result)).toBe(plain([text('title', 30, 'Introduction', 32), body]));
  });
  it('recovers prose misplaced on a decorative shape instead of silently hiding it', () => {
    const source = [
      text('title', 30, 'Summary', 32),
      {
        id: 'divider',
        type: 'shape',
        left: 60,
        top: 320,
        width: 880,
        height: 2,
        rotate: 0,
        fill: '#cccccc',
        content: '<p>Keep every worked example visible.</p>}]',
      } as unknown as PPTElement,
    ];
    const result = layoutReadableSlide(source);
    expect(plain(result)).toContain('Keep every worked example visible.');
    expect(plain(result)).not.toContain('}]');
    expect(hasUnreadableSlide(result)).toBe(false);
  });
  it('distributes a long native list across columns without dropping or reordering items', () => {
    const points = Array.from(
      { length: 10 },
      (_, i) => `Item ${i}: ${'Explain the relationship carefully. '.repeat(2)}`,
    );
    const body = text('list', 150, points.map((s) => `<li>${s}</li>`).join(''));
    if (body.type === 'text')
      body.content = `<ul style="font-size:20px">${body.content.replace(/^<p[^>]*>|<\/p>$/g, '')}</ul>`;
    const result = layoutReadableSlide([text('title', 30, 'Summary', 32), body]);
    expect(hasUnreadableSlide(result)).toBe(false);
    for (const point of points) expect(plain(result)).toContain(point);
    const second = layoutReadableSlide(result);
    const order = points.map((point) => plain(second).indexOf(point));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it('restores unreadable generated typography without losing example data', () => {
    const source = [
      text('title', 25, 'Insertion sort', 9),
      text('example', 150, 'Input [5,2,4,1]. Compare and shift one predecessor at a time.', 5.58),
    ];
    const actual = layoutReadableSlide(source);
    expect(hasUnreadableSlide(actual)).toBe(false);
    expect(plain(actual)).toBe(plain(source));
  });
  it('does not compound shrinkage when a generated slide is checked again', () => {
    const source = [
      text('title', 30, 'Definition', 32),
      ...Array.from({ length: 5 }, (_, i) =>
        text(
          `p${i}`,
          160 + i * 100,
          `Point ${i}: ` + 'Compare items and maintain the invariant. '.repeat(3),
        ),
      ),
    ];
    const first = layoutReadableSlide(source),
      second = layoutReadableSlide(first);
    expect(hasUnreadableSlide(first)).toBe(false);
    expect(hasUnreadableSlide(second)).toBe(false);
    expect(plain(second)).toBe(plain(source));
  });
});
