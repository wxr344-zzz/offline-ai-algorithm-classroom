import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import type { PPTElement } from '@openmaic/dsl';
import type { Action } from '@/lib/types/action';

export function slideEvidence(elements: PPTElement[]) {
  const visible: string[] = [];
  for (const element of elements) {
    const html =
      element.type === 'text'
        ? element.content
        : element.type === 'shape'
          ? element.text?.content
          : '';
    if (!html) continue;
    const read = (node: DefaultTreeAdapterTypes.Node) => {
      if ('value' in node && node.value.trim()) visible.push(node.value.trim());
      if ('childNodes' in node) node.childNodes.forEach(read);
    };
    read(parseFragment(html));
  }
  const figures = elements.filter(
    (e) =>
      ['image', 'chart', 'video', 'latex'].includes(e.type) ||
      e.type === 'line' ||
      (e.type === 'shape' && !!e.text?.content),
  );
  return {
    text: visible.join('\n'),
    figures: figures.map((e) => ({
      id: e.id,
      type: e.type,
      ...(e.type === 'latex' ? { formula: e.latex } : {}),
    })),
  };
}

/** A text-only slide cannot support a claim that a roadmap/chart is visible.
 * This structural guard is independent of course subject and never rewrites facts. */
export function removeUnsupportedVisualClaims(actions: Action[], elements: PPTElement[]): Action[] {
  const evidence = slideEvidence(elements);
  const visual =
    /(?:路线图|路線圖|流程图|流程圖|柱状图|折线图|散点图|roadmap|flowchart|bar chart|line chart|scatter plot)/i;
  return actions.flatMap<Action>((action) => {
    if (action.type !== 'speech') return [action];
    const pieces = action.text.match(/[^。！？.!?]+(?:[。！？.!?]+|$)/g) ?? [action.text];
    const text = pieces
      .filter((sentence) => {
        // Drop only an ungrounded transition announcing an example "now".
        // Do not discard an actual calculation or a reference to a shown one.
        if (
          !/(?:例题|例題|例子|实例|實例|example)/i.test(evidence.text) &&
          /(?:例题|例題|例子|实例|實例|example)/i.test(sentence) &&
          /(?:现在|現在|来看|來看|本页|本頁|now|shown here|on this page|look at)/i.test(sentence) &&
          !/[=→]/.test(sentence)
        )
          return false;
        if (evidence.figures.length) return true;
        const claim = sentence.match(visual)?.[0];
        return (
          !claim ||
          evidence.text.toLowerCase().includes(claim.toLowerCase()) ||
          !/(?:看|展示|显示|顯示|屏幕|螢幕|本页|本頁|图中|圖中|see|shown|shows|look|screen|slide)/i.test(
            sentence,
          )
        );
      })
      .join('')
      .trim();
    return text ? [{ ...action, text }] : [];
  });
}
