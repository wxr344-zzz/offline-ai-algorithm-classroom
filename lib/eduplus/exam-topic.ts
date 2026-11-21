import catalog from './exam-simulator-catalog.json';
import routing from './exam-topic-routing.json';

function normalizedTopic(value: string, compact = true): string {
  // The same synonyms as the Python registry (搜素 → 搜索, 广度优先 → 广度, …).
  return routingTopic(value, compact);
}

/** Routing metadata exported from the Python registry. No execution logic. */
export function isExamAlgorithmTopic(topic: string): boolean {
  const normalized = normalizedTopic(topic);
  return catalog.some((p) =>
    [p.id, p.title, ...p.aliases].some((a) => {
      const spaced = normalizedTopic(a, false);
      if (/^[a-z0-9_+*/ .-]+$/.test(spaced)) {
        const pattern = spaced
          .split(/\s+/)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('\\s*');
        return new RegExp(`(?<![a-z0-9_])${pattern}(?![a-z0-9_])`).test(
          normalizedTopic(topic, false),
        );
      }
      return normalized.includes(normalizedTopic(a));
    }),
  );
}

type Routing = {
  synonyms: [string, string][];
  framing: string[];
  variants: [string, string[]][];
  punctuation: string;
};
const rules = routing as unknown as Routing;

function routingTopic(value: string, compact = true): string {
  let normalized = value.normalize('NFKC').toLowerCase();
  if (compact) normalized = normalized.replace(/\s+/g, '');
  for (const [from, to] of rules.synonyms) normalized = normalized.replaceAll(from, to);
  return normalized;
}
const framing = rules.framing
  .map((token, index) => ({ token: routingTopic(token), index }))
  .sort((a, b) => b.token.length - a.token.length || a.index - b.index)
  .map((item) => item.token)
  .filter(Boolean);
const punctuation = new RegExp(rules.punctuation, 'g');

/**
 * The maintained algorithm a request is exactly about, or null — the same
 * decision the Python registry makes (exam_simulator.core.resolve, rules in
 * exam-topic-routing.json). Unlike isExamAlgorithmTopic (a loose "mentions a
 * catalog algorithm" check for intent), an unknown qualifier ("双向BFS",
 * "斐波那契堆", a comparison of two algorithms) is not absorbed: only these
 * topics may use the maintained step-by-step simulator without a Lab course.
 */
export function resolveExamAlgorithm(topic: string): string | null {
  const normalized = routingTopic(topic);
  const exactIdentity = (profile: (typeof catalog)[number]) => {
    let remainder = normalized;
    const names = [
      ...profile.aliases,
      profile.title,
      profile.id,
      ...(profile.title.match(/[A-Za-z][A-Za-z0-9+*-]*/g) ?? []),
    ]
      .map((name, index) => ({ name, index }))
      .sort((a, b) => b.name.length - a.name.length || a.index - b.index);
    for (const { name } of names) {
      const token = routingTopic(name);
      if (token) remainder = remainder.replaceAll(token, '');
    }
    for (const token of framing) remainder = remainder.replaceAll(token, '');
    return !remainder.replace(punctuation, '');
  };
  const byId = new Map(catalog.map((p) => [p.id, p]));
  for (const [key, aliases] of rules.variants) {
    const profile = byId.get(key);
    if (
      profile &&
      aliases.some((a) => normalized.includes(routingTopic(a))) &&
      exactIdentity(profile)
    )
      return key;
  }
  const spacedTopic = routingTopic(topic, false);
  const matches: Array<[number, string]> = [];
  for (const profile of catalog)
    for (const raw of [...profile.aliases, profile.title, profile.id]) {
      const spaced = routingTopic(raw, false);
      const alias = routingTopic(raw);
      if (!alias) continue;
      let matched: boolean;
      if (/^[a-z0-9_+*/ .-]+$/.test(spaced)) {
        const pattern = spaced
          .split(/\s+/)
          .filter(Boolean)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('\\s*');
        matched = new RegExp(`(?<![a-z0-9_])${pattern}(?![a-z0-9_])`).test(spacedTopic);
      } else matched = normalized.includes(alias);
      if (matched && exactIdentity(profile)) matches.push([alias.length, profile.id]);
    }
  if (!matches.length) return null;
  matches.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
  return matches[0]![1];
}

/**
 * The maintained algorithm an interactive page demonstrates, from the most
 * specific description of that page to the whole request: the page's concept,
 * its title, the request, then title with description. The first one that is
 * exactly a maintained algorithm wins, so every path (any language, with or
 * without a Lab, a terse or a long request) reaches the same deterministic
 * simulator. Returns the matched text as the simulator topic (it resolves to
 * the same algorithm in the Python registry).
 */
export function resolveSimulationAlgorithm(
  candidates: Array<string | undefined | null>,
): { algorithm: string; topic: string } | null {
  for (const raw of candidates) {
    const topic = raw?.trim();
    if (!topic || topic.length > 2000) continue;
    const algorithm = resolveExamAlgorithm(topic);
    if (algorithm) return { algorithm, topic };
  }
  return null;
}
