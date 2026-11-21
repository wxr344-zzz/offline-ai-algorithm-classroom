import { describe, expect, it } from 'vitest';
import type { PPTElement } from '@openmaic/dsl';
import { keepWithinCanvas, fitHorizontalCanvas } from '@/lib/edit/canvas-bounds';
import { nativeTextHeight } from '@/lib/edit/native-text-clearance';
import slide from '../fixtures/slide-bottom-overflow.json';

const bottom = (e: PPTElement) => e.top + ('height' in e ? (e.height ?? 0) : 0);

describe('canvas bounds', () => {
  it('keeps foreground cards away from the clipped edge, without moving the full background or changing words', () => {
    const elements = [
      { id: 'background', type: 'shape', left: 0, top: 0, width: 1000, height: 562.5 },
      { id: 'card', type: 'shape', left: 100, top: 222, width: 900, height: 94 },
      {
        id: 'words',
        type: 'text',
        left: 120,
        top: 244,
        width: 800,
        height: 54,
        content: '<p>Original teaching text</p>',
      },
    ] as PPTElement[];
    const fixed = fitHorizontalCanvas(elements);
    expect(fixed[0]).toBe(elements[0]);
    expect(fixed[1].left + fixed[1].width).toBe(990);
    expect(fixed[2]).toBe(elements[2]);
    expect(fitHorizontalCanvas(fixed)).toBe(fixed);
  });
  it('brings a text box that ends below the slide back inside without dropping text', () => {
    const elements = slide as unknown as PPTElement[];
    expect(Math.max(...elements.map(bottom))).toBeGreaterThan(562.5);
    const fixed = keepWithinCanvas(elements);
    for (const e of fixed) {
      expect(bottom(e)).toBeLessThanOrEqual(552.5);
      if (e.type === 'text') expect(nativeTextHeight(e)).toBeLessThanOrEqual(e.height + 1);
    }
    // Same elements, same order of blocks, same wording.
    expect(fixed.map((e) => e.id)).toEqual(elements.map((e) => e.id));
    const order = (list: PPTElement[]) => [...list].sort((a, b) => a.top - b.top).map((e) => e.id);
    expect(order(fixed)).toEqual(order(elements));
    const text = (list: PPTElement[]) =>
      list.map((e) => (e.type === 'text' ? e.content.replace(/font-size:[\d.]+px/g, '') : ''));
    expect(text(fixed)).toEqual(text(elements));
    // The card behind the overview still encloses its bullets.
    const card = fixed.find((e) => e.type === 'shape')!;
    for (const id of ['text_ifkj3QpY', 'text_TWkjnuL4', 'text_juqXt5qq']) {
      const t = fixed.find((e) => e.id === id)!;
      expect(t.top).toBeGreaterThanOrEqual(card.top);
      expect(bottom(t)).toBeLessThanOrEqual(bottom(card) + 1);
    }
  });

  it('leaves slides that already fit untouched', () => {
    const fits = [
      {
        id: 'a',
        type: 'text',
        top: 40,
        left: 60,
        width: 880,
        height: 80,
        rotate: 0,
        content: '<p>Title</p>',
      },
    ] as unknown as PPTElement[];
    expect(keepWithinCanvas(fits)).toEqual(fits);
  });

  it('scales text uniformly when compaction alone is not enough', () => {
    const long =
      '<p style="font-size:24px">' + 'A long line of explanation text. '.repeat(60) + '</p>';
    const elements = [
      {
        id: 't',
        type: 'text',
        top: 30,
        left: 60,
        width: 880,
        height: 100,
        rotate: 0,
        content: '<p style="font-size:32px">Heading</p>',
      },
      {
        id: 'b',
        type: 'text',
        top: 140,
        left: 60,
        width: 880,
        height: 300,
        rotate: 0,
        content: long,
      },
    ] as unknown as PPTElement[];
    const fixed = keepWithinCanvas(elements);
    expect(Math.max(...fixed.map(bottom))).toBeLessThanOrEqual(552.5);
    const size = (e: PPTElement) =>
      Number(/font-size:([\d.]+)px/.exec((e as { content: string }).content)![1]);
    expect(size(fixed[0]!) / size(fixed[1]!)).toBeCloseTo(32 / 24, 1);
  });
});

describe('blocks that cover each other', () => {
  // The reported 万有引力 cover page: a label box drawn over the title, and a
  // card listed after the subtitle it should sit behind.
  const slide = [
    {
      id: 'title',
      type: 'text',
      top: 40,
      left: 60,
      width: 880,
      height: 70,
      rotate: 0,
      content: '<p style="font-size:36px"><strong>课程介绍</strong></p>',
    },
    {
      id: 'subtitle',
      type: 'text',
      top: 140,
      left: 60,
      width: 880,
      height: 56,
      rotate: 0,
      content: '<p style="font-size:24px">主题：万有引力定律</p>',
    },
    {
      id: 'label',
      type: 'shape',
      top: 70,
      left: 60,
      width: 260,
      height: 60,
      rotate: 0,
      viewBox: [1, 1],
      path: 'M0 0 L1 0 L1 1 L0 1 Z',
      fill: '#eef2f6',
      fixedRatio: false,
      text: {
        content: '<p style="text-align:center">万有引力</p>',
        defaultColor: '#1e40af',
        defaultFontName: '',
      },
    },
    {
      id: 'card',
      type: 'shape',
      top: 128,
      left: 50,
      width: 900,
      height: 70,
      rotate: 0,
      viewBox: [1, 1],
      path: 'M0 0 L1 0 L1 1 L0 1 Z',
      fill: '#f4f7fa',
      fixedRatio: false,
    },
    {
      id: 'core',
      type: 'text',
      top: 230,
      left: 80,
      width: 300,
      height: 50,
      rotate: 0,
      content: '<p style="font-size:18px">课程核心内容</p>',
    },
    {
      id: 'b1',
      type: 'text',
      top: 300,
      left: 100,
      width: 600,
      height: 60,
      rotate: 0,
      content: '<p style="font-size:20px">• 万有引力定律的原理</p>',
    },
    {
      id: 'line',
      type: 'line',
      top: 380,
      left: 60,
      width: 2,
      start: [0, 0],
      end: [880, 0],
      style: 'solid',
      color: '#ccc',
      points: ['', ''],
    },
    {
      id: 'b2',
      type: 'text',
      top: 400,
      left: 100,
      width: 600,
      height: 60,
      rotate: 0,
      content: '<p style="font-size:20px">• 实际应用与科学探索</p>',
    },
  ] as unknown as PPTElement[];

  it('keeps every block readable: no block covers another and cards sit behind their text', () => {
    const fixed = keepWithinCanvas(slide);
    const order = fixed.map((e) => e.id);
    expect(order.indexOf('card')).toBeLessThan(order.indexOf('subtitle'));
    const shown = (e: PPTElement) => ({
      top: e.top,
      bottom:
        e.type === 'text' ? e.top + nativeTextHeight(e) : e.top + ('height' in e ? e.height! : 0),
      left: e.left,
      right: e.left + ('width' in e ? e.width : 0),
    });
    const blocks = fixed.filter((e) => e.type === 'text' || (e.type === 'shape' && e.text));
    for (const [i, a] of blocks.entries())
      for (const b of blocks.slice(i + 1)) {
        const x = shown(a),
          y = shown(b);
        const overlap =
          Math.min(x.right, y.right) > Math.max(x.left, y.left) &&
          Math.min(x.bottom, y.bottom) > Math.max(x.top, y.top);
        expect(overlap, `${a.id} covers ${b.id}`).toBe(false);
      }
    const card = shown(fixed.find((e) => e.id === 'card')!);
    const sub = shown(fixed.find((e) => e.id === 'subtitle')!);
    expect(card.top).toBeLessThanOrEqual(sub.top);
    expect(card.bottom).toBeGreaterThanOrEqual(sub.bottom);
    // The divider still lies between the two bullets it separated.
    const line = fixed.find((e) => e.id === 'line')!;
    expect(line.top).toBeGreaterThan(shown(fixed.find((e) => e.id === 'b1')!).bottom - 1);
    expect(line.top).toBeLessThan(fixed.find((e) => e.id === 'b2')!.top);
    for (const e of fixed) expect(shown(e).bottom).toBeLessThanOrEqual(552.5);
  });
});

describe('cards and the text written for them', () => {
  const rect = (id: string, top: number, height: number, left = 60, width = 840) => ({
    id,
    type: 'shape',
    top,
    left,
    width,
    height,
    rotate: 0,
    viewBox: [1, 1],
    path: 'M0 0 L1 0 L1 1 L0 1 Z',
    fill: '#e8f1fb',
    fixedRatio: false,
  });
  const text = (id: string, top: number, words: string, left = 80, width = 800) => ({
    id,
    type: 'text',
    top,
    left,
    width,
    height: 60,
    rotate: 0,
    content: `<p style="font-size:20px">${words}</p>`,
  });
  const inside = (card: PPTElement, t: PPTElement) => {
    const h = nativeTextHeight(t as never);
    expect(t.top).toBeGreaterThanOrEqual(card.top);
    expect(t.top + h).toBeLessThanOrEqual(card.top + (card as { height: number }).height + 1);
  };

  it('puts a text that slid half out of its box back inside the box, instead of pushing it below', () => {
    const slide = [
      text('title', 30, '万有引力定律公式'),
      rect('card', 120, 70),
      text(
        'def',
        160,
        'G：万有引力常数，约为 6.67×10⁻¹¹ N·m²/kg²，适用于任意两个质点之间的引力计算。',
      ),
      text('after', 330, '下一部分'),
    ] as unknown as PPTElement[];
    const fixed = keepWithinCanvas(slide);
    const card = fixed.find((e) => e.id === 'card')!;
    inside(card, fixed.find((e) => e.id === 'def')!);
    expect(fixed.map((e) => e.id).indexOf('card')).toBeLessThan(
      fixed.map((e) => e.id).indexOf('def'),
    );
  });

  it('moves an empty box onto the text written just below it', () => {
    const slide = [
      text('title', 30, '公式说明'),
      rect('card', 110, 60),
      text('def', 182, 'G：万有引力常数'),
    ] as unknown as PPTElement[];
    const fixed = keepWithinCanvas(slide);
    inside(fixed.find((e) => e.id === 'card')!, fixed.find((e) => e.id === 'def')!);
  });

  it('drops a filled box that holds nothing and has no text beside it', () => {
    const slide = [
      text('title', 30, '标题'),
      rect('card', 300, 80),
      text('body', 140, '正文内容'),
    ] as unknown as PPTElement[];
    const fixed = keepWithinCanvas(slide);
    expect(fixed.map((e) => e.id)).toEqual(['title', 'body']);
  });

  it('keeps body text readable when scaling a crowded slide', () => {
    const long = (n: number) => '<p style="font-size:20px">' + '要点说明文字，'.repeat(n) + '</p>';
    const slide = [
      {
        id: 't',
        type: 'text',
        top: 20,
        left: 60,
        width: 880,
        height: 60,
        rotate: 0,
        content: '<p style="font-size:32px">标题</p>',
      },
      {
        id: 'a',
        type: 'text',
        top: 100,
        left: 60,
        width: 880,
        height: 200,
        rotate: 0,
        content: long(40),
      },
      {
        id: 'b',
        type: 'text',
        top: 320,
        left: 60,
        width: 880,
        height: 200,
        rotate: 0,
        content: long(40),
      },
    ] as unknown as PPTElement[];
    const fixed = keepWithinCanvas(slide);
    const sizes = fixed.flatMap((e) =>
      [...(e as { content: string }).content.matchAll(/font-size:([\d.]+)px/g)].map((m) =>
        Number(m[1]),
      ),
    );
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(15);
  });
});
