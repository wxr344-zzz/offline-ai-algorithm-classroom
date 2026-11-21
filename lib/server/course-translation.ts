import { courseTarget, localizeSpeeches } from '@/lib/server/generation/steps/speech-language';
import { hasForeignProseScript } from '@/lib/eduplus/content-language';

/**
 * Learner-visible text produced in Chinese by Chinese-only pipelines (the
 * Python Lab generator, the teaching core) shown in another course language.
 * Only display text is translated; code, JSON, identifiers and numbers are
 * checked to survive unchanged, and a text whose translation changes them is
 * kept as written. Stored grading assets are never modified.
 */
export type Translate = (system: string, prompt: string) => Promise<string>;

const HAN = /[㐀-鿿]/;
const BATCH_TEXTS = 16;
const BATCH_CHARS = 2400;

/** Check prose only. Example JSON and code are intentionally language-neutral. */
export function displayNeedsTranslation(text: string, directive: string | undefined): boolean {
  const target = courseTarget(directive);
  if (!target) return false;
  const prose = protectJson(text)
    .text.replace(/```[\s\S]*?```|`[^`]*`/g, '')
    .replace(/__VERBATIM_[A-Z]+__/g, '');
  if (!prose.trim()) return false;
  if (target === 'en') return hasForeignProseScript(prose, target);
  if (target === 'zh-CN') return !HAN.test(prose) && /[A-Za-z]{3}/.test(prose);
  // Traditional Chinese and non-English locales must not be treated as English.
  return true;
}

export function assertDisplayLanguage(texts: readonly string[], directive: string): void {
  const target = courseTarget(directive);
  if (target && texts.some((text) => hasForeignProseScript(protectJson(text).text, target)))
    throw new Error(
      `Teaching text still uses an incompatible writing system for ${target}. Retry language preparation.`,
    );
  if (target === 'en' && texts.some((text) => displayNeedsTranslation(text, directive)))
    throw new Error(
      'Some teaching text still needs English translation. Retry language preparation.',
    );
  if (
    target &&
    !target.startsWith('zh') &&
    target !== 'en' &&
    target !== 'ja-JP' &&
    texts.some((text) => HAN.test(protectJson(text).text.replace(/```[\s\S]*?```|`[^`]*`/g, '')))
  )
    throw new Error(
      `Some teaching text still needs translation to ${target}. Retry language preparation.`,
    );
}

/** Tokens a translation must keep: numbers, identifiers with digits/underscores, JSON-ish fragments. */
function protectedTokens(text: string): string[] {
  const tokens =
    text.match(/[A-Za-z_][A-Za-z0-9_]*\(|[A-Za-z]*_[A-Za-z0-9_]+|-?\d+(?:\.\d+)?|[{}[\]]/g) ?? [];
  return tokens.sort();
}

function keepsTokens(source: string, translated: string, proseOrdinals = false): boolean {
  // Opaque markers are checked exactly during restoration. Exclude them here:
  // "Example__VERBATIM_A__" must not be mistaken for a changed code identifier.
  const prose = (text: string) => text.replace(/__VERBATIM_[A-Z]+__/g, ' ');
  const need = protectedTokens(prose(source));
  const have = protectedTokens(prose(translated));
  const pool = new Map<string, number>();
  for (const t of have) pool.set(t, (pool.get(t) ?? 0) + 1);
  const kept = need.every((t) => {
    const n = pool.get(t) ?? 0;
    if (!n) return false;
    pool.set(t, n - 1);
    return true;
  });
  // Around opaque JSON, Chinese ordinal labels may become "Input 1". All
  // original prose tokens must survive; only additional prose digits are allowed.
  return (
    kept &&
    (need.length === have.length ||
      (proseOrdinals &&
        [...pool].every(([token, count]) => !count || /^-?\d+(?:\.\d+)?$/.test(token))))
  );
}

/** Keep valid JSON examples completely outside translation, not merely their
 * numeric token counts. Balanced parsing handles nested arrays and quoted braces. */
function protectJson(text: string): {
  text: string;
  literals: Map<string, string>;
  hasJson: boolean;
} {
  const literals = new Map<string, string>();
  const preserve = (literal: string) => {
    let index = literals.size,
      letters = '';
    do {
      letters = String.fromCharCode(65 + (index % 26)) + letters;
      index = Math.floor(index / 26) - 1;
    } while (index >= 0);
    // Distinct short labels are easier to copy than counting repeated As.
    let marker = `__VERBATIM_${letters}__`;
    while (text.includes(marker)) marker += '_';
    literals.set(marker, literal);
    return marker;
  };
  let output = '',
    cursor = 0;
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    const stack: string[] = [];
    let quoted = false,
      escaped = false,
      end = start;
    for (; end < text.length; end++) {
      const c = text[end]!;
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') {
        if (stack.pop() !== (c === '}' ? '{' : '[')) break;
        if (!stack.length) {
          end++;
          break;
        }
      }
    }
    if (stack.length || quoted) continue;
    const literal = text.slice(start, end);
    try {
      JSON.parse(literal);
    } catch {
      continue;
    }
    const marker = preserve(literal);
    output += text.slice(cursor, start) + marker;
    cursor = end;
    start = end - 1;
  }
  const hasJson = literals.size > 0;
  // Constraint numbers and numbered examples must not be rewritten as words
  // or changed by the translator. Digits inside identifiers remain untouched.
  const masked = (output + text.slice(cursor)).replace(
    /__VERBATIM_[A-Z]+__|(?<![A-Za-z_0-9.])-?\d+(?:\.\d+)?/g,
    (token) => (/^-?\d/.test(token) ? preserve(token) : token),
  );
  return { text: masked, literals, hasJson };
}

class PartialTranslationError extends Error {
  constructor(readonly completed: Map<number, string>) {
    super('Some batch translations failed validation');
  }
}

async function translateBatch(
  texts: string[],
  directive: string,
  translate: Translate,
): Promise<string[]> {
  const protectedTexts = texts.map(protectJson);
  const items = protectedTexts.map(({ text }) => ({ type: 'speech', text }));
  const restore = (value: string, index: number) => {
    const source = protectedTexts[index]!;
    if (!keepsTokens(source.text, value, source.hasJson))
      throw new Error('Translation changed a protected example, number or identifier');
    let translated = value;
    for (const [marker, literal] of source.literals) {
      if (translated.split(marker).length !== 2)
        throw new Error('Translation changed a verbatim example marker');
      translated = translated.replace(marker, () => literal);
    }
    return translated;
  };
  let capturedReply = '';
  const system = (s: string) =>
    s.replace(
      'classroom dialogue',
      'teaching material (exercise statements, hints, quiz questions)',
    ) +
    ' Keep code, variable and function names, numbers and formulas exactly as written. Copy every __VERBATIM_ marker exactly once, unchanged; it represents example data that must not be translated.' +
    ' Descriptive labels inside illustrative input shapes that are NOT valid JSON are natural-language prose, not literal identifiers. Translate those labels into the target language too. Do not leave source-language descriptions unchanged merely because they occur inside square brackets. Actual JSON examples are protected by the markers.';
  try {
    const out = await localizeSpeeches(
      items,
      directive,
      async (s, p) => {
        const raw = await translate(system(s), p);
        capturedReply = raw;
        // A local model may split ONE multi-paragraph statement into several text
        // items. Only that unambiguous case can be rejoined; never guess alignment
        // for multiple source strings. All language and data checks still follow.
        if ((JSON.parse(p) as unknown[]).length === 1) {
          try {
            const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
            if (
              Array.isArray(parsed.texts) &&
              parsed.texts.length > 1 &&
              parsed.texts.length <= 64 &&
              parsed.texts.every((text: unknown) => typeof text === 'string')
            )
              return JSON.stringify({ texts: [parsed.texts.join('\n')] });
          } catch {
            /* Normal validation reports an unusable reply. */
          }
        }
        return raw;
      },
      () => true,
    );
    return out.map((item, index) => restore(item.text, index));
  } catch (cause) {
    // A batch can have fifteen valid translations and one bad item. Reuse the
    // valid ones only when count/order are unambiguous; run EACH through the
    // same language, marker and numeric checks without another model call.
    const completed = new Map<number, string>();
    try {
      const parsed = JSON.parse(capturedReply.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      const values = Array.isArray(parsed) ? parsed : parsed?.texts;
      if (Array.isArray(values) && values.length === texts.length) {
        const labelCandidates = new Map<number, string>();
        const proseParts = (text: string) => text.split(/(```[\s\S]*?```|`[^`]*`)/g);
        for (const [index, value] of values.entries()) {
          if (typeof value !== 'string') continue;
          try {
            const checked = await localizeSpeeches(
              [items[index]!],
              directive,
              async () => JSON.stringify({ texts: [value] }),
              () => true,
            );
            completed.set(index, restore(checked[0]!.text, index));
          } catch {
            // A model may correctly translate a statement but preserve short
            // descriptive labels in a non-JSON input shape as "code". Repair
            // those labels separately, only after all protected data survived.
            if (courseTarget(directive) === 'en' && value.length <= 12000) {
              try {
                restore(value, index);
                const prose = proseParts(value)
                  .filter((_, i) => i % 2 === 0)
                  .join(' ')
                  .replace(/__VERBATIM_[A-Z]+__/g, ' ');
                if ((prose.match(/\b[A-Za-z]{3,}\b/g) ?? []).length >= 3)
                  labelCandidates.set(index, value);
              } catch {
                /* Altered examples/markers/numbers are never repair candidates. */
              }
            }
          }
        }
        const labels = [
          ...new Set(
            [...labelCandidates.values()].flatMap((value) =>
              proseParts(value).flatMap((part, i) =>
                i % 2 ? [] : (part.match(/[㐀-鿿]+/g) ?? []),
              ),
            ),
          ),
        ];
        if (
          labels.length > 0 &&
          labels.length <= 16 &&
          labels.every((label) => label.length <= 24) &&
          labels.join('').length <= 160
        ) {
          try {
            const localized = await localizeSpeeches(
              labels.map((text) => ({ type: 'speech', text })),
              directive,
              (s, p) =>
                translate(
                  system(s) + ' These short descriptive labels are prose. Translate every label.',
                  p,
                ),
            );
            const replacements = new Map(labels.map((label, i) => [label, localized[i]!.text]));
            for (const [index, value] of labelCandidates) {
              const repaired = proseParts(value)
                .map((part, i) =>
                  i % 2
                    ? part
                    : part.replace(/[㐀-鿿]+/g, (label) => replacements.get(label) ?? label),
                )
                .join('');
              const checked = await localizeSpeeches(
                [items[index]!],
                directive,
                async () => JSON.stringify({ texts: [repaired] }),
                () => true,
              );
              completed.set(index, restore(checked[0]!.text, index));
            }
          } catch {
            /* The original single-item retry path still applies. */
          }
        }
      }
    } catch {
      /* Malformed alignment still requires the original retry path. */
    }
    if (completed.size === texts.length) return texts.map((_, index) => completed.get(index)!);
    if (completed.size) throw new PartialTranslationError(completed);
    throw cause;
  }
}

/** Translations of the given texts (a text that needs none, or fails, maps to itself). */
export async function translateTexts(
  texts: readonly string[],
  directive: string | undefined,
  translate: Translate,
  onBatch?: (completed: ReadonlyMap<string, string>) => Promise<void>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const pending = [
    ...new Set(texts.filter((t) => typeof t === 'string' && displayNeedsTranslation(t, directive))),
  ];
  for (const t of texts) if (!pending.includes(t)) result.set(t, t);
  if (!courseTarget(directive) || !pending.length) {
    for (const t of pending) result.set(t, t);
    return result;
  }
  const batches: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const text of pending) {
    if (current.length && (current.length >= BATCH_TEXTS || size + text.length > BATCH_CHARS)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length) batches.push(current);
  for (const batch of batches) {
    let translated: string[] | null = null;
    try {
      translated = await translateBatch(batch, directive!, translate);
    } catch (error) {
      // Retry only failed items of a correctly aligned reply.
      const completed =
        error instanceof PartialTranslationError ? error.completed : new Map<number, string>();
      if (completed.size && onBatch)
        await onBatch(new Map([...completed].map(([index, value]) => [batch[index]!, value])));
      translated = [];
      for (const [index, text] of batch.entries()) {
        if (completed.has(index)) {
          translated.push(completed.get(index)!);
          continue;
        }
        try {
          translated.push((await translateBatch([text], directive!, translate))[0]!);
        } catch {
          const lines = text.split(/\r?\n/);
          // Long statements are simpler as aligned paragraphs. Never split an
          // actual multiline JSON example, whose bytes must remain untouched.
          if (
            lines.length > 1 &&
            lines.length <= 32 &&
            ![...protectJson(text).literals.values()].some((literal) => literal.includes('\n'))
          ) {
            try {
              translated.push((await translateBatch(lines, directive!, translate)).join('\n'));
              continue;
            } catch {
              /* Keep the source when paragraph alignment also fails. */
            }
          }
          translated.push(text);
        }
      }
    }
    batch.forEach((text, i) => result.set(text, translated![i] ?? text));
    if (onBatch) {
      // Only verified, changed translations are checkpointed. A failed item
      // mapping back to its source must remain eligible for the next attempt.
      const completed = new Map(
        batch.flatMap((text, i) => {
          const value = translated![i];
          return value && value !== text ? [[text, value] as const] : [];
        }),
      );
      if (completed.size) await onBatch(completed);
    }
  }
  return result;
}

/** Process-wide cache of finished translations, with in-flight requests shared. */
const cache = new Map<string, Promise<Map<string, string>>>();
const MAX_CACHE = 200;

export function cachedTranslation(
  key: string,
  run: () => Promise<Map<string, string>>,
): Promise<Map<string, string>> {
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = run()
    .then((result) => {
      // A temporary model failure is not a permanent translation. Keep sharing
      // the in-flight request, but allow the next visit to retry incomplete text.
      if ([...result].some(([source, translated]) => HAN.test(source) && HAN.test(translated)))
        cache.delete(key);
      return result;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, promise);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return promise;
}

export function translationKey(parts: readonly string[]): string {
  let hash = 2166136261;
  for (const part of parts)
    for (let i = 0; i < part.length; i++) {
      hash ^= part.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  return `${parts.length}:${(hash >>> 0).toString(36)}`;
}
