/**
 * Make sure a model-written interactive widget actually runs.
 *
 * 1. Run the page through the runtime smoke test (scripts, load, every control).
 * 2. On errors, ask the model to repair the page, feeding back the exact
 *    errors and the element ids that exist (at most two repairs).
 * 3. If it still fails, replace it with a platform-owned page whose code is
 *    fixed and tested; the model only supplies a small JSON spec for it.
 *
 * Algorithm simulators and Labs are app-owned and never pass through here.
 */
import { jsonrepair } from 'jsonrepair';
import { extractWidgetConfig, postProcessInteractiveHtml } from '@openmaic/generation';
import type { GeneratedInteractiveContent, SceneOutline } from '@/lib/types/generation';
import type { WidgetConfig, WidgetType } from '@/lib/types/widgets';
import { smokeTestWidget, type WidgetSmokeResult } from '../widget-smoke-test';
import { presetSimulationDesign } from '../simulation-presets';
import { localizeWidgetSpec } from '../widget-display';
import { contentLanguage } from '@/lib/eduplus/content-language';
import {
  contradictionFeedback,
  contradictions,
  designDirections,
  directionPrompt,
  withoutContradictions,
} from '../simulation-check';
import {
  fallbackLanguage,
  normalizeGameSpec,
  normalizeSimulationSpec,
  renderGameWidget,
  renderSimulationWidget,
  designShowsChange,
  type FallbackLanguage,
  type GameSpec,
  type SimulationSpec,
} from '../widget-fallback';

type AiCall = (system: string, user: string, signal?: AbortSignal) => Promise<string>;
interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface WidgetReliabilityInput {
  content: GeneratedInteractiveContent | null;
  outline: SceneOutline;
  aiCall: AiCall;
  log: Logger;
  languageDirective?: string;
  /** Regenerate from scratch when the first generation produced nothing usable. */
  regenerate?: (signal?: AbortSignal) => Promise<GeneratedInteractiveContent | null>;
  /** Epoch ms by which this step must be done; model calls never run past it. */
  deadlineAt?: number;
  /** How long the first generation took; a repair rewrites the page, so it costs about the same. */
  generationMs?: number;
  /** The page's planned design; used for the topic check and as the native page's data. */
  design?: SimulationSpec | null;
  /** Injectable for tests. */
  smokeTest?: (html: string, widgetType?: string) => Promise<WidgetSmokeResult>;
  now?: () => number;
}

const MAX_REPAIRS = 2;
const MAX_REPAIR_INPUT = 60_000;
/** A spec is a short JSON answer; keep at least this much time for it. */
const SPEC_CALL_MIN_MS = 45_000;
/** Minimum time worth starting any model call with. */
const MIN_CALL_MS = 20_000;

class Budget {
  constructor(
    private readonly deadlineAt: number | undefined,
    private readonly now: () => number,
  ) {}
  remaining(): number {
    return this.deadlineAt === undefined ? Infinity : this.deadlineAt - this.now();
  }
  /** Whether a call expected to take `expectedMs` (plus a spec call after it) still fits. */
  allows(expectedMs: number, reserveMs = 0): boolean {
    return this.remaining() >= Math.max(MIN_CALL_MS, expectedMs) + reserveMs;
  }
  /** Run a model call, aborted once only `reserveMs` of the budget would remain. */
  call(
    aiCall: AiCall,
    system: string,
    user: string,
    reserveMs = 0,
    maxCallMs = Infinity,
  ): Promise<string> {
    return this.run((signal) => aiCall(system, user, signal), reserveMs, maxCallMs);
  }
  async run<T>(
    task: (signal?: AbortSignal) => Promise<T>,
    reserveMs = 0,
    maxCallMs = Infinity,
  ): Promise<T> {
    // Do not subtract Infinity from Infinity for calls without a step deadline.
    // Compute the cap at the call boundary, not from an earlier clock reading.
    const reserve = Number.isFinite(reserveMs) ? Math.max(0, reserveMs) : 0;
    const remaining = Math.min(this.remaining() - reserve, maxCallMs);
    if (remaining === Infinity) return task();
    if (!Number.isFinite(remaining) || remaining <= 0)
      throw new Error('widget repair budget exhausted');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          controller.abort();
          reject(new Error('widget repair budget exhausted'));
        },
        Math.max(0, remaining),
      );
    });
    try {
      return await Promise.race([task(controller.signal), expired]);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function extractHtmlDocument(response: string): string | null {
  const start = response.search(/<!DOCTYPE html>|<html[\s>]/i);
  if (start !== -1) {
    const end = response.toLowerCase().lastIndexOf('</html>');
    if (end > start) return response.slice(start, end + 7);
  }
  const block = /```(?:html)?\s*([\s\S]*?)```/i.exec(response);
  if (block && /<html|<!DOCTYPE/i.test(block[1]!)) return block[1]!.trim();
  return null;
}

export function extractJsonObject(response: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(response);
  const source = fenced ? fenced[1]! : response;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const body = source.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {
    try {
      return JSON.parse(jsonrepair(body));
    } catch {
      return null;
    }
  }
}

function elementIds(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .matchAll(/\sid\s*=\s*["']([^"']+)["']/gi))
    ids.add(m[1]!);
  return [...ids].slice(0, 80);
}

function repairPrompt(html: string, errors: string[], lang: FallbackLanguage, design = '') {
  const system =
    lang === 'en'
      ? 'You are a front-end debugging engineer. You fix runtime errors in a self-contained HTML teaching widget. Return ONLY the complete corrected HTML document, from <!DOCTYPE html> to </html>, with no explanation.'
      : '你是前端调试工程师，负责修复自包含 HTML 教学互动页中的运行时错误。只输出修复后的完整 HTML 文档（从 <!DOCTYPE html> 到 </html>），不要任何解释。';
  const ids = elementIds(html);
  const user =
    lang === 'en'
      ? `This widget throws these errors in the browser when it loads or when a learner uses its controls:
${errors.map((e) => `- ${e}`).join('\n')}

Element ids that exist in the page: ${ids.join(', ') || '(none)'}

Fix every error while keeping the topic, layout, wording and language unchanged:
- Every variable and function must be declared before it is used; never rely on an element id as a global variable — use document.getElementById with an id from the list above.
- Every element looked up by id or selector must exist in the HTML; if you need a new element, add it to the HTML.
- Check lookups before use (if (!el) return;). Do not load external scripts.
- Every <select> needs real <option> elements; never display undefined, null, NaN or [object Object] — initialise every value and compute every result.

${design ? `\nThe page must implement this design:\n${design}\n` : ''}
Page:
${html.slice(0, MAX_REPAIR_INPUT)}`
      : `这个互动页在浏览器加载或学生操作控件时报出以下错误：
${errors.map((e) => `- ${e}`).join('\n')}

页面中实际存在的元素 id：${ids.join('、') || '（无）'}

请修复所有错误，同时保持主题、布局、文字和语言不变：
- 每个变量和函数都必须先声明再使用；不要把元素 id 当作全局变量，用 document.getElementById 获取上面列出的 id。
- 按 id 或选择器查找的元素必须在 HTML 中存在；需要新元素就把它写进 HTML。
- 使用前检查查找结果（if (!el) return;）。不要加载外部脚本。
- 每个 <select> 都要写入实际的 <option>；页面上不得显示 undefined、null、NaN 或 [object Object]，所有数值都要初始化并正确计算。

${design ? `\n页面必须实现以下设计：\n${design}\n` : ''}
页面：
${html.slice(0, MAX_REPAIR_INPUT)}`;
  return { system, user };
}

function specPrompt(kind: 'simulation' | 'game', outline: SceneOutline, lang: FallbackLanguage) {
  const topic = [outline.title, outline.description, ...(outline.keyPoints ?? [])]
    .filter(Boolean)
    .join('；')
    .slice(0, 1200);
  const concept = topicCore(outline.widgetOutline?.concept || outline.title);
  if (kind === 'simulation') {
    const system =
      lang === 'en'
        ? 'You design the data for an interactive teaching simulation. Output ONLY one JSON object, no prose.'
        : '你为教学交互模拟设计数据。只输出一个 JSON 对象，不要其他文字。';
    // Placeholders only: a small model copies any concrete example verbatim.
    const user =
      lang === 'en'
        ? `Topic: ${concept}\nContext: ${topic}\n\nDesign an interactive graph for THIS topic: 1–3 sliders (parameters) and 1–3 curves y = f(x; parameters) whose formulas are correct for this topic. Every curve formula must contain x, the horizontal axis variable (a formula in the sliders alone draws a flat line); moving a slider must visibly change the graph. Sliders are quantities a learner could change in a real experiment (a mass, a distance, an angle, a rate); a constant of nature (gravitational constant, speed of light, g, π) is never a slider - write its correct value as a number inside the formulas. Every slider's unit must be that quantity's own unit. Add 1–3 live numbers (outputs) computed from the parameters - the key results the learner reads while dragging - and 2–3 observations, each naming what changes and in which direction. If the topic is an algorithm or an iterative method, graph the quantity it works on step by step: write that curve as a sequence with \"start\" (the starting value, a formula in parameter ids) and \"expr\" (the next value, a formula in y = the current value, x = the step number, and parameter ids), with xMin 0 and xMax the number of steps; the sliders are the algorithm's tunable values (step size, starting point, coefficients).\nReply with one JSON object of this shape (replace every <…> with real content about "${concept}"; no <, >, or … may remain):\n{"title":"<page title naming ${concept}>","intro":"<one sentence: what to try>","parameters":[{"id":"<short ASCII id, not x>","label":"<parameter name>","min":<number>,"max":<number>,"step":<number>,"default":<number>,"unit":"<unit or empty>"}],"plot":{"xLabel":"<meaning of the horizontal axis>","xMin":<number>,"xMax":<number>,"curves":[{"label":"<curve name>","expr":"<formula in x and parameter ids>"}]},"outputs":[{"label":"<quantity name>","expr":"<formula in parameter ids>","format":"number"}],"observations":["<what the learner should notice>"]}\nRules: formulas use only x, parameter ids, numbers, + - * / ^ ( ) and sqrt abs exp ln log10 sin cos tan asin acos atan min max pow floor sign pi e; format is "percent" for probabilities or ratios, otherwise "number". All text in English.`
        : `主题：${concept}\n背景：${topic}\n\n为这个主题设计一个交互图像：1–3 个滑块（参数），以及 1–3 条按本主题正确公式画出的曲线 y = f(x; 参数)。每条曲线的公式都必须包含横轴变量 x（只含滑块参数的公式会画成水平直线），拖动滑块时图像要明显变化。滑块必须是学生在真实实验中能改变的量（质量、距离、角度、速率等）；自然常数（万有引力常量、光速、重力加速度 g、π 等）不能做成滑块，而是以正确数值直接写进公式。每个滑块的单位必须是该物理量自己的单位。必须给出 1–3 个由参数实时计算的数值（outputs），即学生拖动时读取的关键结果；并给出 2–3 条观察要点，每条说明什么量如何变化。如果主题是算法或迭代方法，就逐步画出它所处理的量：把这条曲线写成数列，给出 \"start\"（初始值，关于参数 id 的公式）和 \"expr\"（下一步的值，关于 y=当前值、x=第几步以及参数 id 的公式），xMin 取 0，xMax 取迭代步数；滑块是算法可调的量（步长、初始值、系数等）。\n只回复一个如下结构的 JSON 对象（把每个 <…> 换成关于“${concept}”的真实内容，结果中不得残留 <、> 或 …）：\n{"title":"<含“${concept}”的页面标题>","intro":"<一句话说明可以尝试什么>","parameters":[{"id":"<简短英文标识符，不能是 x>","label":"<参数名称>","min":<数字>,"max":<数字>,"step":<数字>,"default":<数字>,"unit":"<单位或留空>"}],"plot":{"xLabel":"<横轴含义>","xMin":<数字>,"xMax":<数字>,"curves":[{"label":"<曲线名称>","expr":"<关于 x 和参数 id 的公式>"}]},"outputs":[{"label":"<数值名称>","expr":"<关于参数 id 的公式>","format":"number"}],"observations":["<学生应注意到的现象>"]}\n规则：公式只能使用 x、参数 id、数字、+ - * / ^ ( ) 以及 sqrt abs exp ln log10 sin cos tan asin acos atan min max pow floor sign pi e；概率或比例用 "percent"，否则用 "number"。所有文字使用课程语言。`;
    return { system, user };
  }
  const system =
    lang === 'en'
      ? 'You write the rounds of a short teaching game. Output ONLY one JSON object, no prose.'
      : '你为简短的教学游戏编写关卡。只输出一个 JSON 对象，不要其他文字。';
  const user =
    lang === 'en'
      ? `Topic: ${concept}\nContext: ${topic}\n\nWrite 4 rounds. Each round is a concrete situation or calculation about this topic with 3–4 options, exactly one correct.\nJSON format:\n{"title":"...","intro":"one sentence","rounds":[{"prompt":"...","options":["...","...","..."],"answer":0,"explain":"why"}]}\nanswer is the 0-based index of the correct option. Check every answer. All text in English.`
      : `主题：${concept}\n背景：${topic}\n\n编写 4 个关卡。每关是关于该主题的具体情境或计算，给出 3–4 个选项且只有一个正确。\nJSON 格式：\n{"title":"...","intro":"一句话","rounds":[{"prompt":"...","options":["...","...","..."],"answer":0,"explain":"理由"}]}\nanswer 为正确选项从 0 开始的序号。逐题核对答案。所有文字使用课程语言。`;
  return { system, user };
}

/** The subject of a request: "请为我讲解反函数" → "反函数". */
export function topicCore(text: string): string {
  const core = text
    .trim()
    .replace(
      /^(?:请|麻烦|能否|可以)?(?:你)?(?:为我|给我|帮我|向我|问我)?(?:详细|简单)?(?:讲解|讲讲|讲一下|介绍|解释|说明|学习|讲)(?:一下)?/,
      '',
    )
    .replace(/^(?:please\s+)?(?:explain|teach(?:\s+me)?|introduce|describe)\s+/i, '')
    .replace(/[。.!！?？]+$/, '')
    .trim();
  return core || text.trim();
}

const coreLabel = (label: string) =>
  label
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[=:：].*$/, '')
    .trim();

/** Short, human-readable design the native template should implement. */
export function designBrief(spec: SimulationSpec, concept: string, lang: FallbackLanguage): string {
  const range = (p: SimulationSpec['parameters'][number]) =>
    `${p.min}–${p.max}${p.unit ? ` ${p.unit}` : ''}`;
  if (lang === 'en')
    return [
      `Build the simulation around "${concept}" exactly as designed below. Do not reuse unrelated template examples (a generic moving ball, X/Y sliders).`,
      `- Title: ${spec.title || concept}. Intro: ${spec.intro}`,
      `- Sliders (id="<id>-slider"): ${spec.parameters.map((p) => `${p.label} [${p.id}], range ${range(p)}, step ${p.step}, default ${p.default}`).join('; ')}`,
      `- Compute and display live: ${spec.outputs.map((o) => `${o.label} = ${o.expr}`).join('; ')}`,
      `- Canvas: draw the graph of these formulas (e.g. the first output as a curve over the first parameter's range, marking the current value); it must update as sliders move.`,
      spec.observations.length
        ? `- Ask the learner to notice: ${spec.observations.join('; ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  return [
    `必须围绕“${concept}”按以下设计实现本页，不要照搬与主题无关的模板示例（如通用的小球运动、X值/Y值滑块）。`,
    `- 页面标题：${spec.title || concept}；导语：${spec.intro}`,
    `- 滑块（id="<参数id>-slider"）：${spec.parameters.map((p) => `${p.label}［${p.id}］，范围 ${range(p)}，步长 ${p.step}，默认 ${p.default}`).join('；')}`,
    `- 实时计算并显示：${spec.outputs.map((o) => `${o.label} = ${o.expr}`).join('；')}`,
    `- 画布：画出与这些公式对应的图像（例如以第一个参数的取值范围为横轴画出第一个输出的曲线，并标出当前取值），拖动滑块时图像和数值同步变化。`,
    spec.observations.length ? `- 引导学生观察：${spec.observations.join('；')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The outline handed to the native template, carrying the planned design. */
export function outlineWithDesign(
  outline: SceneOutline,
  spec: SimulationSpec,
  lang: FallbackLanguage,
): SceneOutline {
  const concept = topicCore(outline.widgetOutline?.concept || outline.title);
  return {
    ...outline,
    description: `${outline.description ?? ''}\n\n${designBrief(spec, concept, lang)}`.trim(),
    widgetOutline: {
      ...outline.widgetOutline,
      concept,
      keyVariables: spec.parameters.map((p) => `${p.label} (${p.id})`),
    },
  };
}

/**
 * Whether the page is about the topic: its text (including scripts and the
 * widget config, where labels are often set) must name the topic or one of
 * the planned parameters/outputs. A copied template example names neither.
 */
export function mentionsTopic(html: string, spec: SimulationSpec, concept: string): boolean {
  const text = html.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  const terms = [
    concept,
    ...spec.parameters.map((p) => coreLabel(p.label)),
    ...spec.outputs.map((o) => coreLabel(o.label)),
  ].filter((t) => t.length >= 2 && !/^[A-Za-z]$/.test(t));
  return terms.some((t) => text.includes(t));
}

const CONSTANT =
  /常数|常量|恒量|\bconstant\b|speed of light|光速|普朗克|planck|阿伏伽德罗|avogadro|玻尔兹曼|boltzmann/i;

/**
 * What a usable design lacks as a teaching page: a constant of nature set up as
 * a slider, no live readout, fewer than two observations (reported: a gravity
 * page with a "gravitational constant" slider in N, no readout, one remark).
 */
export function designShortcomings(spec: SimulationSpec, lang: FallbackLanguage): string[] {
  const issues: string[] = [];
  const constants = spec.parameters.filter((p) => CONSTANT.test(p.label) || CONSTANT.test(p.id));
  if (constants.length)
    issues.push(
      lang === 'en'
        ? `${constants.map((p) => p.label).join(', ')} is a constant, not something a learner changes: remove that slider and write its correct value as a number in the formulas.`
        : `${constants.map((p) => p.label).join('、')}是常量，不是学生能改变的量：删去这个滑块，把它的正确数值直接写进公式。`,
    );
  if (!spec.outputs.length)
    issues.push(
      lang === 'en'
        ? 'Add 1–3 "outputs": the key results computed from the sliders, shown live as the learner drags.'
        : '补充 1–3 个 "outputs"：由滑块实时计算的关键结果，学生拖动时直接读数。',
    );
  if (!spec.observations.length)
    issues.push(
      lang === 'en'
        ? 'Give 2–3 "observations", each naming which quantity changes and in which direction.'
        : '给出 2–3 条 "observations"，每条说明哪个量怎样变化。',
    );
  return issues;
}

/** Contradictions between a design and the subject, or null when the check could not run. */
async function checkDesign(
  spec: SimulationSpec,
  concept: string,
  lang: FallbackLanguage,
  aiCall: AiCall,
  budget: Budget,
  log: Logger,
  reserveMs: number,
) {
  const probes = designDirections(spec);
  // Never at the cost of the page itself: the check needs its own share of the step.
  if (!probes.length || !budget.allows(SPEC_CALL_MIN_MS / 3, reserveMs)) return null;
  try {
    const prompt = directionPrompt(concept, probes, lang);
    const reply = await budget.call(aiCall, prompt.system, prompt.user, reserveMs, 60_000);
    return contradictions(probes, reply);
  } catch (error) {
    log.warn('Simulation design check could not run:', error);
    return null;
  }
}

/** Plan a simulation's design (parameters, formulas, observations) with one short call. */
export async function planSimulationDesign(input: {
  outline: SceneOutline;
  aiCall: AiCall;
  log: Logger;
  languageDirective?: string;
  deadlineAt?: number;
  now?: () => number;
  /** Time kept back for writing the page afterwards (none for a last-resort page). */
  reserveMs?: number;
}): Promise<SimulationSpec | null> {
  const lang = fallbackLanguage(
    input.languageDirective,
    `${input.outline.title} ${input.outline.description ?? ''}`,
  );
  // Topics with a maintained, checked design use it (same platform page).
  const preset = presetSimulationDesign(
    `${input.outline.title} ${input.outline.widgetOutline?.concept ?? ''}`,
    lang,
  );
  if (preset) return preset;
  const budget = new Budget(input.deadlineAt, input.now ?? Date.now);
  const concept = topicCore(input.outline.widgetOutline?.concept || input.outline.title);
  const prompt = specPrompt('simulation', input.outline, lang);
  let feedback = '';
  let best: SimulationSpec | null = null;
  // A few short attempts; most of the step stays for the page itself.
  const reserve = input.reserveMs ?? 150_000;
  for (let attempt = 0; attempt < 3 && budget.allows(SPEC_CALL_MIN_MS, reserve); attempt += 1) {
    try {
      const raw = extractJsonObject(
        await budget.call(input.aiCall, prompt.system, prompt.user + feedback, 0, 75_000),
      );
      const spec = normalizeSimulationSpec(raw);
      const plotLost =
        !!spec && !spec.plot && !!raw && typeof (raw as { plot?: unknown }).plot === 'object';
      // Moving a slider must change what is drawn, not only slide a dot along
      // a fixed line (the reported 梯度下降 page: one slider, output = slider).
      const lively = !!spec && designShowsChange(spec);
      if (spec && specIsAboutTopic(spec, concept) && lively) {
        // A design that works but teaches little is kept as a fallback and
        // asked for once more (while time allows).
        const missing = designShortcomings(spec, lang);
        if (missing.length && attempt < 2 && budget.allows(SPEC_CALL_MIN_MS, reserve)) {
          if (spec.plot) best ??= spec;
          feedback =
            (lang === 'en' ? '\n\nImprove your previous design: ' : '\n\n改进上一次的设计：') +
            missing.join(' ');
          input.log.warn(
            `Simulation design for "${input.outline.title}" is thin: ${missing.join(' ')}`,
          );
          continue;
        }
        // The relationships it shows must be the subject's (an independent check
        // from subject knowledge; a check that cannot run does not block the page).
        const found = await checkDesign(
          spec,
          concept,
          lang,
          input.aiCall,
          budget,
          input.log,
          reserve,
        );
        if (found?.length) {
          const kept = withoutContradictions(spec, found);
          if (kept && designShowsChange(kept)) best ??= kept;
          feedback = contradictionFeedback(found, lang);
          input.log.warn(
            `Simulation design for "${input.outline.title}" contradicts the subject: ${found.map((f) => `${f.quantity}/${f.input}`).join(', ')}`,
          );
          continue;
        }
        // A last-resort page takes the first design that reacts to its sliders.
        if (spec.plot || input.reserveMs === 0) return spec;
        // Without a graph over x, an output that another slider reshapes is still a usable page.
        best ??= spec;
      }
      feedback = !spec
        ? ''
        : plotLost
          ? lang === 'en'
            ? '\n\nYour previous curves did not use x, so every curve was a flat line. Every curve formula MUST contain x (the horizontal axis variable), and xMin/xMax must cover the domain where it is defined.'
            : '\n\n上一次的曲线公式没有使用 x，所有曲线都成了水平直线。每条曲线的公式都必须包含横轴变量 x，并且 xMin、xMax 要落在函数有定义的范围内（例如反正弦 asin(x) 取 -1 到 1）。'
          : !spec.plot
            ? lang === 'en'
              ? '\n\nYour previous design had no "plot", so moving a slider changed nothing on the graph. Include "plot" with curves that contain x AND a parameter id; a number that merely repeats a slider value is not an output.'
              : '\n\n上一次的设计没有 "plot"，拖动滑块时图像不会变化。必须给出 "plot"，曲线公式要同时包含横轴变量 x 和参数 id；只是重复滑块数值的量不能作为输出。'
            : !lively
              ? lang === 'en'
                ? '\n\nIn your previous design no curve used a slider parameter, so moving the sliders did not change the graph. Every curve should contain x AND at least one parameter id (e.g. a*sin(b*x)), with xMin/xMax inside the domain where the curves are defined.'
                : '\n\n上一次的设计中没有任何曲线使用滑块参数，拖动滑块时图像不会变化。每条曲线都应同时包含横轴变量 x 和至少一个参数 id（例如 a*asin(x/b)），并且 xMin、xMax 要落在曲线有定义的范围内。'
              : '';
      input.log.warn(`Simulation design for "${input.outline.title}" was unusable or off-topic`);
    } catch (error) {
      // One failed call (a timeout, a malformed reply) is not the end: retry while time allows.
      input.log.warn(`Planning the simulation design for "${input.outline.title}" failed:`, error);
    }
  }
  return best;
}

/**
 * Cross-check a game's answers with one independent call: the solver sees the
 * rounds without the author's answers. Where they disagree, the solver's
 * choice is kept only when the round's own explanation names it (and not the
 * author's); otherwise the round is dropped. Returns null when no round is
 * left. Without time or a usable reply, the rounds whose explanation does not
 * contradict their answer are kept.
 */
export async function crossCheckGame(
  spec: GameSpec,
  input: {
    aiCall: AiCall;
    log: Logger;
    languageDirective?: string;
    budget?: Budget;
    deadlineAt?: number;
    now?: () => number;
  },
): Promise<GameSpec | null> {
  const budget = input.budget ?? new Budget(input.deadlineAt, input.now ?? Date.now);
  const named = (text: string, option: string) => option.length >= 1 && text.includes(option);
  // Without a solver: drop rounds whose explanation names another option but not the answer.
  const consistent = (r: GameSpec['rounds'][number]) => {
    const others = r.options.filter((o, i) => i !== r.answer && named(r.explain, o));
    return !(others.length && !named(r.explain, r.options[r.answer]!));
  };
  let answers: number[] = [];
  if (budget.allows(SPEC_CALL_MIN_MS / 2)) {
    const english = fallbackLanguage(input.languageDirective, spec.title) === 'en';
    const system = english
      ? 'You independently solve multiple-choice questions. Work each one out, then output ONLY JSON {"answers":[0-based index of the correct option for each question, in order]}.'
      : '你独立解答单选题。逐题想清楚后，只输出 JSON {"answers":[每题正确选项从 0 开始的序号，按顺序]}。';
    const questions = spec.rounds.map((r, i) => ({
      id: i + 1,
      question: r.prompt,
      options: r.options,
    }));
    try {
      const raw = extractJsonObject(
        await budget.call(input.aiCall, system, JSON.stringify({ questions })),
      ) as { answers?: unknown } | null;
      if (Array.isArray(raw?.answers) && raw.answers.length === spec.rounds.length)
        answers = raw.answers.map(Number);
    } catch (error) {
      input.log.warn(`Cross-checking the game "${spec.title}" failed:`, error);
    }
  }
  const rounds = spec.rounds.flatMap((r, i) => {
    const solver = answers[i];
    if (solver === undefined) return consistent(r) ? [r] : [];
    if (solver === r.answer) return [r];
    const option = r.options[solver];
    if (option !== undefined && named(r.explain, option) && !named(r.explain, r.options[r.answer]!))
      return [{ ...r, answer: solver }];
    return [];
  });
  if (rounds.length < spec.rounds.length)
    input.log.warn(
      `Game "${spec.title}": ${spec.rounds.length - rounds.length} round(s) dropped or corrected by the answer check`,
    );
  return rounds.length ? { ...spec, rounds } : null;
}

// Words that say nothing about which topic a design is about.
const GENERIC_TERMS =
  /^(?:模拟|拟器|影响|因素|原理|过程|变化|关系|实验|演示|探究|规律|基本|基础|概念|应用|及其|与其|算法|方法|讲解|介绍|simulat\w*|effect\w*|factor\w*|basic\w*|concept\w*|process\w*|change\w*|relation\w*)$/i;

/**
 * The design itself must be about the topic: its title, intro or labels name
 * it, or share a distinctive word with it (光合作用的影响因素 → 光合速率). A
 * copied example from another topic shares none.
 */
export function specIsAboutTopic(spec: SimulationSpec, concept: string): boolean {
  const core = concept.trim();
  // Long requests cannot be matched literally; rely on the page check instead.
  if (!core || core.length > 16) return true;
  const text = [
    spec.title,
    spec.intro,
    ...spec.observations,
    ...spec.parameters.map((p) => p.label),
    ...spec.outputs.map((o) => o.label),
    ...(spec.plot?.curves.map((c) => c.label) ?? []),
  ].join(' ');
  if (text.includes(core)) return true;
  const lower = text.toLowerCase();
  const words = new Set<string>();
  for (const run of core.match(/[\u4e00-\u9fff]+/g) ?? [])
    for (let i = 0; i + 2 <= run.length; i += 1) words.add(run.slice(i, i + 2));
  for (const word of core.toLowerCase().match(/[a-z]{4,}/g) ?? []) words.add(word);
  return [...words].some(
    (w) =>
      !GENERIC_TERMS.test(w) && !/^[的和与及在中对]|[的和与及在中对]$/.test(w) && lower.includes(w),
  );
}

async function passes(html: string, smokeTest: (html: string) => Promise<WidgetSmokeResult>) {
  const result = await smokeTest(html);
  return {
    ok: result.errors.length === 0 && !result.inconclusive,
    errors: result.inconclusive
      ? [...result.errors, 'Runtime verification did not complete; the page is not verified.']
      : result.errors,
  };
}

async function fallbackWidget(
  input: WidgetReliabilityInput,
  widgetType: WidgetType,
  lang: FallbackLanguage,
  budget: Budget,
): Promise<GeneratedInteractiveContent> {
  const { outline, aiCall, log } = input;
  const title = outline.title;
  // Any page that is not a game (simulation, diagram, 3D) is replaced by a
  // planned, checked simulator on the topic: never by a checklist while a
  // design can still be had (reported: "我理解了" progress pages).
  const kind = widgetType === 'game' ? 'game' : 'simulation';
  if (kind === 'simulation') {
    const design =
      input.design ??
      (await planSimulationDesign({
        outline,
        aiCall,
        log,
        languageDirective: input.languageDirective,
        deadlineAt: input.deadlineAt,
        now: input.now,
        reserveMs: 0,
      }));
    if (design) {
      const display = await localizeWidgetSpec(design, input.languageDirective, (system, user) =>
        budget.call(aiCall, system, user),
      );
      return {
        html: renderSimulationWidget(
          display,
          lang,
          title,
          input.languageDirective ? contentLanguage(input.languageDirective) : lang,
        ),
        widgetType,
      };
    }
  }
  if (kind === 'game') {
    for (let attempt = 0; attempt < 2 && budget.allows(SPEC_CALL_MIN_MS); attempt += 1) {
      let raw: unknown = null;
      try {
        const prompt = specPrompt(kind, outline, lang);
        raw = extractJsonObject(await budget.call(aiCall, prompt.system, prompt.user));
      } catch (error) {
        log.warn(`Fallback ${kind} spec request failed for "${title}":`, error);
        break;
      }
      {
        const spec = normalizeGameSpec(raw);
        if (spec) {
          // A small model may mark the wrong option correct; check before students see it.
          const checked = await crossCheckGame(spec, {
            aiCall,
            log,
            languageDirective: input.languageDirective,
            budget,
          });
          if (checked) {
            const display = await localizeWidgetSpec(
              checked,
              input.languageDirective,
              (system, user) => budget.call(aiCall, system, user),
            );
            return {
              html: renderGameWidget(
                display,
                lang,
                title,
                input.languageDirective ? contentLanguage(input.languageDirective) : lang,
              ),
              widgetType,
            };
          }
          // Every round failed the answer check: write the rounds once more.
        }
      }
    }
  }
  // Keep this scene retryable rather than publishing a fake simulator/game.
  throw new Error(`No verified ${kind} design for "${title}"; retry this scene.`);
}

/** Platform-owned game code; the model supplies reviewed subject data only. */
export async function generateNativeGame(
  input: WidgetReliabilityInput,
): Promise<GeneratedInteractiveContent> {
  const lang = fallbackLanguage(input.languageDirective, input.outline.title);
  return fallbackWidget(input, 'game', lang, new Budget(input.deadlineAt, input.now ?? Date.now));
}

export async function ensureRunnableWidget(
  input: WidgetReliabilityInput,
): Promise<GeneratedInteractiveContent> {
  const { outline, aiCall, log } = input;
  const widgetType = (input.content?.widgetType ??
    outline.widgetType ??
    'simulation') as WidgetType;
  const runCheck = input.smokeTest ?? smokeTestWidget;
  const lang = fallbackLanguage(
    input.languageDirective,
    `${outline.title} ${outline.description ?? ''}`,
  );
  const design = widgetType === 'simulation' ? (input.design ?? null) : null;
  const concept = topicCore(outline.widgetOutline?.concept || outline.title);
  const brief = design ? designBrief(design, concept, lang) : '';
  // Runtime errors first; a page that runs must also be about the topic.
  const smokeTest = async (html: string): Promise<WidgetSmokeResult> => {
    const result = await runCheck(html, widgetType);
    if (result.errors.length || !design || mentionsTopic(html, design, concept)) return result;
    const labels = design.parameters.map((p) => p.label).join('、');
    return {
      inconclusive: false,
      errors: [
        lang === 'en'
          ? `Off-topic: the page never mentions "${concept}" or the planned parameters (${labels}); it looks like a copied template example.`
          : `页面与主题无关：页面上没有出现“${concept}”或设计中的参数（${labels}），像是照搬的模板示例。`,
      ],
    };
  };
  const budget = new Budget(input.deadlineAt, input.now ?? Date.now);
  // Without a measurement, assume a page rewrite takes two minutes on a local model.
  const rewriteMs = Math.max(input.generationMs ?? 120_000, MIN_CALL_MS);

  let content = input.content;
  if (!content?.html && input.regenerate && budget.allows(rewriteMs, SPEC_CALL_MIN_MS)) {
    try {
      const regenerate = input.regenerate;
      content = await budget.run((signal) => regenerate(signal), SPEC_CALL_MIN_MS);
    } catch (error) {
      log.warn(`Regenerating widget "${outline.title}" failed:`, error);
      content = null;
    }
  }

  if (content?.html) {
    let current = content.html;
    let check = await passes(current, smokeTest);
    if (check.ok) return content;
    for (let attempt = 1; attempt <= MAX_REPAIRS; attempt += 1) {
      log.warn(
        `Widget "${outline.title}" failed the runtime check (attempt ${attempt}): ${check.errors.join(' | ')}`,
      );
      // Keep time for the native page's spec after a failed repair.
      if (!budget.allows(rewriteMs * 1.2, SPEC_CALL_MIN_MS)) {
        log.warn(`No time left to repair widget "${outline.title}"; using the native page`);
        break;
      }
      let repaired: string | null = null;
      try {
        const prompt = repairPrompt(current, check.errors, lang, brief);
        repaired = extractHtmlDocument(
          await budget.call(aiCall, prompt.system, prompt.user, SPEC_CALL_MIN_MS),
        );
      } catch (error) {
        log.warn(`Widget repair request failed for "${outline.title}":`, error);
        break;
      }
      if (!repaired) continue;
      const html = postProcessInteractiveHtml(repaired);
      const next = await passes(html, smokeTest);
      if (next.ok) {
        log.info(`Widget "${outline.title}" repaired after ${attempt} attempt(s)`);
        return {
          ...content,
          html,
          widgetConfig:
            (extractWidgetConfig(repaired, widgetType) as WidgetConfig | undefined) ??
            content.widgetConfig,
        };
      }
      current = html;
      check = next;
    }
  }

  log.warn(`Widget "${outline.title}" replaced by the platform's native ${widgetType} page`);
  const fallback = await fallbackWidget(input, widgetType, lang, budget);
  const verified = await passes(fallback.html, smokeTest);
  if (!verified.ok)
    throw new Error(`Native widget verification failed: ${verified.errors.join(' | ')}`);
  return {
    ...(content ?? {}),
    ...fallback,
    widgetConfig: extractWidgetConfig(fallback.html, widgetType) as WidgetConfig | undefined,
  };
}
