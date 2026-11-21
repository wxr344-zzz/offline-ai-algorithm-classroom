import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import type { PPTElement, PPTTextElement } from '@openmaic/dsl';
import { isOrangeDecoration } from './decorative-text-clearance';
import { readableInlineMath } from './inline-math-text';

/** Native accents and dividers belong to their text block, not its obsolete
 * canvas position: when the repair moves text, a margin accent (any colour)
 * moves with its paragraph and a horizontal divider stays just below the
 * paragraph it followed (reported: dividers left crossing the reflowed text). */
function followTextAccents(original: PPTElement[], next: PPTElement[]): PPTElement[] {
  const texts = original.filter((e): e is PPTTextElement => e.type === 'text');
  const moved = (id: string) =>
    next.find((t): t is PPTTextElement => t.id === id && t.type === 'text');
  const colour = (e: PPTElement) =>
    e.type === 'shape' ? e.fill : e.type === 'line' ? e.color : undefined;
  return next.map((e) => {
    const accent =
      e.type === 'shape' &&
      !e.text &&
      !e.rotate &&
      e.width <= 8 &&
      e.height >= 12 &&
      e.height <= 160 &&
      (isOrangeDecoration(e.fill) || /^#[0-9a-f]{6}$/i.test(e.fill ?? ''));
    if (accent) {
      const anchor = texts
        .filter(
          (t) =>
            e.left >= t.left - 40 &&
            e.left <= t.left + 32 &&
            e.top < t.top + t.height &&
            e.top + e.height > t.top,
        )
        .sort((a, b) => Math.abs(a.top - e.top) - Math.abs(b.top - e.top))[0];
      const replacement = anchor && moved(anchor.id);
      if (!anchor || !replacement || replacement === anchor) return e;
      return {
        ...e,
        left: replacement.left - e.width - 10,
        top:
          replacement.top +
          Math.max(0, Math.min(e.top - anchor.top, replacement.height - e.height)),
      };
    }
    const straightLine =
      e.type === 'line' &&
      !e.points.some(Boolean) &&
      !e.curve &&
      !e.broken &&
      !e.broken2 &&
      !e.cubic &&
      Math.abs(e.end[1] - e.start[1]) <= 2 &&
      Math.abs(e.end[0] - e.start[0]) >= 120;
    const thinBar = e.type === 'shape' && !e.text && !e.rotate && e.height <= 8 && e.width >= 120;
    if (!(straightLine || thinBar) || !/^#[0-9a-f]{6}$/i.test(colour(e) ?? '')) return e;
    const y = e.type === 'line' ? e.top + Math.min(e.start[1], e.end[1]) : e.top;
    const x0 = e.type === 'line' ? e.left + Math.min(e.start[0], e.end[0]) : e.left;
    const x1 = e.type === 'line' ? e.left + Math.max(e.start[0], e.end[0]) : e.left + e.width;
    const above = texts
      .filter((t) => t.top + t.height <= y + 6 && t.left < x1 && t.left + t.width > x0)
      .sort((a, b) => b.top + b.height - (a.top + a.height))[0];
    const replacement = above && moved(above.id);
    if (!above || !replacement || replacement === above) return e;
    const target = replacement.top + replacement.height + 4;
    return { ...e, top: e.top + (target - y) };
  });
}

/** Conservative native rich-text envelope, including renderer insets, wrapping,
 * paragraph spacing and list indentation. No stripping/rewording of content. */
export function nativeTextHeight(element: PPTTextElement): number {
  const width = Math.max(40, element.width - 20),
    paragraph = element.paragraphSpace ?? 5;
  let height = 0,
    used = 0,
    line = 0;
  const flush = (empty = false, size = 16, ratio = element.lineHeight ?? 1.5) => {
    if (used || empty) {
      height += Math.max(line, size * ratio);
      used = 0;
      line = 0;
    }
  };
  function visit(
    node: DefaultTreeAdapterTypes.Node,
    size = 16,
    ratio = element.lineHeight ?? 1.5,
    indent = 0,
    bold = false,
  ) {
    if ('value' in node) {
      const text = node.value.replace(/\s+/g, ' ');
      for (const ch of text) {
        if (!used && ch === ' ') continue;
        const unit = /[^\u0000-\u00ff]/.test(ch)
          ? 1.04
          : /[MW@#]/.test(ch)
            ? 0.9
            : /[A-Z0-9]/.test(ch)
              ? 0.65
              : /\s/.test(ch)
                ? 0.34
                : 0.56;
        const advance = size * unit * (bold ? 1.04 : 1) + (element.wordSpace ?? 0);
        if (used && used + advance > Math.max(30, width - indent)) flush(false, size, ratio);
        used += advance;
        line = Math.max(line, size * ratio);
      }
      return;
    }
    if (!('childNodes' in node)) return;
    const tag = 'tagName' in node ? node.tagName : '';
    const style = 'attrs' in node ? (node.attrs.find((a) => a.name === 'style')?.value ?? '') : '';
    const font = /font-size\s*:\s*([\d.]+)(px|pt)/i.exec(style);
    if (font) size = Number(font[1]) * (font[2].toLowerCase() === 'pt' ? 4 / 3 : 1);
    const leading = /line-height\s*:\s*([\d.]+)(px)?/i.exec(style);
    if (leading) ratio = Number(leading[1]) / (leading[2] ? size : 1);
    const block = /^(p|li|h[1-6]|pre|blockquote)$/.test(tag);
    if (block) flush();
    if (tag === 'br') {
      flush(true, size, ratio);
      return;
    }
    const list = tag === 'ol' || tag === 'ul';
    for (const child of node.childNodes)
      visit(child, size, ratio, indent + (list ? 36 : 0), bold || tag === 'strong' || tag === 'b');
    if (block) {
      flush(true, size, ratio);
      height += paragraph;
    }
  }
  visit(parseFragment(element.content));
  flush();
  return Math.ceil(height + 22);
}

/**
 * HTML collapses raw line breaks, so several bullets the model separated with
 * "\n" inside one paragraph render as one run-on paragraph (reported: list
 * items squeezed into a block). Each line becomes its own paragraph with the
 * same styling; nothing is reworded.
 */
export function splitLineBreakParagraphs(html: string): string {
  if (!html.includes('\n')) return html;
  return html.replace(/<p(\s[^>]*)?>((?:(?!<\/?p[\s>])[\s\S])*?)<\/p>/g, (whole, attrs = '', inner: string) => {
    const lines = inner.split(/\s*\n\s*/).filter((line) => line.replace(/<[^>]*>/g, '').trim());
    if (lines.length < 2) return whole;
    return lines.map((line) => `<p${attrs}>${line}</p>`).join('');
  });
}

/** Repair only faulty single-column text slides. Preserve native theme, IDs,
 * rich text and horizontal layout; illustrated/multicolumn slides pass through. */
export function repairNativeTextClearance(
  elements: PPTElement[],
  width = 1000,
  height = 562.5,
): PPTElement[] {
  // Readable formulas first: the rewritten text is what gets measured below.
  let mathChanged = false;
  const readable = elements.map((e) => {
    if (e.type !== 'text') return e;
    const content = splitLineBreakParagraphs(readableInlineMath(e.content));
    if (content === e.content) return e;
    mathChanged = true;
    return { ...e, content };
  });
  return alignAccentsToRenderedText(
    repairTextLayout(mathChanged ? readable : elements, width, height),
  );
}

/** A thin orange accent marks the paragraph to its right. Models often give a
 * paragraph a box much taller than its text, then place the accent beside the
 * empty lower part of the box, so it floats between paragraphs. Keep the
 * accent's own colour and size; move it level with the rendered lines. */
export function alignAccentsToRenderedText(elements: PPTElement[]): PPTElement[] {
  const texts = elements.filter((e): e is PPTTextElement => e.type === 'text');
  let changed = false;
  const result = elements.map((e) => {
    if (
      e.type !== 'shape' ||
      e.text ||
      e.rotate ||
      e.width > 8 ||
      e.height < 12 ||
      !isOrangeDecoration(e.fill)
    )
      return e;
    const right = e.left + e.width;
    const owner = texts
      .filter(
        (t) =>
          right <= t.left + 2 &&
          t.left - right <= 40 &&
          e.top < t.top + t.height &&
          e.top + e.height > t.top,
      )
      .sort((a, b) => a.left - right - (b.left - right))[0];
    if (!owner) return e;
    // nativeTextHeight includes ~22px of renderer insets around the lines.
    const rendered = Math.min(owner.height, Math.max(nativeTextHeight(owner) - 22, 1));
    // A bar much longer than the lines it marks (sized to the box, not the
    // text) runs on below the paragraph: give it the height of the lines.
    if (e.height > rendered + 12) {
      changed = true;
      return {
        ...e,
        top: owner.top + Math.min(11, Math.max(0, owner.height - rendered)),
        height: rendered,
      };
    }
    const center = e.top + e.height / 2;
    if (center >= owner.top && center <= owner.top + rendered) return e;
    changed = true;
    return {
      ...e,
      top: owner.top + Math.max(0, (Math.min(rendered + 22, owner.height) - e.height) / 2),
    };
  });
  return changed ? result : elements;
}

function repairTextLayout(elements: PPTElement[], width = 1000, height = 562.5): PPTElement[] {
  // Generated example.com URLs are not instructional assets. Keep real image
  // elements, but never reserve an overlapping empty box for a fabricated URL.
  const cleaned = elements.filter(
    (e) =>
      !(
        e.type === 'image' && /^https?:\/\/(?:www\.)?example\.(?:com|org|net)(?:\/|$)/i.test(e.src)
      ),
  );
  if (cleaned.length !== elements.length) return repairTextLayout(cleaned, width, height);
  const text = elements.filter((e): e is PPTTextElement => e.type === 'text');
  const plain = text.every(
    (e) =>
      !e.rotate &&
      !e.vertical &&
      !/data-pptx-text-insets|<svg|<img|katex|data-math/.test(e.content),
  );
  const collides = text.some(
    (a, i) =>
      a.left < 0 ||
      a.left + a.width > width ||
      text
        .slice(i + 1)
        .some(
          (b) =>
            a.left < b.left + b.width &&
            b.left < a.left + a.width &&
            a.top < b.top + Math.max(b.height, nativeTextHeight(b)) &&
            b.top < a.top + Math.max(a.height, nativeTextHeight(a)),
        ),
  );
  // Repair faulty native text columns before the ordinary single-column pass.
  // Do not rewrite rich imported slides or healthy multicolumn compositions.
  if (
    plain &&
    collides &&
    text.length >= 2 &&
    elements.every(
      (e) =>
        e.type === 'text' ||
        e.type === 'line' ||
        e.type === 'image' ||
        (e.type === 'shape' &&
          !e.text &&
          (e.width <= 8 || e.height <= 8 || (e.width >= width * 0.85 && e.height >= height * 0.8))),
    )
  ) {
    const margin = Math.max(24, Math.min(60, ...text.map((e) => e.left)));
    const images = elements.filter((e) => e.type === 'image');
    const mediaSpace = images.length
      ? Math.min(
          height * 0.32,
          images.reduce((sum, e) => sum + e.height + 8, 0),
        )
      : 0;
    let cursor = 24;
    const normalized = [...text]
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .map((e) => {
        const next = { ...e, left: margin, width: width - margin * 2, top: cursor };
        next.height = nativeTextHeight(next);
        cursor += next.height + 8;
        return next;
      });
    const laidOut = repairTextLayout(normalized, width, height - mediaSpace);
    const byId = new Map(laidOut.map((e) => [e.id, e]));
    let mediaY = height - mediaSpace;
    images.forEach((e) => {
      const h = Math.max(1, mediaSpace / images.length - 8);
      const scale = Math.min(h / e.height, (width - 2 * margin) / e.width);
      byId.set(e.id, {
        ...e,
        left: margin,
        top: mediaY,
        width: e.width * scale,
        height: e.height * scale,
      });
      mediaY += h + 8;
    });
    return followTextAccents(
      elements,
      elements.map((e) => byId.get(e.id) ?? e),
    );
  }
  if (
    text.length < 2 ||
    text.some(
      (e) =>
        e.rotate ||
        e.vertical ||
        e.width < width * 0.6 ||
        /data-pptx-text-insets|<svg|<img|katex|data-math/.test(e.content),
    )
  )
    return elements;
  if (Math.max(...text.map((e) => e.left)) - Math.min(...text.map((e) => e.left)) > width * 0.1)
    return elements;
  if (
    elements.some(
      (e) =>
        e.type !== 'text' &&
        e.type !== 'line' &&
        !(
          e.type === 'shape' &&
          !e.text &&
          ((e.width >= width * 0.85 && e.height >= height * 0.8) || e.width <= 8 || e.height <= 8)
        ),
    )
  )
    return elements;
  const ordered = [...text].sort((a, b) => a.top - b.top);
  const envelopes = ordered.map((e) => Math.max(e.height, nativeTextHeight(e)));
  const faulty = ordered.some(
    (e, i) =>
      nativeTextHeight(e) > e.height + 2 ||
      e.top + envelopes[i] > height - 8 ||
      (i > 0 && ordered[i - 1].top + envelopes[i - 1] > e.top),
  );
  if (!faulty) return elements;
  const top = Math.max(18, Math.min(24, ordered[0].top)),
    bottom = height - 20,
    gap = 8;
  const scaled = (e: PPTTextElement, factor: number): PPTTextElement => {
    const html =
      factor === 1
        ? e.content
        : `<div style="font-size:${(16 * factor).toFixed(2)}px">${e.content.replace(/font-size\s*:\s*([\d.]+)(px|pt)/gi, (_, n, unit) => `font-size:${(Number(n) * factor).toFixed(2)}${unit}`)}</div>`;
    return { ...e, content: html, lineHeight: 1.35, paragraphSpace: 3 };
  };
  const required = (factor: number) =>
    ordered.reduce(
      (sum, e) => sum + nativeTextHeight(scaled(e, factor)),
      gap * (ordered.length - 1),
    );
  let factor = 1;
  if (required(1) > bottom - top) {
    let lo = 0.5,
      hi = 1;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (required(mid) <= bottom - top) lo = mid;
      else hi = mid;
    }
    factor = Math.floor(lo * 1000) / 1000;
  }
  let y = top;
  const replacements = new Map(
    ordered.map((e) => {
      const next = scaled(e, factor);
      next.top = y;
      next.height = nativeTextHeight(next);
      y += next.height + gap;
      return [e.id, next] as const;
    }),
  );
  return followTextAccents(
    elements,
    elements.map((e) => replacements.get(e.id) ?? e),
  );
}

const FIT_TOLERANCE = 12;
const MIN_FONT_FACTOR = 0.62;

function scaleFonts(html: string, factor: number): string {
  if (factor >= 0.999) return html;
  const scaled = html.replace(
    /font-size\s*:\s*([\d.]+)(px|pt)/gi,
    (_, n, unit) => `font-size:${(Number(n) * factor).toFixed(2)}${unit}`,
  );
  // Text without an explicit size renders at 16px.
  return /font-size\s*:/i.test(html)
    ? scaled
    : `<div style="font-size:${(16 * factor).toFixed(2)}px">${scaled}</div>`;
}

/**
 * Text that does not fit its box is shown cut off or runs over the element
 * below it (reported on illustrated and multi-column slides, which the
 * single-column repair leaves alone). Each overflowing text box grows into the
 * free space below it; when that is not enough, the elements below it in the
 * same column move down as far as the slide allows; only then do its fonts
 * shrink, just enough to fit (never below 62%). Text inside shapes shrinks to
 * fit the shape. Wording and colours stay as the model wrote them.
 */
export function fitOverflowingText(
  elements: PPTElement[],
  width = 1000,
  height = 562.5,
): PPTElement[] {
  const bottomOf = (e: PPTElement) =>
    e.type === 'line'
      ? e.top + Math.max(e.start[1], e.end[1])
      : e.top + ('height' in e ? e.height : 0);
  const spanOf = (e: PPTElement) =>
    e.type === 'line'
      ? [e.left + Math.min(e.start[0], e.end[0]), e.left + Math.max(e.start[0], e.end[0])]
      : [e.left, e.left + e.width];
  const background = (e: PPTElement) =>
    e.type === 'shape' && !e.text && e.width >= width * 0.85 && e.height >= height * 0.8;
  const items = [...elements];
  let changed = false;
  const order = items
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.type === 'text')
    .sort((a, b) => a.e.top - b.e.top)
    .map(({ i }) => i);
  for (const index of order) {
    const e = items[index] as PPTTextElement;
    if (e.rotate || e.vertical || /<svg|<img|katex|data-math/.test(e.content)) continue;
    const needed = nativeTextHeight(e);
    if (needed <= e.height + FIT_TOLERANCE) continue;
    changed = true;
    const column = items
      .map((o, i) => ({ o, i }))
      .filter(({ o, i }) => {
        if (i === index || background(o)) return false;
        const [x0, x1] = spanOf(o);
        return x0 < e.left + e.width && x1 > e.left && o.top >= e.top + 4;
      });
    const nextTop = Math.min(height - 8 + 6, ...column.map(({ o }) => o.top));
    const limit = nextTop - 6 - e.top;
    if (needed <= limit) {
      items[index] = { ...e, height: needed };
      continue;
    }
    // Move what follows in this column down, as far as the slide allows.
    const lowest = Math.max(0, ...column.map(({ o }) => bottomOf(o)));
    const shift = Math.max(0, Math.min(needed - limit, height - 8 - lowest));
    for (const { o, i } of column) items[i] = { ...o, top: o.top + shift };
    const room = Math.max(e.height, limit + shift);
    if (needed <= room) {
      items[index] = { ...e, height: needed };
      continue;
    }
    let lo = MIN_FONT_FACTOR,
      hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (nativeTextHeight({ ...e, content: scaleFonts(e.content, mid) }) <= room) lo = mid;
      else hi = mid;
    }
    const content = scaleFonts(e.content, Math.floor(lo * 1000) / 1000);
    items[index] = {
      ...e,
      content,
      height: Math.max(e.height, Math.min(room, nativeTextHeight({ ...e, content }))),
    };
  }
  for (let i = 0; i < items.length; i++) {
    const e = items[i]!;
    if (e.type !== 'shape' || !e.text?.content || e.rotate) continue;
    if (/<svg|<img|katex|data-math/.test(e.text.content)) continue;
    const probe = {
      ...e,
      type: 'text',
      content: e.text.content,
      lineHeight: e.text.lineHeight,
      paragraphSpace: e.text.paragraphSpace,
      wordSpace: e.text.wordSpace,
    } as unknown as PPTTextElement;
    if (nativeTextHeight(probe) <= e.height + FIT_TOLERANCE) continue;
    let lo = MIN_FONT_FACTOR,
      hi = 1;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      if (
        nativeTextHeight({ ...probe, content: scaleFonts(e.text.content, mid) }) <=
        e.height + FIT_TOLERANCE
      )
        lo = mid;
      else hi = mid;
    }
    changed = true;
    items[i] = {
      ...e,
      text: { ...e.text, content: scaleFonts(e.text.content, Math.floor(lo * 1000) / 1000) },
    };
  }
  return changed ? items : elements;
}
