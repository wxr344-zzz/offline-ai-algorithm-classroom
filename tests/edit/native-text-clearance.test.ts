import { describe, it, expect } from 'vitest';
import type { PPTElement, PPTTextElement, PPTShapeElement } from '@openmaic/dsl';
import fixture from '@/tests/fixtures/knapsack-overlapping-slides.json';
import bst from '@/tests/fixtures/bst-overlapping-slide.json';
import { nativeTextHeight, repairNativeTextClearance } from '@/lib/edit/native-text-clearance';

describe('native PPT text clearance: actual reported 01 knapsack slides', () => {
  for (const slide of fixture)
    it(slide.title, () => {
      const original = slide.canvas.elements as PPTElement[];
      const before = JSON.stringify(original);
      const fixed = repairNativeTextClearance(original);
      expect(JSON.stringify(original)).toBe(before);
      const text = fixed
        .filter((e): e is PPTTextElement => e.type === 'text')
        .sort((a, b) => a.top - b.top);
      text.forEach((e, i) => {
        expect(e.top + e.height).toBeLessThanOrEqual(542.5);
        expect(nativeTextHeight(e)).toBeLessThanOrEqual(e.height);
        if (i) expect(text[i - 1].top + text[i - 1].height).toBeLessThan(e.top);
        const previous = original.find((x) => x.id === e.id) as PPTTextElement;
        expect(e.content.replace(/<[^>]*>/g, '')).toBe(previous.content.replace(/<[^>]*>/g, ''));
        expect([e.left, e.width, e.defaultColor, e.defaultFontName]).toEqual([
          previous.left,
          previous.width,
          previous.defaultColor,
          previous.defaultFontName,
        ]);
      });
      expect(repairNativeTextClearance(fixed)).toBe(fixed);
    });
  it('preserves healthy slides and illustrated layouts', () => {
    const text = { ...(fixture[0].canvas.elements[0] as PPTTextElement), top: 20, height: 76 };
    const a = [text, { ...text, id: 'body', top: 120 }];
    expect(repairNativeTextClearance(a)).toBe(a);
    const image = {
      type: 'image',
      id: 'diagram',
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    } as PPTElement;
    const b = [...a, image];
    expect(repairNativeTextClearance(b)).toBe(b);
  });
  it('keeps a native accent attached when its paragraph is moved', () => {
    const original = fixture[0].canvas.elements as PPTElement[];
    const body = original.filter((e): e is PPTTextElement => e.type === 'text')[1];
    const accent = {
      id: 'attached-accent',
      type: 'shape',
      left: body.left - 16,
      top: body.top + 10,
      width: 4,
      height: 20,
      fill: '#ed7d31',
      rotate: 0,
    } as PPTElement;
    const fixed = repairNativeTextClearance([...original, accent]);
    const moved = fixed.find((e): e is PPTTextElement => e.id === body.id && e.type === 'text')!;
    const bar = fixed.find((e): e is PPTShapeElement => e.id === accent.id && e.type === 'shape')!;
    expect(bar.left + bar.width + 10).toBe(moved.left);
    expect(bar.top).toBe(moved.top + 10);
    expect(bar.top + bar.height).toBeLessThanOrEqual(moved.top + moved.height);
    expect(repairNativeTextClearance(fixed)).toBe(fixed);
  });
  it('repairs the reported overlapping BST columns and removes fabricated example image URLs', () => {
    const original = bst.elements as PPTElement[];
    const fixed = repairNativeTextClearance(original);
    const text = fixed
      .filter((e): e is PPTTextElement => e.type === 'text')
      .sort((a, b) => a.top - b.top);
    text.forEach((e, i) => {
      expect(e.left + e.width).toBeLessThanOrEqual(1000);
      expect(e.top + nativeTextHeight(e)).toBeLessThanOrEqual(562.5);
      if (i) expect(text[i - 1].top + nativeTextHeight(text[i - 1])).toBeLessThan(e.top);
    });
    expect(fixed.some((e) => e.type === 'image' && e.src.includes('example.com'))).toBe(false);
    expect(repairNativeTextClearance(fixed)).toBe(fixed);
  });
});

describe('accent bars follow the paragraph text they mark', () => {
  const text = (id: string, top: number, height: number, words: string) =>
    ({
      id,
      type: 'text',
      left: 110,
      top,
      width: 800,
      height,
      rotate: 0,
      content: `<p style="font-size:20px">${words}</p>`,
      defaultFontName: 'Microsoft YaHei',
      defaultColor: '#333333',
    }) as PPTElement;
  const bar = (id: string, top: number) =>
    ({
      id,
      type: 'shape',
      left: 75,
      top,
      width: 4,
      height: 30,
      rotate: 0,
      viewBox: [200, 200],
      path: 'M 0 0 L 200 0 L 200 200 L 0 200 Z',
      fixedRatio: false,
      fill: '#E67E22',
    }) as PPTElement;
  // As in the reported slide: the first paragraph's box is far taller than its
  // single line, and its accent sits beside the empty lower part of the box.
  const slide = [
    text('title', 100, 70, '切比雪夫不等式简介'),
    text('p1', 213, 130, '切比雪夫不等式是一个概率论中的基本不等式。'),
    bar('accent-1', 300),
    text('p2', 360, 60, '该不等式在统计学和数据分析中非常有用。'),
    bar('accent-2', 362),
  ];

  it('moves a floating accent level with its paragraph’s rendered line', () => {
    const fixed = repairNativeTextClearance(slide);
    const accent = fixed.find((e) => e.type === 'shape' && e.id === 'accent-1')! as Extract<
      PPTElement,
      { type: 'shape' }
    >;
    expect(accent.top).toBeGreaterThanOrEqual(213);
    expect(accent.top + accent.height).toBeLessThanOrEqual(213 + 60);
    expect(accent).toMatchObject({ left: 75, width: 4, height: 30, fill: '#E67E22' });
    // Text is never moved or rewritten by the accent pass.
    expect(fixed.filter((e) => e.type === 'text')).toEqual(slide.filter((e) => e.type === 'text'));
  });

  it('shortens a bar that runs on far below the lines it marks (reported: 梯度下降算法简介)', () => {
    const para = {
      ...text('p', 180, 220, ''),
      content:
        '<p style="font-size:20px">梯度下降算法是一种用于最小化函数的优化算法。</p><p style="font-size:20px">其基本原理是通过不断调整参数，使得函数值不断减小。</p><p style="font-size:20px">常见的应用场景包括机器学习中的参数优化。</p>',
    } as PPTElement;
    const long = { ...bar('long', 175), height: 200 } as PPTElement;
    const fixed = repairNativeTextClearance([
      text('title', 60, 70, '梯度下降算法简介'),
      para,
      long,
    ]);
    const accent = fixed.find((e) => e.type === 'shape' && e.id === 'long')! as Extract<
      PPTElement,
      { type: 'shape' }
    >;
    expect(accent.height).toBeLessThan(140);
    expect(accent.top).toBeGreaterThanOrEqual(180);
    expect(accent.top + accent.height).toBeLessThanOrEqual(180 + 140);
  });

  it('leaves an accent that already marks its text unchanged', () => {
    const fixed = repairNativeTextClearance(slide);
    expect(fixed.find((e) => e.id === 'accent-2')).toEqual(slide[4]);
  });
});

describe('text that does not fit its box (reported: text cut off on illustrated slides)', () => {
  const long = '<p>' + '这是一段比较长的讲解文字，'.repeat(12) + '</p>';
  const box = (top: number, height: number, content = long) =>
    ({ id: `t${top}`, type: 'text', left: 60, top, width: 420, height, content }) as PPTTextElement;
  it('grows into free space below, or shrinks its fonts when the space is taken', async () => {
    const { fitOverflowingText, nativeTextHeight } =
      await import('@/lib/edit/native-text-clearance');
    const alone = [box(100, 60)];
    const grown = fitOverflowingText(alone)[0] as PPTTextElement;
    expect(grown.height).toBe(nativeTextHeight(alone[0]!));
    expect(grown.content).toBe(alone[0]!.content);
    // The paragraph below moves down to make room; nothing overlaps.
    const crowded = [box(100, 60), box(170, 40, '<p>下一段</p>')];
    const [first, second] = fitOverflowingText(crowded) as PPTTextElement[];
    expect(first!.content).toBe(crowded[0]!.content);
    expect(first!.top + first!.height).toBeLessThanOrEqual(second!.top);
    // A full column: the fonts shrink just enough, still without overlap.
    const full = [box(100, 60), box(170, 380, '<p>下一段</p>')];
    const [tight, next] = fitOverflowingText(full) as PPTTextElement[];
    expect(tight!.content).toContain('font-size');
    expect(tight!.top + tight!.height).toBeLessThanOrEqual(next!.top);
    const fits = [box(100, 400)];
    expect(fitOverflowingText(fits)).toBe(fits);
  });
});

describe('line-break bullets', () => {
  it('turns bullets joined by raw line breaks into separate paragraphs', async () => {
    const { splitLineBreakParagraphs } = await import('@/lib/edit/native-text-clearance');
    const html =
      '<p style="font-size:20px">● 递归与栈：先序、中序、后序。\n● 层序遍历：借助队列。\n\n● 核心特性：节点集合相同。</p>';
    expect(splitLineBreakParagraphs(html)).toBe(
      '<p style="font-size:20px">● 递归与栈：先序、中序、后序。</p><p style="font-size:20px">● 层序遍历：借助队列。</p><p style="font-size:20px">● 核心特性：节点集合相同。</p>',
    );
    expect(splitLineBreakParagraphs('<p>one line</p>')).toBe('<p>one line</p>');
  });
});
