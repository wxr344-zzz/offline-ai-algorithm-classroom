import { parseFragment, serialize, type DefaultTreeAdapterTypes as T } from 'parse5';
import type { PPTElement } from '@openmaic/dsl';

/** Remove consecutive long prose echoes in one box, preserving the first style.
 * Separate boxes, short labels, lists, code, tables and formulae remain intact. */
export function removeRepeatedParagraphs(elements: PPTElement[]): PPTElement[] {
  let changed = false;
  const result = elements.map((element) => {
    if (element.type !== 'text' || /<(?:table|pre|code|svg)|katex|data-math/i.test(element.content))
      return element;
    const root = parseFragment(element.content);
    let previous = '';
    let edited = false;
    const text = (node: T.Node): string =>
      'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : '';
    const walk = (node: T.ParentNode) => {
      node.childNodes = node.childNodes.filter((child) => {
        if ('tagName' in child && /^(p|h[1-6])$/.test(child.tagName)) {
          const value = text(child).normalize('NFKC').replace(/\s+/g, ' ').trim();
          const duplicate = value.length >= 24 && /\p{L}/u.test(value) && value === previous;
          previous = value;
          if (duplicate && !/<(?:img|br|math)\b/i.test(serialize(child))) {
            edited = true;
            return false;
          }
        } else if (
          'tagName' in child &&
          /^(ul|ol|li|table|pre|code|img|svg)$/.test(child.tagName)
        ) {
          previous = '';
        } else if ('childNodes' in child) walk(child);
        else if ('value' in child && child.value.trim()) previous = '';
        return true;
      });
    };
    walk(root);
    if (!edited) return element;
    changed = true;
    return { ...element, content: serialize(root) };
  });
  return changed ? result : elements;
}
