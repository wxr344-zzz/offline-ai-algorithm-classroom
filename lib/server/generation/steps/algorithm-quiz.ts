import snapshots from './algorithm-quiz-snapshots.generated.json';
import { resolveExamAlgorithm } from '@/lib/eduplus/exam-topic';
import type { GeneratedQuizContent, SceneOutline } from '@/lib/types/generation';

type View = Record<string, unknown> & { name?: string };
type Sample = {
  id: string;
  title: string;
  aliases: string[];
  input: unknown;
  outcome: unknown;
  frames: Array<{ index: number; label?: string; state: unknown; views: View[] }>;
};
/** One verifiable fact, described in the words the simulator shows the learner. */
type Fact = { value: unknown; zh: string; en: string; distractors?: unknown[]; node?: boolean };
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

type Leaf = { path: Array<string | number>; value: unknown };
function leaf(
  value: unknown,
  path: Array<string | number> = [],
  allowEmpty = true,
): Leaf | undefined {
  if (!allowEmpty && value === null) return;
  if (value === null || typeof value !== 'object') return { path, value };
  const entries = Object.entries(value);
  if (!entries.length) return allowEmpty ? { path, value } : undefined;
  for (const [key, child] of entries) {
    const found = leaf(child, [...path, Array.isArray(value) ? Number(key) : key], allowEmpty);
    if (found) return found;
  }
}

/** "第 2 项" / "距离 的第 2 项": readable, never a raw JSON path such as `.values[2]`. */
/** Chinese names of result fields: a Chinese question never shows a raw field key. */
const FIELD_ZH: Record<string, string> = {
  answers: '答案',
  buckets: '桶',
  codes: '编码',
  components: '连通分量',
  cost: '代价',
  critical: '关键活动',
  data: '数据',
  distance: '距离',
  distances: '距离表',
  dp: 'dp 表',
  duration: '工期',
  edges: '边集',
  firstChild: '第一个孩子',
  front: '队头',
  heap: '堆',
  index: '下标',
  inorder: '中序序列',
  inorderSequence: '中序序列',
  keys: '键序列',
  length: '长度',
  levelorderSequence: '层序序列',
  lps: 'lps 数组',
  matrix: '矩阵',
  next: 'next 数组',
  nextSibling: '右兄弟',
  nextval: 'nextval 数组',
  order: '输出序列',
  output: '输出',
  parent: '父结点',
  parenthesization: '加括号方案',
  path: '路径',
  period: '周期',
  popped: '出栈序列',
  postfix: '后缀表达式',
  postorderSequence: '后序序列',
  preorderSequence: '先序序列',
  pruned: '剪枝结果',
  rear: '队尾',
  root: '根',
  runs: '归并段',
  searchResults: '查找结果',
  slots: '槽位',
  sorted: '排序结果',
  split: '分裂结果',
  subsequence: '子序列',
  threads: '线索',
  total: '总量',
  tree: '树',
  triples: '三元组',
  valid: '是否合法',
  value: '值',
  ve: '最早发生时间 ve',
  visited: '访问序列',
  vl: '最迟发生时间 vl',
  weights: '权值',
  wpl: '带权路径长度 WPL',
};
const fieldZh = (key: string) => FIELD_ZH[key] ?? key;

function describePath(path: Array<string | number>, english: boolean): string {
  if (!path.length) return '';
  return path
    .map((part) =>
      typeof part === 'number'
        ? english
          ? `item #${part}`
          : `第 ${part} 项`
        : english
          ? `"${part}"`
          : `「${fieldZh(part)}」`,
    )
    .join(english ? ' → ' : '中的');
}

const isFlat = (value: unknown): value is Array<string | number | boolean> =>
  Array.isArray(value) &&
  value.length >= 2 &&
  value.length <= 10 &&
  value.every((item) => ['string', 'number', 'boolean'].includes(typeof item));

function flatChoice(value: Array<string | number | boolean>, input?: unknown): unknown[] {
  // Plausible wrong answers: a reversed order, an unchanged input, a neighbouring swap.
  const reversed = [...value].reverse();
  const swapped = [...value];
  const at = swapped.findIndex((item, i) => i + 1 < swapped.length && item !== swapped[i + 1]);
  if (at >= 0) [swapped[at], swapped[at + 1]] = [swapped[at + 1], swapped[at]];
  const original = Object.values((input ?? {}) as Record<string, unknown>).find(
    (item) => isFlat(item) && item.length === value.length,
  );
  return [original, swapped, reversed];
}

function outcomeFact(sample: Sample, english: boolean): Fact | undefined {
  const outcome = sample.outcome;
  if (isFlat(outcome))
    return {
      value: outcome,
      zh: '算法执行结束后的输出结果',
      en: 'the final output of the algorithm',
      distractors: flatChoice(outcome, sample.input),
    };
  if (outcome && typeof outcome === 'object' && !Array.isArray(outcome)) {
    // A scalar result (optimum, match index, total weight, root) is the headline answer.
    const scalar = Object.entries(outcome).find(([, value]) => typeof value === 'number') as
      | [string, number]
      | undefined;
    if (scalar)
      return {
        value: scalar[1],
        zh: `最终输出结果中「${fieldZh(scalar[0])}」的值`,
        en: `the "${scalar[0]}" value of the final output`,
      };
    // Otherwise prefer a whole result sequence (distances, path, order) over its first cell.
    const entry = Object.entries(outcome).find(([, value]) => isFlat(value)) as
      | [string, Array<string | number | boolean>]
      | undefined;
    if (entry)
      return {
        value: entry[1],
        zh: `最终输出结果中「${fieldZh(entry[0])}」的内容`,
        en: `the "${entry[0]}" part of the final output`,
        distractors: flatChoice(entry[1], sample.input),
      };
  }
  const found = leaf(outcome);
  if (!found) return;
  const where = describePath(found.path, english);
  return {
    value: found.value,
    zh: where ? `最终输出结果中${where}的值` : '算法执行结束后的输出结果',
    en: where ? `${where} of the final output` : 'the final output of the algorithm',
  };
}

function frameFacts(frame: Sample['frames'][number], english: boolean): Fact[] {
  const step = frame.index + 1;
  // Maintained step labels and view names are Chinese; an English question omits them.
  const cjk = /[\u4e00-\u9fff]/;
  const label =
    frame.label?.trim() && !(english && cjk.test(frame.label)) ? frame.label.trim() : '';
  const at = english
    ? `after step ${step}${label ? ` ("${label}")` : ''} in the simulator`
    : `执行到模拟器第 ${step} 步${label ? `「${label}」` : ''}时`;
  const facts: Fact[] = [];
  const named = (view: View) =>
    typeof view.name === 'string' && view.name.trim() && !(english && cjk.test(view.name))
      ? view.name.trim()
      : '';
  for (const view of frame.views) {
    const name = named(view);
    if (view.pointers && typeof view.pointers === 'object') {
      const pointers = Object.entries(view.pointers as Record<string, unknown>).filter(
        ([, value]) => typeof value === 'number',
      );
      const pointer = pointers.find(([key]) => key === 'mid') ?? pointers[0];
      if (pointer)
        facts.push({
          value: pointer[1],
          zh: `${at}，${name ? `「${name}」上的` : ''}指针 ${pointer[0]} 指向的下标`,
          en: `the index that pointer ${pointer[0]}${name ? ` on "${name}"` : ''} refers to ${at}`,
        });
    }
    // The highlighted cell is what the step just computed; cell [0][0] is a fixed boundary.
    const active = Array.isArray(view.active) ? (view.active as unknown[]) : [];
    if (view.kind === 'matrix' && Array.isArray(view.values)) {
      const cell = active.find((item) => Array.isArray(item) && item.length === 2) as
        | [number, number]
        | undefined;
      const value = cell && (view.values as unknown[][])[cell[0]]?.[cell[1]];
      if (cell && (typeof value === 'number' || typeof value === 'string'))
        facts.push({
          value,
          zh: `${at}，${name ? `「${name}」` : '表格'}第 ${cell[0]} 行第 ${cell[1]} 列刚算出的值`,
          en: `the value just computed in row ${cell[0]}, column ${cell[1]} of ${name ? `"${name}"` : 'the table'} ${at}`,
        });
    }
    if (view.kind === 'sequence' && Array.isArray(view.values)) {
      const index = active.find((item) => typeof item === 'number') as number | undefined;
      const value = index === undefined ? undefined : (view.values as unknown[])[index];
      if (typeof value === 'number' || typeof value === 'string')
        facts.push({
          value,
          zh: `${at}，${name ? `「${name}」` : '序列'}中下标 ${index} 处的值`,
          en: `the value at index ${index} of ${name ? `"${name}"` : 'the sequence'} ${at}`,
        });
    }
    if ((view.kind === 'tree' || view.kind === 'graph') && Array.isArray(view.nodes)) {
      const nodes = view.nodes as Array<{ label?: unknown; mark?: unknown }>;
      const text = (node: { label?: unknown }) =>
        String(node.label ?? '')
          .split('\n')[0]
          .trim();
      const current = nodes.filter((node) => node.mark === 'active');
      const others = [...new Set(nodes.filter((node) => node.mark !== 'active').map(text))].filter(
        (label) => label && label !== (current[0] ? text(current[0]) : ''),
      );
      // Only ask when the highlighted label is unique; "MAX"/"MIN" game-tree labels repeat.
      const unique =
        current.length === 1 &&
        nodes.filter((node) => text(node) === text(current[0])).length === 1;
      if (unique && text(current[0]) && others.length)
        facts.push({
          value: text(current[0]),
          zh: `${at}，${name ? `「${name}」中` : ''}正在处理（高亮）的结点`,
          en: `the node being processed (highlighted)${name ? ` in "${name}"` : ''} ${at}`,
          distractors: others.slice(0, 3),
          node: true,
        });
    }
    if (view.kind === 'containers' && Array.isArray(view.groups))
      for (const group of view.groups as Array<{ name?: string; values?: unknown }>)
        if (isFlat(group.values))
          facts.push({
            value: group.values,
            zh: `${at}，「${group.name ?? name}」中的元素（按显示顺序）`,
            en: `the elements of "${group.name ?? name}" (in display order) ${at}`,
            distractors: flatChoice(group.values),
          });
  }
  const state = frame.state && typeof frame.state === 'object' ? frame.state : {};
  for (const [key, value] of Object.entries(state as Record<string, unknown>)) {
    if (typeof value === 'number' || typeof value === 'boolean')
      facts.push({
        value,
        zh: `${at}，变量「${key}」的值`,
        en: `the value of variable "${key}" ${at}`,
      });
    else if (isFlat(value))
      facts.push({
        value,
        zh: `${at}，「${key}」的内容`,
        en: `the contents of "${key}" ${at}`,
        distractors: flatChoice(value),
      });
  }
  if (!facts.length)
    for (const view of frame.views) {
      for (const key of ['values', 'rows', 'groups', 'nodes']) {
        if (view[key] === undefined) continue;
        const found = leaf(view[key], [], false);
        if (!found || !found.path.length) continue;
        const where = describePath(found.path, english);
        const name = named(view);
        facts.push({
          value: found.value,
          zh: `${at}，${name ? `「${name}」` : '当前结构'}${where}的值`,
          en: `${where} of ${name ? `"${name}"` : 'the current structure'} ${at}`,
        });
        break;
      }
      if (facts.length) break;
    }
  return facts;
}

function options(fact: Fact): unknown[] {
  const value = fact.value;
  const raw =
    typeof value === 'number'
      ? [value, value + 1, value - 1, value + 2]
      : typeof value === 'boolean'
        ? [value, !value]
        : [value, ...(fact.distractors ?? [])];
  if (typeof value === 'string' && raw.length < 3) {
    // A string without structured alternatives: use other genuine values, never "x?"/"x!".
    raw.push(value.split('').reverse().join(''));
  }
  return raw.filter(
    (item, i, all) =>
      item !== undefined &&
      all.findIndex((other) => JSON.stringify(other) === JSON.stringify(item)) === i,
  );
}

/** Exact identity only: unfamiliar variants must never inherit a base
 * algorithm's answers. These samples are exported from maintained Python. */
export function deterministicAlgorithmQuiz(
  content: GeneratedQuizContent,
  outline: SceneOutline,
  requirement: string,
  language?: string,
): GeneratedQuizContent | undefined {
  const english = /English|locale en(?:-|\b)/i.test(language ?? '');
  if (/繁體|繁体/.test(language ?? '')) return;
  if (language && !english && !/简体中文|中文/.test(language)) return;
  const title = outline.title
    .replace(/(?:quiz|随堂检测|实验随堂检测|知识测验|概念检测|测验)\s*$/i, '')
    .replace(/[:：\-\s]+$/g, '');
  const requested = requirement
    .split(/[。.!?\n]/)[0]
    .replace(
      /^(?:please\s+)?(?:explain|teach|introduce)\s+|^(?:请为我讲解|请给我讲解|请讲解|讲解|介绍)/i,
      '',
    )
    .replace(/[,，]\s*(?:theory only|只讲理论|不要编程|不写代码|不需要实验).*$/i, '')
    .trim();
  const candidates = [normalized(title), normalized(requested)];
  // Natural phrasings ("讲解快速排序算法的原理和实现") resolve exactly as the
  // Python registry does; a comparison or unknown variant resolves to nothing.
  const resolved = resolveExamAlgorithm(requirement);
  const sample = (snapshots as unknown as Sample[]).find(
    (entry) =>
      entry.id === resolved ||
      [entry.id, entry.title, ...entry.aliases].some((name) =>
        candidates.includes(normalized(name)),
      ),
  );
  if (!sample) return;
  const facts: Fact[] = [];
  const result = outcomeFact(sample, english);
  if (result) facts.push(result);
  // One question per executed step first, then any further facts; no repeats.
  const perFrame = sample.frames.map((frame) =>
    frameFacts(frame, english).filter((fact) => options(fact).length >= 2),
  );
  if (english) {
    // Never mix Chinese pointer/variable names into an English question.
    for (const [i, list] of perFrame.entries())
      perFrame[i] = list.filter((fact) => !/[\u4e00-\u9fff]/.test(fact.en));
  }
  for (const list of perFrame) if (list[0]) facts.push(list[0]);
  for (const list of perFrame) facts.push(...list.slice(1));
  const seen = new Set<string>();
  const nodes = new Set<string>();
  const usable = facts.filter((fact) => {
    const key = `${english ? fact.en : fact.zh}=${JSON.stringify(fact.value)}`;
    const node = fact.node ? JSON.stringify(fact.value) : '';
    if (options(fact).length < 2 || seen.has(key) || (node && nodes.has(node))) return false;
    seen.add(key);
    if (node) nodes.add(node);
    return true;
  });
  if (usable.length < content.questions.length) return;
  const name = title || sample.title;
  const input = JSON.stringify(sample.input);
  return {
    questions: content.questions.map((original, index) => {
      const fact = usable[index];
      const serialized = JSON.stringify(fact.value);
      const shown = typeof fact.value === 'string' ? fact.value : serialized;
      let alternatives = options(fact);
      const shift = index % alternatives.length;
      alternatives = [...alternatives.slice(shift), ...alternatives.slice(0, shift)];
      const correct = alternatives.findIndex((value) => JSON.stringify(value) === serialized);
      const target = english ? fact.en : fact.zh;
      return {
        id: original.id,
        type: 'single' as const,
        points: original.points,
        hasAnswer: true,
        question: english
          ? `Run ${name} on the input ${input} (indices start at 0), as in this lesson's simulator. What is ${target}?`
          : `用本课${name}的算法处理输入 ${input}（下标从 0 开始），与课堂模拟器的推演一致。${target}是什么？`,
        options: alternatives.map((value, i) => ({
          value: String.fromCharCode(65 + i),
          label: typeof value === 'string' ? value : JSON.stringify(value),
        })),
        answer: [String.fromCharCode(65 + correct)],
        analysis: english
          ? `Executing the maintained Python implementation on this input gives ${target} = ${shown}. Trace the algorithm's state updates and boundary rules step by step to reproduce it.`
          : `对该输入执行本课受维护的 Python 实现，${target}为 ${shown}。可按算法的状态更新与边界规则逐步手算，并在模拟器中核对对应步骤。`,
      };
    }),
  };
}
