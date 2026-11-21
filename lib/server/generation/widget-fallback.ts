/**
 * Platform-owned interactive pages used when a model-written widget still
 * fails the runtime check after repair attempts. The model only supplies data
 * (a small JSON spec); the page code is fixed, tested and never throws.
 *
 * - simulation: parameters (sliders) → formula outputs, with a live curve of
 *   the first output against the first parameter.
 * - game: multiple-choice rounds with scoring and feedback.
 * - otherwise (or when the spec is unusable): step-by-step concept cards.
 *
 * Formulas use a whitelisted grammar compiled to fully parenthesised JS:
 * numbers, parameter ids, + - * / ^, parentheses, pi, e and Math functions.
 */

import { localizedUi } from '@/lib/eduplus/localized-ui';

export type FallbackLanguage = 'zh-CN' | 'zh-TW' | 'en';

export interface SimulationSpec {
  title: string;
  intro: string;
  parameters: Array<{
    id: string;
    label: string;
    min: number;
    max: number;
    step: number;
    default: number;
    unit?: string;
  }>;
  outputs: Array<{ label: string; expr: string; format?: 'number' | 'percent' }>;
  /** Optional function graph: curves y = f(x; parameters) over an x range. */
  plot?: {
    xLabel: string;
    xMin: number;
    xMax: number;
    /**
     * A curve is y = expr(x; parameters), or, with `start`, a sequence over
     * the integer steps x: y(first step) = start(parameters) and the next value
     * is expr(x, y; parameters), with y the current value (iterative methods).
     */
    curves: Array<{ label: string; expr: string; start?: string }>;
    /** A slider whose value is a point on the x axis: each curve marks it with a dot. */
    markerParam?: string;
  };
  observations: string[];
}

export interface GameSpec {
  title: string;
  intro: string;
  rounds: Array<{ prompt: string; options: string[]; answer: number; explain: string }>;
}

const FUNCTIONS: Record<string, string> = {
  sqrt: 'Math.sqrt',
  abs: 'Math.abs',
  exp: 'Math.exp',
  ln: 'Math.log',
  log: 'Math.log',
  lg: 'Math.log10',
  log10: 'Math.log10',
  log2: 'Math.log2',
  sin: 'Math.sin',
  cos: 'Math.cos',
  tan: 'Math.tan',
  asin: 'Math.asin',
  acos: 'Math.acos',
  atan: 'Math.atan',
  floor: 'Math.floor',
  ceil: 'Math.ceil',
  round: 'Math.round',
  min: 'Math.min',
  max: 'Math.max',
  pow: 'Math.pow',
  sign: 'Math.sign',
};
const CONSTANTS: Record<string, string> = { pi: 'Math.PI', e: 'Math.E' };
const ID = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;

/** Compile a formula to a JS expression over `p.<id>`; throws on anything else. */
export function compileFormula(expr: string, ids: readonly string[]): string {
  const source = String(expr)
    .replace(/×|·/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/²/g, '^2')
    .replace(/π/g, 'pi');
  if (source.length > 200) throw new Error('formula too long');
  const tokens: string[] = [];
  const re = /\s*(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+|[A-Za-z_][A-Za-z0-9_]*|[-+*/^(),])/y;
  let index = 0;
  while (index < source.length) {
    if (/^\s*$/.test(source.slice(index))) break;
    re.lastIndex = index;
    const m = re.exec(source);
    if (!m) throw new Error(`unexpected input at ${index}`);
    tokens.push(m[1]);
    index = re.lastIndex;
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const take = (t?: string) => {
    const token = tokens[pos];
    if (t !== undefined && token !== t) throw new Error(`expected ${t}`);
    pos += 1;
    return token;
  };
  const known = new Set(ids);
  const expression = (): string => {
    let left = term();
    while (peek() === '+' || peek() === '-') left = `(${left}${take()}${term()})`;
    return left;
  };
  const term = (): string => {
    let left = unary();
    while (peek() === '*' || peek() === '/') left = `(${left}${take()}${unary()})`;
    return left;
  };
  const unary = (): string => {
    if (peek() === '-') {
      take();
      return `(-${unary()})`;
    }
    if (peek() === '+') {
      take();
      return unary();
    }
    return power();
  };
  const power = (): string => {
    const base = primary();
    if (peek() === '^') {
      take();
      return `Math.pow(${base},${unary()})`;
    }
    return base;
  };
  const primary = (): string => {
    const token = take();
    if (token === undefined) throw new Error('unexpected end');
    if (token === '(') {
      const inner = expression();
      take(')');
      return `(${inner})`;
    }
    if (/^(\d|\.)/.test(token)) {
      const n = Number(token);
      if (!Number.isFinite(n)) throw new Error('bad number');
      return String(n);
    }
    if (known.has(token)) return `p.${token}`;
    if (Object.hasOwn(FUNCTIONS, token) && peek() === '(') {
      take('(');
      const args = [expression()];
      while (peek() === ',') {
        take();
        args.push(expression());
      }
      take(')');
      return `${FUNCTIONS[token]}(${args.join(',')})`;
    }
    if (Object.hasOwn(CONSTANTS, token)) return CONSTANTS[token]!;
    throw new Error(`unknown name ${token}`);
  };
  const out = expression();
  if (pos !== tokens.length) throw new Error('trailing input');
  return out;
}

const text = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** A template placeholder the model copied instead of filling in ("<参数名称>", "..."). */
const placeholder = (v: unknown) => typeof v === 'string' && /[<>]|^\s*\.{3}\s*$|…/.test(v);

type Curve = NonNullable<SimulationSpec['plot']>['curves'][number];
const SEQUENCE_STEPS_MAX = 200;

function formula(expr: string, ids: readonly string[]) {
  return new Function('p', `return ${compileFormula(expr, ids)};`) as (
    p: Record<string, number>,
  ) => number;
}

/** The points of a curve for these parameter values (finite ones only). */
export function curvePoints(
  curve: Curve,
  ids: readonly string[],
  params: Record<string, number>,
  xMin: number,
  xMax: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  if (curve.start !== undefined) {
    const start = formula(curve.start, ids);
    const next = formula(curve.expr, [...ids, 'x', 'y']);
    const first = Math.ceil(xMin);
    const last = Math.min(Math.floor(xMax), first + SEQUENCE_STEPS_MAX);
    let y = start(params);
    for (let k = first; k <= last; k += 1) {
      // A diverging iteration stops where its values leave any readable scale.
      if (!Number.isFinite(y) || Math.abs(y) > 1e9) break;
      points.push([k, y]);
      y = next({ ...params, x: k, y });
    }
    return points;
  }
  const f = formula(curve.expr, [...ids, 'x']);
  for (let k = 0; k <= 80; k += 1) {
    const x = xMin + ((xMax - xMin) * k) / 80;
    const y = f({ ...params, x });
    if (Number.isFinite(y)) points.push([x, y]);
  }
  return points;
}

function normalizePlot(
  raw: unknown,
  parameters: SimulationSpec['parameters'],
): SimulationSpec['plot'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const ids = parameters.map((p) => p.id);
  if (ids.includes('x')) return undefined;
  const xMin = Number(r.xMin);
  const xMax = Number(r.xMax);
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !(xMax > xMin)) return undefined;
  const base = Object.fromEntries(parameters.map((p) => [p.id, p.default]));
  const curves: NonNullable<SimulationSpec['plot']>['curves'] = [];
  let anyVaries = false;
  // Where the kept curves are defined (asin(x) only on [-1, 1]).
  let definedMin = Infinity;
  let definedMax = -Infinity;
  for (const item of Array.isArray(r.curves) ? r.curves.slice(0, 3) : []) {
    const c = item as Record<string, unknown>;
    const expr = text(c?.expr, 200);
    const start = c?.start === undefined || c.start === null ? undefined : text(c.start, 200);
    if (placeholder(c?.label) || placeholder(expr) || (start !== undefined && placeholder(start)))
      continue;
    // A sequence runs over whole steps from 0 and needs y for its current value.
    if (start !== undefined && (ids.includes('y') || xMin < 0 || !start)) continue;
    const curve: Curve = { label: text(c?.label, 40) || expr, expr, ...(start ? { start } : {}) };
    let points: Array<[number, number]>;
    try {
      points = curvePoints(curve, ids, base, xMin, xMax);
    } catch {
      continue;
    }
    // Defined on a stretch of the range is enough; the axis is narrowed below.
    if (points.length < (start !== undefined ? 3 : 9)) continue;
    const values = points.map((point) => point[1]);
    definedMin = Math.min(definedMin, points[0]![0]);
    definedMax = Math.max(definedMax, points[points.length - 1]![0]);
    const spread = Math.max(...values) - Math.min(...values);
    if (spread > 1e-9 * (1 + Math.max(...values.map(Math.abs)))) anyVaries = true;
    curves.push(curve);
  }
  // A graph over x needs at least one curve that depends on x: curves written
  // in the sliders alone draw flat lines. A flat curve may stay only as a
  // reference line next to a real one (an asymptote, y = 1).
  if (!anyVaries || placeholder(r.xLabel)) return undefined;
  // Every curve is undefined over most of the axis (asin(x) drawn on [-5, 5]):
  // show only the part where something is drawn.
  const narrow = definedMax - definedMin < 0.8 * (xMax - xMin);
  return {
    xLabel: text(r.xLabel, 30) || 'x',
    xMin: narrow ? definedMin : xMin,
    xMax: narrow ? definedMax : xMax,
    curves,
  };
}

/**
 * Whether two drawings of a curve look different on screen: defined over a
 * different stretch, or apart by at least 3% of the height they span. A slider
 * that shifts a 0–100 line by 0.001 (the reported 梯度下降 page) does not count.
 */
export function visiblyDifferent(
  low: Array<[number, number]>,
  high: Array<[number, number]>,
): boolean {
  if (low.length !== high.length) return true;
  if (!low.length) return false;
  const values = [...low, ...high].map((point) => point[1]);
  const span = Math.max(...values) - Math.min(...values);
  if (!(span > 0)) return false;
  return low.some((point, i) => Math.abs(point[1] - high[i]![1]) >= 0.03 * span);
}

/** Whether moving some slider visibly changes at least one curve of the graph. */
export function plotRespondsToSliders(spec: SimulationSpec): boolean {
  const plot = spec.plot;
  if (!plot) return true;
  const ids = spec.parameters.map((p) => p.id);
  const base = Object.fromEntries(spec.parameters.map((p) => [p.id, p.default]));
  for (const curve of plot.curves)
    for (const p of spec.parameters) {
      const low = curvePoints(curve, ids, { ...base, [p.id]: p.min }, plot.xMin, plot.xMax);
      const high = curvePoints(curve, ids, { ...base, [p.id]: p.max }, plot.xMin, plot.xMax);
      if (visiblyDifferent(low, high)) return true;
    }
  return false;
}

/**
 * Whether moving a slider visibly changes the graph, not just slides a dot
 * along a fixed curve. Without a plot, the first output is drawn over the
 * first slider: another slider must reshape that curve.
 */
export function designShowsChange(spec: SimulationSpec): boolean {
  if (spec.plot) return plotRespondsToSliders(spec);
  const [first, ...others] = spec.parameters;
  const output = spec.outputs[0];
  if (!first || !output || !others.length) return false;
  const ids = spec.parameters.map((p) => p.id);
  const f = new Function('p', `return ${compileFormula(output.expr, ids)};`) as (
    p: Record<string, number>,
  ) => number;
  const base = Object.fromEntries(spec.parameters.map((p) => [p.id, p.default]));
  const sweep = (overrides: Record<string, number>) => {
    const points: Array<[number, number]> = [];
    for (let k = 0; k <= 16; k += 1) {
      const at = first.min + ((first.max - first.min) * k) / 16;
      const y = f({ ...base, ...overrides, [first.id]: at });
      if (Number.isFinite(y)) points.push([at, y]);
    }
    return points;
  };
  return others.some((p) => visiblyDifferent(sweep({ [p.id]: p.min }), sweep({ [p.id]: p.max })));
}

/** Validate and normalise a model-produced simulation spec; null when unusable. */
export function normalizeSimulationSpec(raw: unknown): SimulationSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const parameters: SimulationSpec['parameters'] = [];
  for (const item of Array.isArray(r.parameters) ? r.parameters.slice(0, 4) : []) {
    const p = item as Record<string, unknown>;
    const id = text(p?.id, 24);
    const min = Number(p?.min);
    const max = Number(p?.max);
    if (
      !ID.test(id) ||
      Object.hasOwn(FUNCTIONS, id) ||
      Object.hasOwn(CONSTANTS, id) ||
      parameters.some((x) => x.id === id)
    )
      continue; // one malformed slider does not sink the design; formulas using it are dropped
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) continue;
    let step = Number(p?.step);
    if (!Number.isFinite(step) || step <= 0 || step > max - min) step = (max - min) / 100;
    let value = Number(p?.default);
    if (!Number.isFinite(value) || value < min || value > max) value = min + (max - min) / 2;
    if (placeholder(p?.label)) return null;
    parameters.push({
      id,
      label: text(p?.label, 40) || id,
      min,
      max,
      step,
      default: value,
      ...(text(p?.unit, 12) ? { unit: text(p?.unit, 12) } : {}),
    });
  }
  if (!parameters.length) return null;
  const ids = parameters.map((p) => p.id);
  const outputs: SimulationSpec['outputs'] = [];
  for (const item of Array.isArray(r.outputs) ? r.outputs.slice(0, 4) : []) {
    const o = item as Record<string, unknown>;
    const expr = text(o?.expr, 200);
    // "slope a = a" only repeats its slider: nothing to learn from it.
    if (ids.includes(expr.replace(/\s+/g, ''))) continue;
    let compiled: string;
    try {
      compiled = compileFormula(expr, ids);
    } catch {
      continue; // drop this number, keep the rest of the design
    }
    // The output must be finite at the defaults and at most sampled points.
    const evaluate = new Function('p', `return ${compiled};`) as (
      p: Record<string, number>,
    ) => number;
    const base = Object.fromEntries(parameters.map((p) => [p.id, p.default]));
    if (!Number.isFinite(evaluate(base))) continue;
    let finite = 0;
    let total = 0;
    for (const p of parameters)
      for (let k = 0; k <= 10; k += 1) {
        total += 1;
        if (Number.isFinite(evaluate({ ...base, [p.id]: p.min + ((p.max - p.min) * k) / 10 })))
          finite += 1;
      }
    if (finite < total * 0.8) continue;
    outputs.push({
      label: text(o?.label, 40) || expr,
      expr,
      ...(o?.format === 'percent' ? { format: 'percent' as const } : {}),
    });
  }
  const plot = normalizePlot(r.plot, parameters);
  if (!outputs.length && !plot) return null;
  // A slider no formula uses changes nothing on the page (reported: 物体质量 in
  // a Newton's-third-law design): leave it out.
  const formulas = [
    ...outputs.map((o) => o.expr),
    ...(plot?.curves ?? []).flatMap((c) => [c.expr, c.start ?? '']),
    plot?.markerParam ?? '',
  ].join(' ');
  const usedParameters = parameters.filter((p) =>
    new RegExp(`(^|[^A-Za-z0-9_])${p.id}(?![A-Za-z0-9_])`).test(formulas),
  );
  if (!usedParameters.length) return null;
  parameters.splice(0, parameters.length, ...usedParameters);
  if (placeholder(r.title) || placeholder(r.intro) || outputs.some((o) => placeholder(o.label)))
    return null;
  return {
    title: text(r.title, 40),
    intro: text(r.intro, 240),
    parameters,
    outputs,
    ...(plot ? { plot } : {}),
    observations: (Array.isArray(r.observations) ? r.observations : [])
      .map((o) => text(o, 160))
      .filter(Boolean)
      .slice(0, 4),
  };
}

/** Validate and normalise a model-produced game spec; null when unusable. */
export function normalizeGameSpec(raw: unknown): GameSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const rounds: GameSpec['rounds'] = [];
  for (const item of Array.isArray(r.rounds) ? r.rounds.slice(0, 6) : []) {
    const q = item as Record<string, unknown>;
    const options = (Array.isArray(q?.options) ? q.options : [])
      .map((o) => text(o, 80))
      .filter(Boolean)
      .slice(0, 5);
    const answer = Number(q?.answer);
    const prompt = text(q?.prompt, 200);
    if (!prompt || options.length < 2 || new Set(options).size !== options.length) continue;
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
    rounds.push({ prompt, options, answer, explain: text(q?.explain, 240) });
  }
  if (rounds.length < 2) return null;
  return { title: text(r.title, 40), intro: text(r.intro, 240), rounds };
}

const UI: Record<
  FallbackLanguage,
  Record<
    | 'reset'
    | 'observe'
    | 'start'
    | 'next'
    | 'restart'
    | 'score'
    | 'correct'
    | 'wrong'
    | 'done'
    | 'prev'
    | 'step'
    | 'round'
    | 'curve'
    | 'plot'
    | 'understood'
    | 'progress',
    string
  >
> = {
  'zh-CN': {
    reset: '重置',
    observe: '观察要点',
    start: '开始',
    next: '下一题',
    restart: '再玩一次',
    score: '得分',
    correct: '回答正确！',
    wrong: '还不对。',
    done: '完成！最终得分',
    prev: '上一步',
    step: '第 {n} / {total} 步',
    round: '第 {n} / {total} 题',
    curve: '曲线：{y} 随 {x} 变化（圆点为当前值）',
    plot: '图像：{y}；横轴为 {x}。拖动滑块观察图像如何变化。',
    understood: '我理解了',
    progress: '已理解 {n} / {total} 点',
  },
  'zh-TW': {
    reset: '重設',
    observe: '觀察要點',
    start: '開始',
    next: '下一題',
    restart: '再玩一次',
    score: '得分',
    correct: '回答正確！',
    wrong: '還不對。',
    done: '完成！最終得分',
    prev: '上一步',
    step: '第 {n} / {total} 步',
    round: '第 {n} / {total} 題',
    curve: '曲線：{y} 隨 {x} 變化（圓點為目前值）',
    plot: '圖像：{y}；橫軸為 {x}。拖動滑桿觀察圖像如何變化。',
    understood: '我理解了',
    progress: '已理解 {n} / {total} 點',
  },
  en: {
    reset: 'Reset',
    observe: 'What to notice',
    start: 'Start',
    next: 'Next',
    restart: 'Play again',
    score: 'Score',
    correct: 'Correct!',
    wrong: 'Not quite.',
    done: 'Finished! Final score',
    prev: 'Back',
    step: 'Step {n} / {total}',
    round: 'Round {n} / {total}',
    curve: 'Curve: {y} against {x} (dot = current value)',
    plot: 'Graph: {y}; horizontal axis: {x}. Move the sliders to see how it changes.',
    understood: 'Got it',
    progress: 'Understood {n} / {total}',
  },
};

export function fallbackLanguage(
  languageDirective: string | undefined,
  topic: string,
): FallbackLanguage {
  const directive = languageDirective ?? '';
  if (/繁體|繁体|Traditional Chinese|zh-TW|zh-HK/i.test(directive)) return 'zh-TW';
  if (/中文|Chinese|zh/i.test(directive)) return 'zh-CN';
  if (directive.trim()) return 'en';
  return /[一-鿿]/.test(topic) ? 'zh-CN' : 'en';
}

/** Exported as data for building and checking the bundled UI dictionaries. */
export function nativeWidgetText(language: string) {
  return localizedUi(UI[language as FallbackLanguage] ?? UI.en, language);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON safe to embed inside <script>. */
const embed = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028|\u2029/g, ' ');

const CURVE_COLORS = ['#7c3aed', '#0ea5e9', '#f59e0b'];

const STYLE = `
:root{--accent:#7c3aed;--accent-soft:rgba(124,58,237,.1);--ink:#1f2937;--muted:#6b7280;--line:#e5e7eb;--ok:#059669;--bad:#dc2626}
*{box-sizing:border-box}html,body{margin:0;background:#f8fafc;color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:980px;margin:0 auto;padding:20px}h1{font-size:22px;margin:0 0 6px}p.intro{color:var(--muted);margin:0 0 16px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.grid{display:grid;grid-template-columns:minmax(240px,320px) 1fr;gap:16px}@media(max-width:720px){.grid{grid-template-columns:1fr}}
.control{margin-bottom:14px}.control label{display:flex;justify-content:space-between;font-weight:600;font-size:14px}.control output{color:var(--accent);font-variant-numeric:tabular-nums}
input[type=range]{width:100%;accent-color:var(--accent);height:28px;touch-action:manipulation}
button{min-height:44px;padding:0 18px;border-radius:10px;border:1px solid var(--accent);background:var(--accent);color:#fff;font-weight:600;font-size:15px;cursor:pointer;touch-action:manipulation}
button.secondary{background:#fff;color:var(--accent)}button:disabled{opacity:.45;cursor:not-allowed}
.results{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}
.result{background:var(--accent-soft);border-radius:10px;padding:10px 12px}.result span{display:block;font-size:13px;color:var(--muted)}.result strong{font-size:22px;font-variant-numeric:tabular-nums}
canvas{width:100%;height:320px;display:block;background:#fff;border:1px solid var(--line);border-radius:10px;touch-action:none}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;color:var(--ink);margin:0 0 8px}.legend i{display:inline-block;width:14px;height:4px;border-radius:2px;margin-right:6px;vertical-align:middle}
.caption{font-size:13px;color:var(--muted);margin-top:6px}ul.notes{margin:8px 0 0;padding-left:20px}
.option{display:block;width:100%;text-align:left;margin:8px 0;background:#fff;color:var(--ink);border:1px solid var(--line);font-weight:500}
.option:disabled{opacity:1;cursor:default}.option.correct{border-color:var(--ok);background:#ecfdf5}.option.wrong{border-color:var(--bad);background:#fef2f2}
.feedback{min-height:24px;margin:8px 0;font-weight:600}.feedback.ok{color:var(--ok)}.feedback.bad{color:var(--bad)}
.row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.hidden{display:none}
.progress{height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin:10px 0}.progress>div{height:100%;background:var(--accent);width:0;transition:width .3s}
`;

/** Shared listener for the platform's widget actions (teacher highlights, state). */
const MESSAGE_LISTENER = `
window.addEventListener('message', function (event) {
  var data = event && event.data;
  if (!data || typeof data !== 'object') return;
  var target = null;
  try { target = typeof data.target === 'string' ? document.querySelector(data.target) : null; } catch (e) { target = null; }
  if (data.type === 'SET_WIDGET_STATE' && data.state && typeof window.__applyState === 'function') window.__applyState(data.state);
  if (data.type === 'HIGHLIGHT_ELEMENT' && target) {
    target.style.outline = '3px solid rgba(124,58,237,.8)'; target.style.outlineOffset = '4px';
    setTimeout(function () { target.style.outline = ''; }, 3000);
  }
  if (data.type === 'REVEAL_ELEMENT' && target) { target.classList.remove('hidden'); target.style.display = ''; target.style.opacity = '1'; }
  if (data.type === 'ANNOTATE_ELEMENT' && target && data.content) {
    var tip = document.createElement('div');
    tip.textContent = String(data.content);
    tip.style.cssText = 'margin-top:6px;padding:6px 10px;border-radius:8px;background:rgba(124,58,237,.95);color:#fff;font-size:14px';
    target.insertAdjacentElement('afterend', tip);
    setTimeout(function () { if (tip.parentNode) tip.parentNode.removeChild(tip); }, 4000);
  }
});`;

function page(lang: string, title: string, body: string, config: unknown, script: string) {
  return `<!DOCTYPE html>
<html lang="${lang}"${lang.startsWith('ar') ? ' dir="rtl"' : ''} data-maic-platform>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
<script type="application/json" id="widget-config">${embed(config)}</script>
<script>
(function () {
${script}
${MESSAGE_LISTENER}
})();
</script>
</body>
</html>`;
}

export function renderSimulationWidget(
  spec: SimulationSpec,
  lang: FallbackLanguage,
  fallbackTitle: string,
  displayLocale: string = lang,
): string {
  const ui = nativeWidgetText(displayLocale);
  const title = spec.title || fallbackTitle;
  const ids = spec.parameters.map((p) => p.id);
  const outputs = spec.outputs.map((o) => ({
    label: o.label,
    percent: o.format === 'percent',
    js: compileFormula(o.expr, ids),
  }));
  const plot = spec.plot
    ? {
        xLabel: spec.plot.xLabel,
        xMin: spec.plot.xMin,
        xMax: spec.plot.xMax,
        markerParam:
          spec.plot.markerParam && ids.includes(spec.plot.markerParam)
            ? spec.plot.markerParam
            : null,
        curves: spec.plot.curves.map((c) => ({
          label: c.label,
          js:
            c.start !== undefined
              ? compileFormula(c.expr, [...ids, 'x', 'y'])
              : compileFormula(c.expr, [...ids, 'x']),
          startJs: c.start !== undefined ? compileFormula(c.start, ids) : null,
        })),
      }
    : null;
  const first = spec.parameters[0]!;
  const controls = spec.parameters
    .map(
      (p) => `<div class="control">
  <label for="${p.id}-slider">${escapeHtml(p.label)}<output id="${p.id}-display"></output></label>
  <input type="range" id="${p.id}-slider" data-var="${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.default}">
</div>`,
    )
    .join('\n');
  const results = outputs.length
    ? `<div class="results">${outputs
        .map(
          (o, i) =>
            `<div class="result"><span>${escapeHtml(o.label)}</span><strong id="output-${i}-display">–</strong></div>`,
        )
        .join('')}</div>`
    : '';
  const notes = spec.observations.length
    ? `<div class="card" style="margin-top:16px"><strong>${ui.observe}</strong><ul class="notes">${spec.observations
        .map((o) => `<li>${escapeHtml(o)}</li>`)
        .join('')}</ul></div>`
    : '';
  const caption = plot
    ? ui.plot
        .replace('{y}', plot.curves.map((c) => escapeHtml(c.label)).join('、'))
        .replace('{x}', escapeHtml(plot.xLabel))
    : ui.curve
        .replace('{y}', escapeHtml(outputs[0]!.label))
        .replace('{x}', escapeHtml(first.label));
  const legend = plot
    ? `<div class="legend">${plot.curves
        .map(
          (c, i) =>
            `<span><i style="background:${CURVE_COLORS[i]}"></i>${escapeHtml(c.label)}</span>`,
        )
        .join('')}</div>`
    : '';
  const body = `<h1>${escapeHtml(title)}</h1>
${spec.intro ? `<p class="intro">${escapeHtml(spec.intro)}</p>` : ''}
<div class="grid">
  <div class="card" id="controls">
${controls}
    <button type="button" id="reset-btn" class="secondary">${ui.reset}</button>
  </div>
  <div class="card">
    ${results}
    ${legend}
    <canvas id="chart-canvas" aria-label="${caption}"></canvas>
    <div class="caption">${caption}</div>
  </div>
</div>
${notes}`;
  const config = {
    type: 'simulation',
    concept: title,
    description: spec.intro,
    variables: spec.parameters.map((p) => ({
      name: p.id,
      label: p.label,
      min: p.min,
      max: p.max,
      default: p.default,
      unit: p.unit ?? '',
    })),
  };
  const script = `
var params = ${embed(spec.parameters)};
var formulas = [${outputs.map((o) => `function (p) { return ${o.js}; }`).join(',\n')}];
var percent = ${embed(outputs.map((o) => o.percent))};
var plot = ${plot ? `{ xMin: ${plot.xMin}, xMax: ${plot.xMax}, xLabel: ${embed(plot.xLabel)}, marker: ${embed(plot.markerParam)}, curves: [${plot.curves.map((c) => `{ f: function (p) { return ${c.js}; }, start: ${c.startJs ? `function (p) { return ${c.startJs}; }` : 'null'} }`).join(', ')}] }` : 'null'};
var colors = ${embed(CURVE_COLORS)};
function fmt(v, asPercent) {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  if (asPercent) return (v * 100).toFixed(Math.abs(v) < 0.1 ? 2 : 1) + '%';
  var a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(3);
  // Readable precision: 13.24, 0.0731 — not 13.2381.
  var digits = a >= 100 ? 1 : a >= 1 ? 2 : 4;
  var m = Math.pow(10, digits);
  return String(Math.round(v * m) / m);
}
function current() {
  var p = {};
  params.forEach(function (d) {
    var el = document.getElementById(d.id + '-slider');
    var v = el ? Number(el.value) : d.default;
    p[d.id] = isFinite(v) ? v : d.default;
  });
  return p;
}
function safe(f, p) { try { var v = f(p); return typeof v === 'number' ? v : NaN; } catch (e) { return NaN; } }
function niceTicks(lo, hi, n) {
  var raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
  var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  var out = [];
  for (var t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) out.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  return out;
}
var yAxis = null;
/** Series: [{points:[[x,y],...], color, marker:[x,y]|null}] over [x0,x1]. */
function chart(series, x0, x1) {
  var canvas = document.getElementById('chart-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  var rect = canvas.getBoundingClientRect();
  var ratio = window.devicePixelRatio || 1;
  var w = Math.max(240, Math.round(rect.width || 600)), h = Math.max(200, Math.round(rect.height || 300));
  canvas.width = w * ratio; canvas.height = h * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  var ys = [];
  series.forEach(function (s) { s.points.forEach(function (pt) { ys.push(pt[1]); }); });
  if (!ys.length) return;
  ys.sort(function (a, b) { return a - b; });
  // Trim the extreme 2% only when they are outliers (an asymptote), so bounded
  // curves keep their true end points.
  var lo = ys[0], hi = ys[ys.length - 1];
  var lo2 = ys[Math.floor(ys.length * 0.02)], hi2 = ys[Math.ceil(ys.length * 0.98) - 1];
  // Thresholds relative to the values' magnitude: physical constants make
  // curves of order 1e-13, which an absolute 1e-9 would flatten to a line at 0.
  var mag = Math.max(Math.abs(lo), Math.abs(hi), Number.MIN_VALUE);
  if (hi - lo > 10 * Math.max(hi2 - lo2, mag * 1e-9)) { lo = lo2; hi = hi2; }
  // A long tail on one side (1/r² near r = 0) would squash the rest of the
  // curve into a line at the bottom: that side is cut a little past the bulk of
  // the values; the curve runs off the edge there instead.
  var q10 = ys[Math.floor(ys.length * 0.1)], q90 = ys[Math.ceil(ys.length * 0.9) - 1];
  var bulk = Math.max(q90 - q10, mag * 1e-9);
  if (hi - q90 > 6 * bulk) hi = q90 + 3 * bulk;
  if (q10 - lo > 6 * bulk) lo = q10 - 3 * bulk;
  if (hi - lo <= mag * 1e-9) { var pad = mag > 1e-300 ? mag * 0.5 : 1; hi += pad; lo -= pad; }
  var padY = (hi - lo) * 0.08; lo -= padY; hi += padY;
  // The vertical axis holds still while sliders move, so a change of the curve
  // is seen as a change (re-scaling every frame made a shrinking force look the
  // same). It grows to fit; it re-fits only when the curve would become a flat
  // sliver, and Reset starts from the curve again.
  if (yAxis) {
    var span = hi - lo, held = yAxis.hi - yAxis.lo;
    if (span >= held / 50) { lo = Math.min(lo, yAxis.lo); hi = Math.max(hi, yAxis.hi); }
  }
  yAxis = { lo: lo, hi: hi };
  ctx.font = '12px system-ui, sans-serif';
  // The left margin fits the widest tick label (1.500e-9 is wider than 100).
  var labelWidth = 0;
  niceTicks(lo, hi, 6).forEach(function (t) { labelWidth = Math.max(labelWidth, ctx.measureText(fmt(t, plot ? false : percent[0])).width); });
  var L = Math.max(44, Math.ceil(labelWidth) + 14), R = 14, T = 12, B = 34, pw = w - L - R, ph = h - T - B;
  var sx = function (x) { return L + (x - x0) / (x1 - x0) * pw; };
  var sy = function (y) { return T + (hi - y) / (hi - lo) * ph; };
  ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#eef0f4'; ctx.lineWidth = 1; ctx.fillStyle = '#6b7280';
  niceTicks(lo, hi, 6).forEach(function (t) {
    var y = sy(t); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(fmt(t, plot ? false : percent[0]), L - 6, y);
  });
  ctx.textBaseline = 'top';
  niceTicks(x0, x1, 6).forEach(function (t) {
    var x = sx(t); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillText(fmt(t, false), x, T + ph + 6);
  });
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.2;
  if (lo < 0 && hi > 0) { ctx.beginPath(); ctx.moveTo(L, sy(0)); ctx.lineTo(L + pw, sy(0)); ctx.stroke(); }
  if (x0 < 0 && x1 > 0) { ctx.beginPath(); ctx.moveTo(sx(0), T); ctx.lineTo(sx(0), T + ph); ctx.stroke(); }
  ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
  // A curve lying on an earlier one (action and reaction force) is drawn dashed
  // so both colours stay visible.
  var covers = function (a, b) {
    if (a.points.length !== b.points.length || !a.points.length) return false;
    return a.points.every(function (pt, k) { return Math.abs(pt[1] - b.points[k][1]) <= (hi - lo) * 0.01; });
  };
  series.forEach(function (s, i) {
    var hidden = series.slice(0, i).some(function (other) { return covers(s, other); });
    ctx.setLineDash(hidden ? [10, 8] : []);
    ctx.strokeStyle = s.color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.beginPath();
    var drawing = false, prev = null;
    s.points.forEach(function (pt) {
      // Break the line at jumps (asymptotes) instead of drawing a vertical bar.
      var jump = prev && Math.abs(pt[1] - prev[1]) > (hi - lo) * 1.5;
      if (!drawing || jump) ctx.moveTo(sx(pt[0]), sy(pt[1])); else ctx.lineTo(sx(pt[0]), sy(pt[1]));
      drawing = true; prev = pt;
    });
    ctx.stroke();
    ctx.setLineDash([]);
    if (s.dots && s.points.length <= 60) {
      ctx.fillStyle = s.color;
      s.points.forEach(function (pt) { ctx.beginPath(); ctx.arc(sx(pt[0]), sy(pt[1]), 3, 0, Math.PI * 2); ctx.fill(); });
    }
    if (s.marker) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(sx(s.marker[0]), sy(s.marker[1]), 6, 0, Math.PI * 2); ctx.fill(); }
  });
  ctx.restore();
}
function sample(f, p, key, x0, x1) {
  var pts = [];
  for (var i = 0; i <= 240; i++) {
    var x = x0 + (x1 - x0) * i / 240, q = {};
    for (var k in p) q[k] = p[k];
    q[key] = x;
    var y = safe(f, q);
    if (isFinite(y)) pts.push([x, y]);
  }
  return pts;
}
/** A sequence: its first value from start, each next one from the current value y at step x. */
function iterate(c, p, x0, x1) {
  var pts = [], k = Math.ceil(x0), last = Math.min(Math.floor(x1), k + 200), y = safe(c.start, p);
  for (; k <= last; k++) {
    if (!isFinite(y) || Math.abs(y) > 1e9) break;
    pts.push([k, y]);
    var q = {}; for (var key in p) q[key] = p[key];
    q.x = k; q.y = y;
    y = safe(c.f, q);
  }
  return pts;
}
function draw(p) {
  if (plot) {
    chart(plot.curves.map(function (c, i) {
      if (c.start) return { points: iterate(c, p, plot.xMin, plot.xMax), color: colors[i], marker: null, dots: true };
      var mark = null;
      if (plot.marker) {
        var q = {}; for (var k in p) q[k] = p[k];
        q.x = p[plot.marker];
        var my = safe(c.f, q);
        if (isFinite(my)) mark = [q.x, my];
      }
      return { points: sample(c.f, p, 'x', plot.xMin, plot.xMax), color: colors[i], marker: mark };
    }), plot.xMin, plot.xMax);
    return;
  }
  var d = params[0], cy = safe(formulas[0], p);
  chart([{ points: sample(formulas[0], p, d.id, d.min, d.max), color: colors[0],
    marker: isFinite(cy) ? [p[d.id], cy] : null }], d.min, d.max);
}
function update() {
  var p = current();
  params.forEach(function (d) {
    var out = document.getElementById(d.id + '-display');
    if (out) out.textContent = fmt(p[d.id], false) + (d.unit ? ' ' + d.unit : '');
  });
  formulas.forEach(function (f, i) {
    var el = document.getElementById('output-' + i + '-display');
    if (el) el.textContent = fmt(safe(f, p), percent[i]);
  });
  draw(p);
}
window.__applyState = function (state) {
  params.forEach(function (d) {
    var el = document.getElementById(d.id + '-slider');
    if (el && state && state[d.id] !== undefined && isFinite(Number(state[d.id]))) el.value = String(state[d.id]);
  });
  update();
};
params.forEach(function (d) {
  var el = document.getElementById(d.id + '-slider');
  if (el) { el.addEventListener('input', update); el.addEventListener('change', update); }
});
var reset = document.getElementById('reset-btn');
if (reset) reset.addEventListener('click', function () {
  params.forEach(function (d) { var el = document.getElementById(d.id + '-slider'); if (el) el.value = String(d.default); });
  yAxis = null;
  update();
});
window.addEventListener('resize', update);
update();`;
  return page(displayLocale, title, body, config, script);
}

export function renderGameWidget(
  spec: GameSpec,
  lang: FallbackLanguage,
  fallbackTitle: string,
  displayLocale: string = lang,
): string {
  const ui = nativeWidgetText(displayLocale);
  const title = spec.title || fallbackTitle;
  const body = `<h1>${escapeHtml(title)}</h1>
${spec.intro ? `<p class="intro">${escapeHtml(spec.intro)}</p>` : ''}
<div class="card">
  <div class="row"><strong id="round-display"></strong><span>${ui.score} <strong id="score-display">0</strong></span></div>
  <div class="progress"><div id="progress-bar"></div></div>
  <div id="start-panel"><button type="button" id="start-btn">${ui.start}</button></div>
  <div id="play-panel" class="hidden">
    <p id="prompt-display" style="font-size:17px;font-weight:600"></p>
    <div id="options"></div>
    <div id="feedback" class="feedback" aria-live="polite"></div>
    <button type="button" id="next-btn" disabled>${ui.next}</button>
  </div>
  <div id="end-panel" class="hidden">
    <p id="final-display" style="font-size:18px;font-weight:700"></p>
    <button type="button" id="restart-btn">${ui.restart}</button>
  </div>
</div>`;
  const config = { type: 'game', gameType: 'quiz', concept: title, rounds: spec.rounds.length };
  const script = `
var rounds = ${embed(spec.rounds)};
var ui = ${embed({ step: ui.round, correct: ui.correct, wrong: ui.wrong, done: ui.done })};
var state = { index: 0, score: 0, answered: false };
function el(id) { return document.getElementById(id); }
function setText(id, value) { var node = el(id); if (node) node.textContent = value; }
function show(id) { ['start-panel', 'play-panel', 'end-panel'].forEach(function (p) { var n = el(p); if (n) n.classList.toggle('hidden', p !== id); }); }
function progress() {
  setText('round-display', ui.step.replace('{n}', String(Math.min(state.index + 1, rounds.length))).replace('{total}', String(rounds.length)));
  var bar = el('progress-bar'); if (bar) bar.style.width = (state.index / rounds.length * 100) + '%';
  setText('score-display', String(state.score));
}
function choose(k) {
  if (state.answered) return;
  state.answered = true;
  var round = rounds[state.index];
  var buttons = document.querySelectorAll('#options .option');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].disabled = true;
    if (i === round.answer) buttons[i].classList.add('correct');
    else if (i === k) buttons[i].classList.add('wrong');
  }
  var ok = k === round.answer;
  if (ok) state.score += 10;
  var fb = el('feedback');
  if (fb) { fb.className = 'feedback ' + (ok ? 'ok' : 'bad'); fb.textContent = (ok ? ui.correct : ui.wrong) + (round.explain ? ' ' + round.explain : ''); }
  var next = el('next-btn'); if (next) next.disabled = false;
  progress();
}
function render() {
  var round = rounds[state.index];
  state.answered = false;
  setText('prompt-display', round.prompt);
  var box = el('options');
  if (box) {
    while (box.firstChild) box.removeChild(box.firstChild);
    round.options.forEach(function (text, k) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'option'; b.id = 'option-' + k; b.textContent = text;
      b.addEventListener('click', function () { choose(k); });
      box.appendChild(b);
    });
  }
  var fb = el('feedback'); if (fb) { fb.className = 'feedback'; fb.textContent = ''; }
  var next = el('next-btn'); if (next) next.disabled = true;
  progress();
}
function start() { state.index = 0; state.score = 0; show('play-panel'); render(); }
function next() {
  if (!state.answered) return;
  state.index += 1;
  if (state.index >= rounds.length) {
    show('end-panel');
    var bar = el('progress-bar'); if (bar) bar.style.width = '100%';
    setText('final-display', ui.done + ' ' + state.score + ' / ' + rounds.length * 10);
    return;
  }
  render();
}
window.__applyState = function () {};
var s = el('start-btn'); if (s) s.addEventListener('click', start);
var r = el('restart-btn'); if (r) r.addEventListener('click', start);
var n = el('next-btn'); if (n) n.addEventListener('click', next);
progress();`;
  return page(displayLocale, title, body, config, script);
}

const CHECKLIST: Record<
  FallbackLanguage,
  Record<'algorithm' | 'concept', { name: string; intro: string; button: string; progress: string }>
> = {
  'zh-CN': {
    algorithm: {
      name: '算法核心逻辑剖析与手算追踪清单',
      intro: '逐条剖析算法的核心逻辑：先在纸上手算这一步的状态变化，再点“标记为已手算”。',
      button: '标记为已手算',
      progress: '已手算核对 {n} / {total} 步',
    },
    concept: {
      name: '核心概念剖析与要点追踪清单',
      intro: '逐条梳理本课的核心要点：读懂一条、能用自己的话复述，就点“我理解了”。',
      button: '我理解了',
      progress: '已理解 {n} / {total} 点',
    },
  },
  'zh-TW': {
    algorithm: {
      name: '演算法核心邏輯剖析與手算追蹤清單',
      intro: '逐條剖析演算法的核心邏輯：先在紙上手算這一步的狀態變化，再點「標記為已手算」。',
      button: '標記為已手算',
      progress: '已手算核對 {n} / {total} 步',
    },
    concept: {
      name: '核心概念剖析與要點追蹤清單',
      intro: '逐條梳理本課的核心要點：讀懂一條、能用自己的話複述，就點「我理解了」。',
      button: '我理解了',
      progress: '已理解 {n} / {total} 點',
    },
  },
  en: {
    algorithm: {
      name: 'Core Logic Breakdown & Hand-Trace Checklist',
      intro:
        'Work through the core logic point by point: trace each step by hand on paper, then mark it as traced.',
      button: 'Mark as traced',
      progress: 'Traced {n} / {total} steps',
    },
    concept: {
      name: 'Key Concepts Breakdown & Checklist',
      intro:
        'Go through the key points one by one; when you can explain one in your own words, tick "Got it".',
      button: 'Got it',
      progress: 'Understood {n} / {total}',
    },
  },
};

/**
 * The page an interactive slot shows when no checked simulator or game design
 * is available: a positive, self-contained activity (a breakdown of the core
 * logic to trace by hand), never a "could not generate" message.
 */
export function renderConceptStepsWidget(
  title: string,
  steps: readonly string[],
  lang: FallbackLanguage,
  widgetType: string,
  kind: 'algorithm' | 'concept' = 'concept',
): string {
  const text = CHECKLIST[lang][kind];
  const cards = (steps.length ? steps : [title]).map((s) => s.slice(0, 400)).slice(0, 8);
  // Every point is visible at once; each has its own button, so nothing is
  // ever greyed out at the end (the old Back / Next pager looked broken).
  const body = `<h1>${escapeHtml(text.name)}</h1>
<p class="intro"><strong>${escapeHtml(title)}</strong> · ${escapeHtml(text.intro)}</p>
<div class="card">
  <div class="row"><strong id="step-display"></strong></div>
  <div class="progress"><div id="progress-bar"></div></div>
  <ol class="notes" id="points">${cards
    .map(
      (c, i) =>
        `<li id="point-${i}" style="margin:12px 0"><span>${escapeHtml(c)}</span> <button type="button" class="secondary" data-point="${i}" aria-pressed="false">${escapeHtml(text.button)}</button></li>`,
    )
    .join('')}</ol>
</div>`;
  const script = `
var total = ${cards.length};
var label = ${embed(text.progress)};
var done = {};
function render() {
  var n = 0; for (var k in done) if (done[k]) n += 1;
  var s = document.getElementById('step-display'); if (s) s.textContent = label.replace('{n}', String(n)).replace('{total}', String(total));
  var b = document.getElementById('progress-bar'); if (b) b.style.width = (n / total * 100) + '%';
  for (var i = 0; i < total; i++) {
    var li = document.getElementById('point-' + i); if (li) li.style.opacity = done[i] ? '0.6' : '1';
    var btn = document.querySelector('[data-point="' + i + '"]'); if (btn) btn.setAttribute('aria-pressed', done[i] ? 'true' : 'false');
  }
}
window.__applyState = function (state) { if (state && isFinite(Number(state.step))) { var upto = Math.max(0, Math.min(total, Number(state.step) + 1)); done = {}; for (var i = 0; i < upto; i++) done[i] = true; render(); } };
document.querySelectorAll('[data-point]').forEach(function (btn) {
  btn.addEventListener('click', function () { var i = Number(btn.getAttribute('data-point')); done[i] = !done[i]; render(); });
});
render();`;
  return page(
    lang,
    `${title} · ${text.name}`,
    body,
    { type: widgetType, concept: title, steps: cards.length },
    script,
  );
}
