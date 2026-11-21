import type { PPTElement } from '@openmaic/dsl';

/** Rectangles and circles as the slide prompt defines them (unit viewBox). */
const BLOCK_PATH =
  /^\s*M\s*0\s+0\s+L\s*1\s+0\s+L\s*1\s+1\s+L\s*0\s+1\s*Z\s*$|^\s*M\s*1\s+0\.5\s+A\s*0\.5\s+0\.5\s+0\s+1\s+1\s+0\s+0\.5\s+A\s*0\.5\s+0\.5\s+0\s+1\s+1\s+1\s+0\.5\s*Z\s*$/i;

/**
 * Drop filled blocks that show nothing: a rectangle or circle with no text of
 * its own and no text or image placed on it (a model drew the boxes of a
 * diagram and never labelled them). Thin accents, full-slide backgrounds,
 * arrows, lines and any shape carrying or underlying content are kept.
 */
export function removeEmptyBlocks(
  elements: PPTElement[],
  width = 1000,
  height = 562.5,
): PPTElement[] {
  // Anything that shows something: text, images, formulas, charts, tables, media, code.
  const content = elements.filter((e) => e.type !== 'shape' && e.type !== 'line');
  const covers = (
    s: { left: number; top: number; width: number; height: number },
    c: { left: number; top: number; width: number; height: number },
  ) => {
    const w = Math.min(s.left + s.width, c.left + c.width) - Math.max(s.left, c.left);
    const h = Math.min(s.top + s.height, c.top + c.height) - Math.max(s.top, c.top);
    if (w <= 0 || h <= 0) return false;
    // Content counts as placed on the block when a fair part of it lies inside.
    return w * h >= 0.3 * Math.min(c.width * c.height, s.width * s.height);
  };
  const kept = elements.filter((e) => {
    if (e.type !== 'shape') return true;
    const hasText = !!e.text?.content && e.text.content.replace(/<[^>]+>|&nbsp;|\s/g, '') !== '';
    if (hasText) return true;
    if (!BLOCK_PATH.test(String(e.path ?? ''))) return true;
    if (e.width <= 8 || e.height <= 8) return true; // accent bars
    if (e.width >= width * 0.85 && e.height >= height * 0.8) return true; // background
    if (e.width * e.height < 1600) return true; // bullets, small markers
    return content.some((c) => covers(e, c));
  });
  return kept.length === elements.length ? elements : kept;
}
