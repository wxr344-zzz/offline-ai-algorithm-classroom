import { compileFormula, type FallbackLanguage, type SimulationSpec } from './widget-fallback';

/**
 * A planned simulator must teach the right relationships, not only react to
 * its sliders. The model that wrote the formulas is asked separately, from
 * subject knowledge and without seeing any formula, how each displayed
 * quantity responds when one input increases; the formulas are evaluated
 * around the defaults and must agree (reported: an "acceleration" that fell
 * as a mass grew). Nothing here knows any topic.
 */
export type Direction = 'up' | 'down' | 'none';

export interface DirectionProbe {
  /** Which output (o<i>) or curve (c<i>) of the design. */
  target: string;
  quantity: string;
  input: string;
  actual: Direction;
  /** Relative size of the change, for "unchanged" disagreements. */
  change: number;
  /** Whether the formula mentions this input at all (a graph's x may stand for it). */
  uses: boolean;
}

const mentions = (expr: string, id: string) =>
  new RegExp(`(?<![A-Za-z0-9_])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`).test(expr);

function evaluator(expr: string, ids: readonly string[]) {
  return new Function('p', `return ${compileFormula(expr, ids)};`) as (
    p: Record<string, number>,
  ) => number;
}

function direction(a: number, b: number): { dir: Direction; change: number } | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const scale = Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
  const change = Math.abs(b - a) / scale;
  if (change < 1e-6) return { dir: 'none', change };
  return { dir: b > a ? 'up' : 'down', change };
}

/** How each displayed quantity actually moves when one input rises around its default. */
export function designDirections(spec: SimulationSpec, limit = 9): DirectionProbe[] {
  const ids = spec.parameters.map((p) => p.id);
  const base = Object.fromEntries(spec.parameters.map((p) => [p.id, p.default]));
  const around = (value: number, min: number, max: number) => {
    const d = (max - min) * 0.1;
    const lo = Math.max(min, value - d);
    const hi = Math.min(max, value + d);
    return hi > lo ? [lo, hi] : null;
  };
  const probes: DirectionProbe[] = [];
  spec.outputs.forEach((output, i) => {
    let f: ReturnType<typeof evaluator>;
    try {
      f = evaluator(output.expr, ids);
    } catch {
      return;
    }
    for (const p of spec.parameters) {
      const span = around(p.default, p.min, p.max);
      if (!span) continue;
      const r = direction(f({ ...base, [p.id]: span[0] }), f({ ...base, [p.id]: span[1] }));
      if (r)
        probes.push({
          target: `o${i}`,
          quantity: output.label,
          input: p.label,
          actual: r.dir,
          change: r.change,
          // A live number is computed from the sliders themselves: an input it ignores is a real omission.
          uses: true,
        });
    }
  });
  const plot = spec.plot;
  plot?.curves.forEach((curve, i) => {
    if (curve.start !== undefined) return; // sequences are checked by their own run
    let f: ReturnType<typeof evaluator>;
    try {
      f = evaluator(curve.expr, [...ids, 'x']);
    } catch {
      return;
    }
    const xMid = (plot.xMin + plot.xMax) / 2;
    const at = { ...base, x: xMid };
    const xs = around(xMid, plot.xMin, plot.xMax);
    if (xs) {
      const r = direction(f({ ...at, x: xs[0] }), f({ ...at, x: xs[1] }));
      if (r)
        probes.push({
          target: `c${i}`,
          quantity: curve.label,
          input: plot.xLabel,
          actual: r.dir,
          change: r.change,
          uses: true,
        });
    }
    for (const p of spec.parameters) {
      const span = around(p.default, p.min, p.max);
      if (!span) continue;
      const r = direction(f({ ...at, [p.id]: span[0] }), f({ ...at, [p.id]: span[1] }));
      // A slider the curve does not use is usually the quantity on the x axis.
      if (r && mentions(curve.expr, p.id))
        probes.push({
          target: `c${i}`,
          quantity: curve.label,
          input: p.label,
          actual: r.dir,
          change: r.change,
          uses: true,
        });
    }
  });
  return probes.slice(0, limit);
}

const ANSWER: Record<string, Direction | 'depends'> = {
  increases: 'up',
  increase: 'up',
  up: 'up',
  增大: 'up',
  增加: 'up',
  decreases: 'down',
  decrease: 'down',
  down: 'down',
  减小: 'down',
  减少: 'down',
  unchanged: 'none',
  none: 'none',
  不变: 'none',
  depends: 'depends',
  不确定: 'depends',
};

export function directionPrompt(
  concept: string,
  probes: DirectionProbe[],
  lang: FallbackLanguage,
): { system: string; user: string } {
  const zh = lang !== 'en';
  const lines = probes.map((q, i) =>
    zh
      ? `${i + 1}. 在“${concept}”中，只增大「${q.input}」、其他条件保持不变时，「${q.quantity}」会怎样？`
      : `${i + 1}. In "${concept}", when only "${q.input}" increases and everything else stays the same, what happens to "${q.quantity}"?`,
  );
  return {
    system: zh
      ? '你是学科审校。只依据公认的学科知识回答，不要猜测任何公式。只输出 JSON。'
      : 'You are a subject reviewer. Answer from established subject knowledge only; do not guess any formula. Output JSON only.',
    user: zh
      ? `${lines.join('\n')}\n\n每题只能回答 "increases"、"decreases"、"unchanged" 或 "depends"（关系不单调或取决于其他条件时）。只回复 {"answers":["...", ...]}，数量与题目相同。`
      : `${lines.join('\n')}\n\nAnswer each with exactly "increases", "decreases", "unchanged" or "depends" (when the relationship is not monotonic or depends on other conditions). Reply ONLY {"answers":["...", ...]} with one answer per question.`,
  };
}

/** The probes whose formula contradicts the reviewer's subject knowledge. */
export function contradictions(probes: DirectionProbe[], reply: string): DirectionProbe[] | null {
  let answers: unknown;
  try {
    const json = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1);
    answers = (JSON.parse(json) as { answers?: unknown }).answers;
  } catch {
    return null;
  }
  if (!Array.isArray(answers) || answers.length !== probes.length) return null;
  return probes.filter((probe, i) => {
    const expected = ANSWER[String(answers[i]).trim().toLowerCase()];
    if (!expected || expected === 'depends' || expected === probe.actual) return false;
    // Opposite directions always disagree; "unchanged" against a clear change
    // (or a change against "unchanged") only when it is not negligible.
    if (probe.actual === 'none') return probe.uses;
    if (expected === 'none') return probe.change > 0.05;
    return true;
  });
}

export function contradictionFeedback(found: DirectionProbe[], lang: FallbackLanguage): string {
  const verb = (d: Direction, zh: boolean) =>
    zh ? { up: '增大', down: '减小', none: '不变' }[d] : { up: 'increases', down: 'decreases', none: 'stays the same' }[d];
  const zh = lang !== 'en';
  const items = found.map((f) =>
    zh
      ? `你的公式中，「${f.input}」增大时「${f.quantity}」${verb(f.actual, true)}，这与学科规律不符`
      : `in your formulas "${f.quantity}" ${verb(f.actual, false)} when "${f.input}" increases, which contradicts the subject`,
  );
  return zh
    ? `\n\n上一次的设计有科学错误：${items.join('；')}。请按本主题的正确公式重写这些量（若名称指的是另一个量，同时改正名称），并确保每个量与各参数的关系正确。`
    : `\n\nYour previous design had scientific errors: ${items.join('; ')}. Rewrite these quantities with the correct formulas for this topic (fix the name too if it names a different quantity), so each one responds to every input correctly.`;
}

/** The design without the outputs and curves that contradict the subject (null when nothing usable is left). */
export function withoutContradictions(
  spec: SimulationSpec,
  found: DirectionProbe[],
): SimulationSpec | null {
  const bad = new Set(found.map((f) => f.target));
  const outputs = spec.outputs.filter((_, i) => !bad.has(`o${i}`));
  const curves = spec.plot?.curves.filter((_, i) => !bad.has(`c${i}`)) ?? [];
  const plot = spec.plot && curves.length ? { ...spec.plot, curves } : undefined;
  if (!plot && !outputs.length) return null;
  return { ...spec, outputs, plot };
}
