import type { PPTElement } from '@openmaic/dsl';
import { nativeTextHeight } from './native-text-clearance';

export function isOrangeDecoration(color: string | undefined): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(color ?? '')?.[1];
  return Boolean(
    hex &&
    parseInt(hex.slice(0, 2), 16) >= 180 &&
    parseInt(hex.slice(2, 4), 16) >= 60 &&
    parseInt(hex.slice(2, 4), 16) <= 215 &&
    parseInt(hex.slice(4), 16) <= 125,
  );
}

/** A light or mid gray rule (divider, underline) — never meant to cross text. */
export function isNeutralRule(color: string | undefined): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(color ?? '')?.[1];
  if (!hex) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (
    Math.max(r!, g!, b!) - Math.min(r!, g!, b!) <= 24 &&
    Math.min(r!, g!, b!) >= 0x90 &&
    Math.max(r!, g!, b!) <= 0xf2
  );
}

/** Move only thin orange decoration (and gray rules) out of text. Native typography, element
 * order, text, diagrams, connectors and all other slide design stay intact. */
export function avoidDecorativeTextOverlap(
  elements: PPTElement[],
  width = 1000,
  height = 562.5,
): PPTElement[] {
  const text = elements.filter((e) => e.type === 'text');
  const overlap = (
    a: { x: number; y: number; w: number; h: number },
    b: { left: number; top: number; width: number; height: number },
  ) => a.x < b.left + b.width && a.x + a.w > b.left && a.y < b.top + b.height && a.y + a.h > b.top;
  let changed = false;
  const result: PPTElement[] = [];
  for (const e of elements) {
    if (
      (e.type !== 'shape' && e.type !== 'line') ||
      (e.type === 'shape' && (e.text || e.rotate)) ||
      (e.type === 'line' && (e.points.some(Boolean) || e.curve || e.broken || e.broken2 || e.cubic))
    ) {
      result.push(e);
      continue;
    }
    const color = e.type === 'shape' ? e.fill : e.color;
    const orange = isOrangeDecoration(color);
    const neutral = isNeutralRule(color);
    // Theme-coloured accents and dividers (blue, purple, …) too, but only where
    // they cross the rendered lines of a paragraph: a diagram's own strokes
    // between labels are left alone.
    const themed = !orange && !neutral && /^#[0-9a-f]{6}$/i.test(color ?? '');
    if (!orange && !neutral && !themed) {
      result.push(e);
      continue;
    }
    const r =
      e.type === 'shape'
        ? { x: e.left, y: e.top, w: e.width, h: e.height }
        : {
            x: e.left + Math.min(e.start[0], e.end[0]) - e.width / 2,
            y: e.top + Math.min(e.start[1], e.end[1]) - e.width / 2,
            w: Math.max(e.width, Math.abs(e.end[0] - e.start[0])),
            h: Math.max(e.width, Math.abs(e.end[1] - e.start[1])),
          };
    const vertical = r.w <= 8 && r.h >= 12,
      horizontal = r.h <= 8 && r.w >= 20;
    const lines = (t: (typeof text)[number]) => ({
      left: t.left,
      top: t.top + 6,
      width: t.width,
      height: Math.max(1, Math.min(t.height, nativeTextHeight(t)) - 12),
    });
    const hit = text.filter((t) => overlap(r, themed ? lines(t) : t));
    // Text reflow can leave an old accent floating below its paragraph. Rebind
    // a margin accent to the nearest text envelope, keeping its native color,
    // width and height. Do not treat diagram connectors as decoration.
    if (
      (orange || (themed && r.h <= 160)) &&
      vertical &&
      !hit.length &&
      text.length &&
      e.type === 'shape'
    ) {
      const candidates = text.filter((t) => r.x + r.w <= t.left && t.left - r.x - r.w <= 32);
      const distance = (t: (typeof text)[number]) =>
        Math.max(t.top - r.y - r.h, r.y - t.top - t.height, 0);
      const anchor = candidates.sort((a, b) => distance(a) - distance(b))[0];
      if (anchor && distance(anchor) > 8) {
        const top = anchor.top + Math.max(0, (anchor.height - r.h) / 2);
        if (top + r.h <= height) {
          const next = { ...r, y: top };
          if (text.every((t) => !overlap(next, t))) {
            result.push({ ...e, top });
            changed = true;
            continue;
          }
        }
      }
    }
    // A gray rule is moved only when it is a long divider crossing paragraphs;
    // short gray strokes beside small labels may belong to a diagram.
    const grayDivider = horizontal && r.w >= 120 && hit.every((t) => t.width >= 160);
    const themedRule = themed && (vertical || (horizontal && r.w >= 120));
    if ((!vertical && !horizontal) || !hit.length || (!orange && !grayDivider && !themedRule)) {
      result.push(e);
      continue;
    }
    const candidates = vertical
      ? [
          Math.min(...hit.map((t) => t.left)) - r.w - 10,
          Math.max(...hit.map((t) => t.left + t.width)) + 10,
        ].map((x) => ({ ...r, x }))
      : [
          Math.min(...hit.map((t) => t.top)) - r.h - 10,
          Math.max(...hit.map((t) => t.top + t.height)) + 10,
        ].map((y) => ({ ...r, y }));
    const safe = candidates.find(
      (c) =>
        c.x >= 0 &&
        c.y >= 0 &&
        c.x + c.w <= width &&
        c.y + c.h <= height &&
        text.every((t) => !overlap(c, t)),
    );
    changed = true;
    if (safe) result.push({ ...e, left: e.left + safe.x - r.x, top: e.top + safe.y - r.y });
    // If the slide has no free margin, omit this decoration, never edit text.
  }
  return changed ? result : elements;
}
