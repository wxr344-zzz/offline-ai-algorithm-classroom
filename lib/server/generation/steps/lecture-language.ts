import { parseFragment, serialize, type DefaultTreeAdapterTypes } from 'parse5';
import type { PPTElement } from '@openmaic/dsl';
import {
  courseTarget,
  localizeSpeeches,
  needsChineseSlideText,
  needsEnglishText,
} from './speech-language';

/** Translate prose in native text slots, never markup, code or mathematical nodes.
 * Geometry is repaired afterwards because translated text wraps differently. */
export async function localizeLectureElements(
  elements: PPTElement[],
  directive: string | undefined,
  translate: (system: string, prompt: string) => Promise<string>,
): Promise<PPTElement[]> {
  const target = courseTarget(directive);
  if (!target) return elements;
  const chinese = target === 'zh-CN' || target === 'zh-TW';
  const needsCorrection =
    target === 'en' ? needsEnglishText : chinese ? needsChineseSlideText : () => true;
  const fragments = new Map<number, DefaultTreeAdapterTypes.DocumentFragment>();
  const nodes: Array<DefaultTreeAdapterTypes.TextNode> = [];
  elements.forEach((element, index) => {
    const content =
      element.type === 'text'
        ? element.content
        : element.type === 'shape'
          ? element.text?.content
          : undefined;
    if (!content) return;
    const fragment = parseFragment(content);
    function visit(node: DefaultTreeAdapterTypes.Node) {
      if ('tagName' in node) {
        if (/^(pre|code|script|style|math|svg)$/.test(node.tagName)) return;
        if (
          node.attrs.some(
            (a) =>
              /^data-(math|latex|formula)/.test(a.name) ||
              (a.name === 'class' && /(?:katex|mathjax)/i.test(a.value)),
          )
        )
          return;
      }
      if (node.nodeName === '#text') nodes.push(node as DefaultTreeAdapterTypes.TextNode);
      if ('childNodes' in node) node.childNodes.forEach(visit);
    }
    visit(fragment);
    fragments.set(index, fragment);
  });
  const extra: Partial<Record<typeof target, string>> = {
    'zh-CN': '中文句子里夹杂的英文词语也要译成中文；sin、arcsin 等函数名、变量和代码保持原样。',
    'zh-TW': '中文句子裡夾雜的英文詞語也要譯成中文；sin、arcsin 等函數名、變數和程式碼保持原樣。',
    en: ' Chinese words inside English sentences must be translated too; keep function names such as sin and arcsin, variables and code unchanged.',
  };
  const instructed = (system: string, prompt: string) =>
    translate(
      system
        .replace('课堂对白', '幻灯片正文')
        .replace('課堂對白', '投影片正文')
        .replace('classroom dialogue', 'slide text') +
        (extra[target] ?? ` All slide prose must use locale ${target}.`),
      prompt,
    );
  // A translation must not change worked-example values or equation indices.
  const numbers = (text: string) =>
    JSON.stringify((text.match(/[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? []).sort());
  const translateAll = async (items: DefaultTreeAdapterTypes.TextNode[]) => {
    const source = items.map((node) => ({ type: 'speech', text: node.value }));
    const localized = await localizeSpeeches(source, directive, instructed, needsCorrection);
    if (localized === source) return null;
    localized.forEach((item, i) => {
      if (numbers(item.text) !== numbers(items[i]!.value))
        throw new Error('课件翻译改变了公式或示例数值，请重试该场景');
    });
    return localized.map((item) => item.text);
  };
  let changed = false;
  try {
    const texts = await translateAll(nodes);
    if (!texts) return elements;
    texts.forEach((text, i) => {
      nodes[i]!.value = text;
    });
    changed = true;
  } catch (error) {
    // One malformed answer for the whole slide: translate the mixed passages
    // one at a time, so a single failure leaves only that passage as written.
    const pending = nodes.filter((node) => needsCorrection(node.value));
    if (!pending.length) throw error;
    for (const node of pending) {
      try {
        const [text] = (await translateAll([node])) ?? [];
        if (text !== undefined) {
          node.value = text;
          changed = true;
        }
      } catch {
        // Keep this passage; the others are still corrected.
      }
    }
    if (!changed) throw error;
  }
  if (!changed) return elements;
  return elements.map((element, index) =>
    element.type === 'text' && fragments.has(index)
      ? { ...element, content: serialize(fragments.get(index)!) }
      : element.type === 'shape' && element.text && fragments.has(index)
        ? { ...element, text: { ...element.text, content: serialize(fragments.get(index)!) } }
        : element,
  );
}
