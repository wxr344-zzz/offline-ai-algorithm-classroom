import { parseFragment, serialize, type DefaultTreeAdapterTypes } from 'parse5';
import type { PPTElement, PPTTextElement } from '@openmaic/dsl';

export const LECTURE_CONTENT_RULES = `幻灯片正文是给学生阅读的教学内容，不是生成任务说明。
围绕当前页面的标题和知识点讲解，保持课程主题一致，各页分别推进定义、原理、步骤、例题或总结。
不得把“教学主题、知识点、讲解依据、原始需求、本页目标、课程概念参考”等提示词标签与输入描述直接复制到正文。
算法目录中的408、自命题、院校与分类是路由信息，不是算法知识点。不得反复展示这些分类。
公式必须先定义变量与状态；具体数值必须附带完整题设，不能拼接不同执行步骤的数字充当通用公式。
每页内容完整、条理清楚，要点不超过 6 条，正文字号不小于 16px；讲解台词里要讲的内容（例子、步骤、发展历程等）必须在本页正文中有对应，不能只在台词里提到。
不要放置没有文字或图示意义的纯色块；形状只用来承载文字、标注或示意结构。
输出前检查重复字、错别字、未完成句子、与本课无关的内容。`;

export function cleanLectureText(value: string): string {
  return value
    .replace(/教教学/g, '教学')
    .replace(/(?:自命题|408)\s*[／/]\s*/g, '')
    .replace(/\n?原始(?:教学)?需求[^：:\n]*[：:][\s\S]*/g, '')
    .trim();
}

export function lectureKeyPoints(points: string[]): string[] {
  return [...new Set(points.map(cleanLectureText).filter(Boolean))];
}

const metaProse =
  /(?:教教学|教学主题|讲解主题|讲解依据|原始(?:教学)?需求|课程概念参考|本页目标)\s*[：:]/;

export function hasLectureMetadata(value: string): boolean {
  return metaProse.test(value) || /(?:自命题|408)\s*[／/]/.test(value) || value.includes('教教学');
}

/** Keep native element identities and typography; only correct leaked prose. */
export function cleanLectureElements(elements: PPTElement[], facts: string[]): PPTElement[] {
  let changed = false;
  let fact = 0;
  const result = elements.map((element) => {
    if (element.type !== 'text') return element;
    const root = parseFragment(element.content);
    let plain = '';
    function collect(node: DefaultTreeAdapterTypes.Node) {
      if ('value' in node) plain += node.value;
      if ('childNodes' in node) node.childNodes.forEach(collect);
    }
    collect(root);
    if (!hasLectureMetadata(plain)) return element;
    const replacement =
      metaProse.test(plain) && facts.length ? facts[fact++ % facts.length] : undefined;
    let inserted = false;
    function correct(node: DefaultTreeAdapterTypes.Node) {
      if ('value' in node) {
        if (replacement !== undefined) {
          if (node.value.trim()) {
            node.value = inserted ? '' : replacement;
            inserted = true;
          }
        } else node.value = cleanLectureText(node.value);
      }
      if ('childNodes' in node) node.childNodes.forEach(correct);
    }
    correct(root);
    changed = true;
    return { ...element, content: serialize(root) };
  });
  return changed ? result : elements;
}

/** Repair historical prompt-contaminated pages using their native text slots. */
export function repairLectureSlide(
  elements: PPTElement[],
  title: string,
  facts: string[],
  example?: { input: unknown; expected: unknown },
): PPTElement[] {
  if (!elements.some((e) => e.type === 'text' && hasLectureMetadata(e.content))) return elements;
  const ordered = elements
    .filter((e): e is PPTTextElement => e.type === 'text')
    .sort((a, b) => a.top - b.top || a.left - b.left);
  if (ordered.length < 2 || !facts.length) return cleanLectureElements(elements, facts);
  const body = ordered.slice(1);
  const paragraphs =
    /例题|示例|练习|习题/.test(title) && example
      ? [
          `结合本课算法计算以下输入：${JSON.stringify(example.input)}`,
          `推演要点：${facts.join('。')}。`,
          `独立计算后核对结果：${JSON.stringify(example.expected)}`,
        ]
      : facts.map((f) => f.replace(/[。；]$/, '') + '。');
  const replacements = new Map<string, PPTTextElement>();
  const escape = (text: string) =>
    text.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    );
  body.forEach((element, i) => {
    const size = /font-size\s*:\s*([\d.]+)(px|pt)/i.exec(element.content);
    const font = size ? `${size[1]}${size[2]}` : '18px';
    const chunk = i < body.length - 1 ? paragraphs.slice(i, i + 1) : paragraphs.slice(i);
    replacements.set(element.id, {
      ...element,
      content: serialize(
        parseFragment(
          chunk.map((p) => `<p><span style="font-size:${font}">${escape(p)}</span></p>`).join('') ||
            '<p></p>',
        ),
      ),
    });
  });
  return cleanLectureElements(
    elements.map((e) => replacements.get(e.id) ?? e),
    facts,
  );
}
