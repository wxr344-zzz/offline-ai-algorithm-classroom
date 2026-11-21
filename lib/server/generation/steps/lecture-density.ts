/**
 * A slide with more text than fits is laid out by shrinking every font
 * (repairNativeTextClearance), down to half size: unreadable. When that would
 * shrink below READABLE_FACTOR, the body text is condensed into key points
 * first (one short model call); the details remain in the spoken explanation,
 * which is generated from the outline afterwards.
 */
import type { PPTElement, PPTTextElement } from '@openmaic/dsl';
import { jsonrepair } from 'jsonrepair';

/** Below this font scale (16px → ~12.8px) a slide counts as crowded. */
export const READABLE_FACTOR = 0.8;

type AiCall = (system: string, user: string) => Promise<string>;

/** The font scale the layout repair applied (1 when nothing was shrunk). */
export function appliedFontScale(elements: readonly PPTElement[]): number {
  let factor = 1;
  for (const e of elements) {
    if (e.type !== 'text') continue;
    const m = /^<div style="font-size:([\d.]+)px">/.exec(e.content);
    if (m) factor = Math.min(factor, Number(m[1]) / 16);
  }
  return factor;
}

function plainLines(html: string): string[] {
  return html
    .replace(/<\/(p|li|h[1-6]|div)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Condense the body text of a crowded slide; null when the answer is unusable. */
export async function condenseCrowdedSlide(
  elements: PPTElement[],
  languageDirective: string | undefined,
  aiCall: AiCall,
): Promise<PPTElement[] | null> {
  // Body text only: titles and short labels stay as written.
  const bodies = elements.filter(
    (e): e is PPTTextElement => e.type === 'text' && plainLines(e.content).join('').length > 40,
  );
  if (!bodies.length) return null;
  const sources = bodies.map((e) => plainLines(e.content));
  const chinese = /中文|Chinese/i.test(languageDirective ?? '');
  const system = chinese
    ? '你是课件编辑。幻灯片正文太多，字号被迫缩得很小。把每段正文精简成 2–5 条简短要点（每条不超过 30 个字），保留关键概念、公式和数字，删去举例细节和重复内容。只输出 JSON {"texts":[["要点",...],...]}，段落数量和顺序与输入相同。'
    : 'You are a slide editor. The slide has too much text, so its font had to shrink. Condense each text block into 2–5 short key points (at most 15 words each), keeping key concepts, formulas and numbers and dropping examples and repetition. Output ONLY JSON {"texts":[["point",...],...]}, with the same number and order of blocks as the input.';
  const raw = await aiCall(system, JSON.stringify(sources));
  const body = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)?.[1] ?? raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonrepair(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)));
  } catch {
    return null;
  }
  const texts = (parsed as { texts?: unknown })?.texts;
  if (!Array.isArray(texts) || texts.length !== bodies.length) return null;
  const before = sources.flat().join('').length;
  const points = texts.map((t) =>
    Array.isArray(t)
      ? t
          .filter((p): p is string => typeof p === 'string')
          .map((p) => p.replace(/^[\s•·\-–*\d.、)）]+/, '').trim())
          .filter(Boolean)
          .slice(0, 6)
      : [],
  );
  const after = points.flat().join('').length;
  if (points.some((p) => !p.length) || after > before * 0.75) return null;
  if (chinese && points.flat().some((p) => !/[一-鿿]/.test(p) && p.length > 12)) return null;
  const replacements = new Map(
    bodies.map((e, i) => {
      const size = /font-size\s*:\s*([\d.]+)px/i.exec(e.content)?.[1] ?? '18';
      const content = points[i]!.map(
        (p) => `<p><span style="font-size:${size}px">• ${escapeHtml(p)}</span></p>`,
      ).join('');
      return [e.id, { ...e, content }] as const;
    }),
  );
  return elements.map((e) => replacements.get(e.id) ?? e);
}
