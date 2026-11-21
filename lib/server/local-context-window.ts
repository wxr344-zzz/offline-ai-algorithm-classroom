/**
 * Effective context window of a model served by a local Ollama (directly or
 * through the local dual-model gateway). Ollama's OpenAI-compatible endpoint
 * runs a model with the num_ctx it was created with, or Ollama's default
 * (4096) when none is set; catalog metadata does not know either, so callers
 * that size prompts (director compaction) must not assume a cloud-sized window.
 */
const OLLAMA_DEFAULT_CONTEXT = 4096;
const cache = new Map<string, number | undefined>();

function isLocalHost(hostname: string): boolean {
  return (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

/** Local queued model switches may consume the old 60s budget before speech.
 * This remains a bounded whole-turn deadline, never a client-supplied value. */
export function localClassroomTurnTimeout(baseUrl: string | undefined): number {
  try {
    return baseUrl && isLocalHost(new URL(baseUrl).hostname) ? 180_000 : 60_000;
  } catch {
    return 60_000;
  }
}

export function parseNumCtx(parameters: unknown): number | undefined {
  if (typeof parameters !== 'string') return undefined;
  const match = parameters.match(/(?:^|\n)\s*num_ctx\s+(\d+)/);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function resolveLocalContextWindow(
  baseUrl: string | undefined,
  modelId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<number | undefined> {
  if (!baseUrl || !modelId) return undefined;
  let origin: string;
  try {
    const url = new URL(baseUrl);
    if (!isLocalHost(url.hostname)) return undefined;
    origin = url.origin;
  } catch {
    return undefined;
  }
  const key = `${origin}|${modelId}`;
  if (cache.has(key)) return cache.get(key);
  let result: number | undefined;
  try {
    const response = await fetchImpl(`${origin}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelId }),
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const shown = (await response.json()) as { parameters?: unknown };
      result = parseNumCtx(shown.parameters) ?? OLLAMA_DEFAULT_CONTEXT;
    }
  } catch {
    result = undefined;
  }
  // Only cache definite answers so a model prepared later is picked up.
  if (result !== undefined) cache.set(key, result);
  return result;
}
