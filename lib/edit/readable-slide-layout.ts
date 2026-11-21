import { parseFragment, serialize, type DefaultTreeAdapterTypes } from 'parse5';
import type { PPTElement, PPTTextElement } from '@openmaic/dsl';
import { keepWithinCanvas } from './canvas-bounds';
import { nativeTextHeight, splitLineBreakParagraphs } from './native-text-clearance';
import { readableInlineMath } from './inline-math-text';
import { removeRepeatedParagraphs } from './repeated-paragraphs';

export const MIN_BODY_FONT = 18;

/** Give short prose slides breathing room without moving diagrams or node labels. */
function balanceSparseSlide(elements: PPTElement[], width: number, height: number): PPTElement[] {
  if (
    elements.some(
      (e) =>
        e.type !== 'text' &&
        !(e.type === 'shape' && !e.text && e.width >= width * 0.85 && e.height >= height * 0.8),
    )
  )
    return elements;
  const texts = elements.filter((e): e is PPTTextElement => e.type === 'text');
  if (texts.length < 2 || texts.some((e) => e.rotate || e.vertical)) return elements;
  const title = [...texts].sort((a, b) => a.top - b.top)[0]!;
  const body = texts.filter((e) => e !== title);
  if (body.some((e) => /<(?:pre|code)\b/i.test(e.content))) return elements;
  // Deliberately arranged columns are already a layout, not a compact prose block.
  if (
    body.some((a, i) =>
      body.slice(i + 1).some((b) => a.left + a.width < b.left || b.left + b.width < a.left),
    )
  )
    return elements;
  const fragments: PPTTextElement[] = [];
  for (const text of body) {
    const blocks: DefaultTreeAdapterTypes.Node[] = [];
    const collect = (node: DefaultTreeAdapterTypes.Node) => {
      if ('tagName' in node && /^(p|li|pre|blockquote|h[1-6])$/.test(node.tagName))
        blocks.push(node);
      else if ('childNodes' in node) node.childNodes.forEach(collect);
    };
    collect(parseFragment(text.content));
    if (!blocks.length) blocks.push(parseFragment(text.content));
    blocks.forEach((node, i) => {
      const root = parseFragment('');
      if (
        'tagName' in node &&
        node.tagName === 'li' &&
        node.parentNode &&
        'tagName' in node.parentNode &&
        /^(ul|ol)$/.test(node.parentNode.tagName)
      ) {
        const parent = node.parentNode;
        const index = parent.childNodes
          .filter((n) => 'tagName' in n && n.tagName === 'li')
          .indexOf(node);
        root.childNodes = [
          {
            ...parent,
            childNodes: [node],
            attrs:
              parent.tagName === 'ol'
                ? [
                    ...parent.attrs.filter((a) => a.name !== 'start'),
                    {
                      name: 'start',
                      value: String(
                        Number(parent.attrs.find((a) => a.name === 'start')?.value ?? 1) + index,
                      ),
                    },
                  ]
                : parent.attrs,
          },
        ];
      } else
        root.childNodes =
          node.nodeName === '#document-fragment'
            ? (node as DefaultTreeAdapterTypes.DocumentFragment).childNodes
            : [node as DefaultTreeAdapterTypes.ChildNode];
      const html = serialize(root);
      if (!html.replace(/<[^>]*>/g, '').trim()) return;
      fragments.push({
        ...text,
        id: i ? `${text.id}-spaced-${i}` : text.id,
        content: html,
        left: 60,
        width: width - 120,
        lineHeight: 1.4,
        paragraphSpace: 6,
      });
    });
  }
  if (!fragments.length || fragments.length > 8) return elements;
  const top = Math.max(130, title.top + nativeTextHeight(title) + 36);
  const room = height - 40 - top;
  const measured = fragments.map((e) => ({ ...e, content: sized(e.content, 24, 30) }));
  const total = measured.reduce((sum, e) => sum + nativeTextHeight(e), 0);
  const gap = Math.min(28, Math.max(16, (room - total) / Math.max(1, measured.length + 1)));
  if (total + gap * (measured.length - 1) > room || total > room * 0.7) {
    // Several short paragraphs can fit comfortably in one box while separate
    // boxes pay the renderer's 20px inset each time. Keep all content, including
    // lower-page captions, together instead of leaving scattered footer labels.
    for (const font of [24, 22, 20]) {
      const merged = {
        ...body[0]!,
        left: 60,
        top,
        width: width - 120,
        lineHeight: 1.45,
        paragraphSpace: 12,
        content: fragments.map((e) => sized(e.content, font, 30)).join(''),
      };
      merged.height = nativeTextHeight(merged);
      if (merged.height > room * 0.9) continue;
      const candidate = [...elements.filter((e) => e.type !== 'text'), title, merged];
      if (!hasUnreadableSlide(candidate, width, height)) return candidate;
    }
    return elements;
  }
  let y = top + Math.min(32, Math.max(0, (room - total - gap * (measured.length - 1)) / 3));
  const arranged = measured.map((e) => {
    const next = { ...e, top: y, height: nativeTextHeight(e) };
    y += next.height + gap;
    return next;
  });
  const result = [...elements.filter((e) => e.type !== 'text'), title, ...arranged];
  return hasUnreadableSlide(result, width, height) ? elements : result;
}

function sized(html: string, minimum: number, maximum = 48): string {
  const content = html.replace(
    /font-size\s*:\s*([\d.]+)(px|pt)/gi,
    (_, n, unit) =>
      `font-size:${Math.max(minimum, Math.min(maximum, Number(n) * (unit.toLowerCase() === 'pt' ? 4 / 3 : 1)))}px`,
  );
  return `<div style="font-size:${minimum}px">${content}</div>`;
}

export function hasUnreadableSlide(elements: PPTElement[], width = 1000, height = 562.5): boolean {
  const texts = elements.filter(
    (e): e is PPTTextElement => e.type === 'text' && !e.rotate && !e.vertical,
  );
  return texts.some((e, i) => {
    const sizes = [...e.content.matchAll(/font-size\s*:\s*([\d.]+)(px|pt)/gi)].map(
      (m) => Number(m[1]) * (m[2]!.toLowerCase() === 'pt' ? 4 / 3 : 1),
    );
    const h = nativeTextHeight(e);
    return (
      sizes.some((size) => size < MIN_BODY_FONT - 0.05) ||
      e.left < 0 ||
      e.left + e.width > width + 1 ||
      e.top < 0 ||
      e.top + h > height - 8 ||
      h > e.height + 2 ||
      texts
        .slice(i + 1)
        .some(
          (other) =>
            e.left < other.left + other.width - 2 &&
            other.left < e.left + e.width - 2 &&
            e.top < other.top + nativeTextHeight(other) - 2 &&
            other.top < e.top + h - 2,
        )
    );
  });
}

/** One typography pass for generated slides. Reflow from the unshrunk source,
 * never feed one repair's smaller fonts into another repair. */
export function recoverSlideText(elements: PPTElement[]): PPTElement[] {
  // Some generated cards put their prose in a stray `content` property rather
  // than native shape.text. The renderer ignores it: recover a real text node
  // before measuring, instead of reporting a title-only page as readable.
  return elements.flatMap((element) => {
    const content = (element as PPTElement & { content?: unknown }).content;
    if (!['shape', 'line'].includes(element.type) || typeof content !== 'string' || !content.trim())
      return [element];
    const { content: _, ...native } = element as PPTElement & { content: string };
    return [
      native as PPTElement,
      {
        id: `${element.id}-recovered-text`,
        type: 'text',
        left: element.left,
        top: element.top,
        width: Math.max(100, element.width),
        height: 40,
        rotate: 0,
        content: content.replace(/(?<=>)[\s\]}]+$/, ''),
        defaultFontName: 'Microsoft YaHei',
        defaultColor: '#333333',
      } as PPTTextElement,
    ];
  });
}

export function layoutReadableSlide(
  elements: PPTElement[],
  width = 1000,
  height = 562.5,
): PPTElement[] {
  elements = removeRepeatedParagraphs(recoverSlideText(elements));
  const headingId = elements
    .filter((e) => e.type === 'text')
    .sort((a, b) => a.top - b.top || a.left - b.left)[0]?.id;
  const source = elements.map((e) =>
    e.type === 'text'
      ? {
          ...e,
          content: sized(
            splitLineBreakParagraphs(readableInlineMath(e.content)),
            e.id === headingId ? 28 : MIN_BODY_FONT,
          ),
        }
      : e,
  );
  const first = keepWithinCanvas(source, width, height - 12);
  if (!hasUnreadableSlide(first, width, height)) return balanceSparseSlide(first, width, height);
  // A topology drawn with labelled shapes is not a text/card slide. Rewriting
  // it into columns would discard its node/edge meaning; let the content
  // repair shorten it while keeping the native structure instead.
  if (source.some((e) => e.type === 'shape' && e.text?.content)) return first;
  // Faulty text/card slides can reclaim their entire canvas rather than repeat
  // percentage reductions. Illustrations are kept in a reserved side column.
  const nativeTexts = source.filter(
    (e): e is PPTTextElement => e.type === 'text' && !e.rotate && !e.vertical,
  );
  // The native element sequence carries paragraph order. Sorting a previous
  // two-column layout by y would interleave its left and right paragraphs.
  const texts = [
    ...nativeTexts.filter((e) => e.id === headingId),
    ...nativeTexts.filter((e) => e.id !== headingId),
  ];
  if (!texts.length) return first;
  const margin = 32,
    gap = 20;
  const heading = {
    ...texts[0]!,
    left: margin,
    top: margin,
    width: width - margin * 2,
    lineHeight: 1.2,
    paragraphSpace: 2,
    content: sized(texts[0]!.content, 28, 36),
  };
  heading.height = nativeTextHeight(heading);
  const top = heading.top + heading.height + 16;
  const media = source.filter((e) => !['text', 'shape', 'line'].includes(e.type));
  const body = texts.slice(1);
  const fragments: PPTTextElement[] = [];
  for (const text of body) {
    const root = parseFragment(text.content);
    // Split only top-level semantic paragraphs; inline emphasis and lists remain intact.
    const blocks: DefaultTreeAdapterTypes.Node[] = [];
    const collect = (node: DefaultTreeAdapterTypes.Node) => {
      if ('tagName' in node && /^(ul|ol)$/.test(node.tagName)) {
        node.childNodes
          .filter((child) => 'tagName' in child && child.tagName === 'li')
          .forEach((child, index) =>
            blocks.push({
              ...node,
              childNodes: [child],
              attrs:
                node.tagName === 'ol'
                  ? [
                      ...node.attrs.filter((a) => a.name !== 'start'),
                      {
                        name: 'start',
                        value: String(
                          Number(node.attrs.find((a) => a.name === 'start')?.value ?? 1) + index,
                        ),
                      },
                    ]
                  : node.attrs,
            }),
          );
      } else if ('tagName' in node && /^(p|pre|blockquote|h[1-6])$/.test(node.tagName))
        blocks.push(node);
      else if ('childNodes' in node) node.childNodes.forEach(collect);
      else if ('value' in node && node.value.trim()) blocks.push(node);
    };
    collect(root);
    if (!blocks.length) blocks.push(root);
    blocks.forEach((node, index) => {
      const fragment = parseFragment('');
      fragment.childNodes =
        node.nodeName === '#document-fragment'
          ? (node as DefaultTreeAdapterTypes.DocumentFragment).childNodes
          : [node as DefaultTreeAdapterTypes.ChildNode];
      fragments.push({
        ...text,
        id: index ? `${text.id}-paragraph-${index}` : text.id,
        content: sized(serialize(fragment), MIN_BODY_FONT, 24),
        lineHeight: 1.25,
        paragraphSpace: 3,
      });
    });
  }
  const arrange = (columns: number): PPTElement[] => {
    const columnWidth = media.length
      ? (width - 3 * margin) * 0.63
      : (width - 2 * margin - gap * (columns - 1)) / columns;
    let column = 0,
      y = top;
    const arranged: PPTElement[] = [heading];
    let active: PPTTextElement | undefined;
    for (const text of fragments) {
      const next = {
        ...text,
        width: columnWidth,
        left: margin + column * (columnWidth + gap),
        top: y,
      };
      next.height = nativeTextHeight(next);
      // Native text boxes each reserve their own renderer insets. Keep adjacent
      // paragraphs in one column box rather than paying that inset per bullet.
      if (active) {
        const merged = { ...active, content: active.content + next.content };
        merged.height = nativeTextHeight(merged);
        if (merged.top + merged.height <= height - margin) {
          Object.assign(active, merged);
          y = active.top + active.height + 8;
          continue;
        }
      }
      if (y + next.height > height - margin && y > top && column < columns - 1) {
        column++;
        y = top;
        next.left = margin + column * (columnWidth + gap);
        next.top = y;
      }
      arranged.push(next);
      active = next;
      y += next.height + 8;
    }
    const backgrounds = source.filter(
      (e) => e.type === 'shape' && !e.text && e.width >= width * 0.85 && e.height >= height * 0.8,
    );
    const pictures = media.map((e, i) => {
      if (!('height' in e)) return e;
      const roomWidth = width - columnWidth - 3 * margin;
      const roomHeight = (height - top - margin) / media.length;
      const scale = Math.min(roomWidth / e.width, roomHeight / Math.max(1, e.height ?? 1), 1);
      return {
        ...e,
        left: width - margin - roomWidth,
        top: top + i * roomHeight,
        width: e.width * scale,
        height: (e.height ?? 1) * scale,
      } as PPTElement;
    });
    return [...backgrounds, ...arranged, ...pictures];
  };
  const full = arrange(1);
  if (!hasUnreadableSlide(full, width, height) || media.length)
    return balanceSparseSlide(full, width, height);
  return arrange(2);
}
