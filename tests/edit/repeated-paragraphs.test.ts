import { describe, expect, it } from 'vitest';
import { removeRepeatedParagraphs } from '@/lib/edit/repeated-paragraphs';
import { fitHorizontalCanvas } from '@/lib/edit/canvas-bounds';
import { layoutReadableSlide } from '@/lib/edit/readable-slide-layout';
import type { PPTElement } from '@openmaic/dsl';

const phrase = 'Core Operations: Insertion, Deletion, and Reversal';
const box = (content: string): PPTElement => ({
  id: 'body',
  type: 'text',
  content,
  left: 60,
  top: 131,
  width: 880,
  height: 256,
  rotate: 0,
  defaultFontName: 'Arial',
  defaultColor: '#333333',
});
describe('repeated slide prose', () => {
  it('removes the reported centered echo without changing the remaining words', () => {
    const original = [
      box(
        `<div><p style="font-size:24px">${phrase}</p></div><div><p style="text-align:center">${phrase}</p></div><div><p>Nodes are interconnected via successor pointers.</p></div>`,
      ),
    ];
    const result = removeRepeatedParagraphs(original);
    expect((result[0] as Extract<PPTElement, { type: 'text' }>).content.split(phrase)).toHaveLength(
      2,
    );
    expect((result[0] as Extract<PPTElement, { type: 'text' }>).content).toContain(
      'Nodes are interconnected via successor pointers.',
    );
    expect((result[0] as Extract<PPTElement, { type: 'text' }>).content).not.toContain(
      'text-align:center',
    );
    expect(
      (original[0] as Extract<PPTElement, { type: 'text' }>).content.split(phrase),
    ).toHaveLength(3);
    expect(removeRepeatedParagraphs(result)).toBe(result);
    expect(
      (fitHorizontalCanvas(original)[0] as Extract<PPTElement, { type: 'text' }>).content,
    ).toBe((result[0] as Extract<PPTElement, { type: 'text' }>).content);
    expect(JSON.stringify(layoutReadableSlide(original)).split(phrase)).toHaveLength(2);
  });
  it('preserves intentional repeated labels, separate boxes, code, lists and comparisons', () => {
    for (const html of [
      '<p>0</p><p>0</p>',
      `<ul><li>${phrase}</li><li>${phrase}</li></ul>`,
      `<pre><code>${phrase}\n${phrase}</code></pre>`,
      `<p>${phrase}</p><p>Contrast</p><p>${phrase}</p>`,
    ]) {
      const source = [box(html)];
      expect(removeRepeatedParagraphs(source)).toBe(source);
    }
    const separate = [box(`<p>${phrase}</p>`), { ...box(`<p>${phrase}</p>`), id: 'comparison' }];
    expect(removeRepeatedParagraphs(separate)).toBe(separate);
  });
});
