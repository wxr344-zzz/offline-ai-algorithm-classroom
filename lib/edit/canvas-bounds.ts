import type { PPTElement, PPTTextElement } from '@openmaic/dsl';
import { nativeTextHeight } from './native-text-clearance';
import { removeRepeatedParagraphs } from './repeated-paragraphs';

/**
 * Last layout check before a slide is saved: every element must lie inside
 * the canvas. A text box that ends below the slide is cut off on screen (it
 * is not a browser-width problem). The slide is first compacted (empty space
 * inside oversized text boxes and between blocks is reclaimed, cards shrink
 * with their contents, side-by-side columns move together), then, only if
 * that is not enough, all text is scaled down uniformly so the hierarchy is
 * kept. Wording, order, colours and horizontal composition are unchanged.
 */
const MIN_GAP = 10;
const MARGIN = 10;
const MIN_FACTOR = 0.62;

type Box = { top: number; bottom: number; left: number; right: number };

function boxOf(e: PPTElement): Box {
  if (e.type === 'line') {
    const ys = [e.start[1], e.end[1]];
    const xs = [e.start[0], e.end[0]];
    return {
      top: e.top + Math.min(...ys),
      bottom: e.top + Math.max(...ys),
      left: e.left + Math.min(...xs),
      right: e.left + Math.max(...xs),
    };
  }
  const h = 'height' in e ? (e.height ?? 0) : 0;
  return { top: e.top, bottom: e.top + h, left: e.left, right: e.left + e.width };
}

function measurable(e: PPTElement): e is PPTTextElement {
  return (
    e.type === 'text' && !e.rotate && !e.vertical && !/<svg|<img|katex|data-math/.test(e.content)
  );
}

function scaleFonts(html: string, factor: number): string {
  if (factor >= 0.999) return html;
  const scaled = html.replace(
    /font-size\s*:\s*([\d.]+)(px|pt)/gi,
    (_, n, unit) => `font-size:${(Number(n) * factor).toFixed(2)}${unit}`,
  );
  return /font-size\s*:/i.test(html)
    ? scaled
    : `<div style="font-size:${(16 * factor).toFixed(2)}px">${scaled}</div>`;
}

interface Unit {
  index: number;
  children: Unit[];
}

/** Elements enclosed by a (non-background) shape belong to that shape's card. */
function buildTree(items: PPTElement[], width: number, height: number): Unit[] {
  const background = (e: PPTElement) =>
    e.type === 'shape' && !e.text && e.width >= width * 0.85 && e.height >= height * 0.8;
  // A text box belongs to a card by the text it shows, not its (often oversized) frame.
  const boxes = items.map((e) => (e.type === 'shape' ? boxOf(e) : occupied(e)));
  const area = (b: Box) => (b.right - b.left) * (b.bottom - b.top);
  const parent = items.map((_, i) => {
    let best = -1;
    items.forEach((s, j) => {
      if (j === i || s.type !== 'shape' || background(s) || background(items[i]!)) return;
      const a = boxes[i]!,
        b = boxes[j]!;
      const inside =
        a.top >= b.top - 2 &&
        a.bottom <= b.bottom + 2 &&
        a.left >= b.left - 2 &&
        a.right <= b.right + 2;
      if (inside && area(b) > area(a) && (best === -1 || area(b) < area(boxes[best]!))) best = j;
    });
    return best;
  });
  const units = items.map((_, index) => ({ index, children: [] as Unit[] }));
  const roots: Unit[] = [];
  units.forEach((u, i) => {
    if (background(items[i]!)) return; // stays where it is
    const p = parent[i]!;
    if (p >= 0) units[p]!.children.push(u);
    else roots.push(u);
  });
  return roots;
}

function shiftUnit(items: PPTElement[], unit: Unit, dy: number) {
  if (!dy) return;
  const e = items[unit.index]!;
  items[unit.index] = { ...e, top: e.top + dy } as PPTElement;
  for (const child of unit.children) shiftUnit(items, child, dy);
}

function extent(items: PPTElement[], unit: Unit): { top: number; bottom: number } {
  const b = boxOf(items[unit.index]!);
  let top = b.top,
    bottom = b.bottom;
  for (const c of unit.children) {
    const x = extent(items, c);
    top = Math.min(top, x.top);
    bottom = Math.max(bottom, x.bottom);
  }
  return { top, bottom };
}

/** Bands of units that overlap vertically (columns side by side) move as one. */
function compactLevel(
  items: PPTElement[],
  units: Unit[],
  startTop: number | null,
  ratio: number,
): void {
  for (const u of units) if (u.children.length) compactCard(items, u, ratio);
  const sorted = [...units].sort((a, b) => extent(items, a).top - extent(items, b).top);
  const bands: Unit[][] = [];
  let bandBottom = -Infinity;
  for (const u of sorted) {
    const x = extent(items, u);
    if (bands.length && x.top < bandBottom - 1) {
      bands[bands.length - 1]!.push(u);
      bandBottom = Math.max(bandBottom, x.bottom);
    } else {
      bands.push([u]);
      bandBottom = x.bottom;
    }
  }
  let previousBottom = startTop;
  for (const band of bands) {
    const top = Math.min(...band.map((u) => extent(items, u).top));
    const bottom = Math.max(...band.map((u) => extent(items, u).bottom));
    if (previousBottom !== null) {
      const gap = top - previousBottom;
      if (gap > MIN_GAP) {
        const target = MIN_GAP + (gap - MIN_GAP) * ratio;
        const dy = target - gap;
        for (const u of band) shiftUnit(items, u, dy);
        previousBottom = bottom + dy;
        continue;
      }
    }
    previousBottom = bottom;
  }
}

/** A card keeps its top padding; its contents are compacted and it ends just below them. */
function compactCard(items: PPTElement[], card: Unit, ratio: number) {
  const shape = items[card.index]!;
  const before = boxOf(shape);
  const contentBottomBefore = Math.max(...card.children.map((c) => extent(items, c).bottom));
  const bottomPadding = Math.min(24, Math.max(MIN_GAP, before.bottom - contentBottomBefore));
  const firstTop = Math.min(...card.children.map((c) => extent(items, c).top));
  compactLevel(items, card.children, firstTop, ratio);
  const contentBottom = Math.max(...card.children.map((c) => extent(items, c).bottom));
  const height = Math.max(8, contentBottom + bottomPadding - before.top);
  if ('height' in shape && shape.type === 'shape' && height < shape.height)
    items[card.index] = { ...shape, height } as PPTElement;
}

function layoutAt(
  elements: PPTElement[],
  factor: number,
  ratio: number,
  width: number,
  height: number,
) {
  const items = elements.map((e) => {
    if (!measurable(e)) return e;
    const content = scaleFonts(e.content, factor);
    const next = { ...e, content } as PPTTextElement;
    const needed = nativeTextHeight(next);
    // An oversized box holds empty space; an undersized one cuts its text.
    return { ...next, height: needed };
  });
  const roots = buildTree(items, width, height);
  const firstTop = roots.length ? Math.min(...roots.map((u) => extent(items, u).top)) : 0;
  compactLevel(items, roots, Math.min(firstTop, MARGIN * 2), ratio);
  return items;
}

function lowest(items: PPTElement[], width: number, height: number): number {
  return Math.max(
    0,
    ...items
      .filter(
        (e) =>
          !(e.type === 'shape' && !e.text && e.width >= width * 0.85 && e.height >= height * 0.8),
      )
      .map((e) => boxOf(e).bottom),
  );
}

const GAP = 8;

/** A shape that only decorates (a thin accent or divider) never takes part in layout. */
function decoration(e: PPTElement): boolean {
  if (e.type === 'line') return true;
  return e.type === 'shape' && !e.text?.content && (e.width <= 8 || e.height <= 8);
}

function isCard(e: PPTElement, width: number, height: number): boolean {
  return (
    e.type === 'shape' &&
    !e.text?.content &&
    !decoration(e) &&
    !(e.width >= width * 0.85 && e.height >= height * 0.8)
  );
}

/** The box a block really occupies: a text box by its rendered text, others by their frame. */
function occupied(e: PPTElement): Box {
  const b = boxOf(e);
  // Text is drawn from the top of its box: it ends where its lines end, inside or below the frame.
  if (measurable(e)) return { ...b, bottom: e.top + nativeTextHeight(e) };
  return b;
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Cards drawn over the text they hold (the model listed the background after
 * the text) hide it: such a card moves behind that text and grows to hold it.
 * Then blocks that still cover each other (a label box over the title, two
 * text boxes on the same lines) are separated: the lower block and everything
 * below it move down. Reading order, columns and wording stay as written.
 */
export function separateOverlaps(
  elements: PPTElement[],
  width = 1000,
  height = 562.5,
): PPTElement[] {
  let items = [...elements];
  // 1. Cards and the text they belong to. A card holds a text that lies across
  //    it horizontally and touches it vertically (models often place the text
  //    half out of its box, or just below an empty one): the card moves behind
  //    the text and grows around it, instead of the text being pushed out of it.
  const textual = (e: PPTElement) => e.type === 'text' || (e.type === 'shape' && !!e.text?.content);
  const horizontallyIn = (b: Box, c: Box) =>
    Math.min(b.right, c.right) - Math.max(b.left, c.left) >= 0.8 * (b.right - b.left);
  const drop = new Set<PPTElement>();
  for (let i = 0; i < items.length; i++) {
    const card = items[i]!;
    if (!isCard(card, width, height)) continue;
    const c = boxOf(card);
    const empty = !items.some(
      (e, j) =>
        j !== i &&
        !decoration(e) &&
        overlapArea(occupied(e), c) > 0 &&
        !(e.type === 'shape' && e.width >= width * 0.85 && e.height >= height * 0.8),
    );
    let held = items
      .map((e, j) => ({ e, j }))
      .filter(({ e, j }) => {
        if (j === i || !textual(e)) return false;
        const b = occupied(e);
        if (!horizontallyIn(b, c)) return false;
        const shared = Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top);
        // A real share of the text sits on the card (not a hairline from rounding).
        return shared >= Math.min(16, 0.3 * (b.bottom - b.top));
      });
    if (!held.length && empty) {
      // An empty box right above or below a text is that text's box.
      const near = items
        .map((e, j) => ({ e, j }))
        .filter(({ e, j }) => {
          if (j === i || !textual(e)) return false;
          const b = occupied(e);
          const gap = Math.min(Math.abs(b.top - c.bottom), Math.abs(c.top - b.bottom));
          return horizontallyIn(b, c) && gap <= 48;
        })
        .sort(
          (a, b) => Math.abs(occupied(a.e).top - c.bottom) - Math.abs(occupied(b.e).top - c.bottom),
        );
      if (near.length) {
        const t = occupied(near[0]!.e);
        // The box moves onto its text (keeping the text where it is).
        items[i] = { ...card, top: t.top - 10, height: t.bottom - t.top + 20 } as PPTElement;
        held = [near[0]!];
      } else {
        // A box with nothing in it carries no content (and reads as a layout error).
        drop.add(card);
        continue;
      }
    }
    if (!held.length) continue;
    const cardNow = items[i]!;
    const cb = boxOf(cardNow);
    const top = Math.min(cb.top, ...held.map(({ e }) => occupied(e).top - 8));
    const bottom = Math.max(cb.bottom, ...held.map(({ e }) => occupied(e).bottom + 8));
    const grown = { ...cardNow, top, height: bottom - top } as PPTElement;
    const firstText = Math.min(...held.map(({ j }) => j));
    if (firstText < i) {
      items.splice(i, 1);
      items.splice(firstText, 0, grown);
    } else items[i] = grown;
  }
  if (drop.size) items = items.filter((e) => !drop.has(e));
  // 2. Blocks of the same level that still cover each other.
  const roots = buildTree(items, width, height);
  const separate = (units: Unit[]) => {
    for (const u of units) if (u.children.length) separate(u.children);
    const blocks = units.filter((u) => !decoration(items[u.index]!));
    blocks.sort((a, b) => extent(items, a).top - extent(items, b).top || a.index - b.index);
    for (let k = 1; k < blocks.length; k++) {
      const u = blocks[k]!;
      const ub = unitBox(items, u);
      let push = 0;
      for (const v of blocks.slice(0, k)) {
        const vb = unitBox(items, v);
        if (overlapArea(ub, vb) > 0) push = Math.max(push, vb.bottom + GAP - ub.top);
      }
      if (push <= 0) continue;
      // Everything from this block down (dividers and accents too) moves together.
      const from = ub.top;
      const placed = new Set(blocks.slice(0, k));
      for (const w of units)
        if (!placed.has(w) && extent(items, w).top >= from - 0.5) shiftUnit(items, w, push);
    }
  };
  separate(roots);
  // A card whose contents moved down still holds them.
  const grow = (units: Unit[]) => {
    for (const u of units) {
      if (!u.children.length) continue;
      grow(u.children);
      const card = items[u.index]!;
      const bottom = Math.max(...u.children.map((c) => unitBox(items, c).bottom)) + 8;
      if ('height' in card && card.top + card.height < bottom)
        items[u.index] = { ...card, height: bottom - card.top } as PPTElement;
    }
  };
  grow(roots);
  return items;
}

function unitBox(items: PPTElement[], unit: Unit): Box {
  const own = occupied(items[unit.index]!);
  return unit.children.reduce((b, c) => {
    const x = unitBox(items, c);
    return {
      top: Math.min(b.top, x.top),
      bottom: Math.max(b.bottom, x.bottom),
      left: Math.min(b.left, x.left),
      right: Math.max(b.right, x.right),
    };
  }, own);
}

/** Foreground text/cards need an inset; full-slide backgrounds stay full bleed.
 * Also used on read so saved edge-touching cards need no database rewrite. */
export function fitHorizontalCanvas(
  elements: PPTElement[],
  width = 1000,
  height = 562.5,
): PPTElement[] {
  elements = removeRepeatedParagraphs(elements);
  let changed = false;
  const items = elements.map((e) => {
    if (e.type === 'line' || !('width' in e)) return e;
    const background =
      e.type === 'shape' && !e.text && e.width >= width * 0.85 && e.height >= height * 0.8;
    const inset = !background && (e.type === 'text' || e.type === 'shape') ? MARGIN : 0;
    if (e.left >= inset && e.left + e.width <= width - inset) return e;
    const w = Math.min(e.width, width - 2 * MARGIN);
    const left = Math.min(Math.max(MARGIN, e.left), width - MARGIN - w);
    changed = true;
    return { ...e, left, width: w } as PPTElement;
  });
  return changed ? items : elements;
}

/** Display-only projection for document-backed playback and thumbnails, which
 * read CRDT slides directly rather than the legacy migration store. */
export function fitSlideForeground<
  T extends { elements: PPTElement[]; viewportSize: number; viewportRatio: number },
>(slide: T): T {
  const elements = fitHorizontalCanvas(
    slide.elements,
    slide.viewportSize,
    slide.viewportSize * slide.viewportRatio,
  );
  return elements === slide.elements ? slide : { ...slide, elements };
}

export function keepWithinCanvas(
  elements: PPTElement[],
  width = 1000,
  height = 562.5,
): PPTElement[] {
  const limit = height - MARGIN;
  // Horizontal: a box running past the right edge is moved back (or narrowed).
  let items = fitHorizontalCanvas(elements, width, height);
  items = separateOverlaps(items, width, height);
  if (lowest(items, width, height) <= limit) return items;
  // Reclaim space first (keep as much of the original spacing as fits), then scale text.
  const fits = (factor: number, ratio: number) =>
    lowest(layoutAt(items, factor, ratio, width, height), width, height) <= limit;
  if (fits(1, 0)) {
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (fits(1, mid)) lo = mid;
      else hi = mid;
    }
    return layoutAt(items, 1, lo, width, height);
  }
  // Text is scaled only as far as it stays readable: body text no smaller than
  // 15px when that fits (the reported slide shrank to ~12px); below that only
  // when nothing else fits.
  const sizes = items
    .filter(measurable)
    .flatMap((e) =>
      [...(e as PPTTextElement).content.matchAll(/font-size\s*:\s*([\d.]+)px/gi)].map((m) =>
        Number(m[1]),
      ),
    );
  const smallest = sizes.length ? Math.min(...sizes) : 16;
  const floor = Math.min(1, Math.max(MIN_FACTOR, 15 / smallest));
  let lo = fits(floor, 0) ? floor : MIN_FACTOR,
    hi = lo === floor ? 1 : floor;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid, 0)) lo = mid;
    else hi = mid;
  }
  items = layoutAt(items, Math.floor(lo * 1000) / 1000, 0, width, height);
  // Still too tall at the smallest readable size (e.g. a large image): lift the
  // lowest blocks so nothing ends below the slide.
  const over = lowest(items, width, height) - limit;
  if (over > 0) {
    const roots = buildTree(items, width, height);
    for (const u of roots) {
      const x = extent(items, u);
      if (x.bottom > limit) shiftUnit(items, u, Math.max(-over, MARGIN - x.top));
    }
  }
  return items;
}
