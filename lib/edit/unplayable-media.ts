import type { PPTElement } from '@openmaic/dsl';

const GENERATED = /^gen_(img|vid)_[\w-]+$/i;

/**
 * Drop media the slide can never show. The slide prompt always documents the
 * video element, so a small model sometimes adds a video (or a generated-image
 * placeholder) although no media was planned for the page: it stays a black
 * frame (or a loading skeleton) forever, and offline nothing can fill it.
 *
 * Kept: videos and generated images whose reference was planned for this page
 * (outline.mediaGenerations), videos with an embedded source,
 * and every other image (source images are resolved upstream).
 */
export function removeUnplayableMedia(
  elements: PPTElement[],
  planned: ReadonlyArray<{ type: string; elementId: string }> = [],
): PPTElement[] {
  const plannedIds = new Set(planned.map((m) => m.elementId));
  const kept = elements.filter((e) => {
    if (e.type !== 'video' && e.type !== 'image') return true;
    const record = e as unknown as { src?: unknown; mediaRef?: unknown };
    const src = typeof record.src === 'string' ? record.src.trim() : '';
    const ref = typeof record.mediaRef === 'string' ? record.mediaRef.trim() : '';
    if (e.type === 'image') return !GENERATED.test(src) || plannedIds.has(src);
    if (ref) return plannedIds.has(ref);
    if (GENERATED.test(src)) return plannedIds.has(src);
    // A model cannot know a real video address, local or remote ("/videos/x.mp4"
    // is as invented as a URL): only planned or embedded media plays.
    return /^(?:data:video\/|blob:)/i.test(src);
  });
  return kept.length === elements.length ? elements : kept;
}
