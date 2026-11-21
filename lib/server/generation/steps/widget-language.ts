import { parseFragment, parse, serialize, type DefaultTreeAdapterTypes } from 'parse5';
import { courseTarget } from './speech-language';
import {
  assertDisplayLanguage,
  displayNeedsTranslation,
  translateTexts,
} from '@/lib/server/course-translation';

/**
 * A page the model writes for an English course sometimes keeps Chinese
 * controls and status words ("启动 / 暂停 / 重新开始", "继续" after a pause).
 * Translate the learner-visible text of the page into the course language:
 * text nodes, button/label attributes and the string literals its script
 * shows (button captions it switches). Code, identifiers and numbers are
 * unchanged; a translation that changes a number is rejected.
 */
const VISIBLE_ATTRS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'value', 'label']);
const HAN = /[㐀-鿿]/;

type Node = DefaultTreeAdapterTypes.Node;

function walk(node: Node, visit: (node: Node) => void) {
  visit(node);
  if ('childNodes' in node) for (const child of node.childNodes) walk(child, visit);
  if ('content' in node && node.content) walk(node.content as Node, visit);
}

/** String literals in script source that contain Chinese ('…', "…", `…` without ${}). */
function scriptLiterals(source: string, allLanguages = false): string[] {
  const found: string[] = [];
  const pattern = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\$])*)`/g;
  for (const match of source.matchAll(pattern)) {
    const body = match[1] ?? match[2] ?? match[3] ?? '';
    if (
      HAN.test(body) ||
      (allLanguages && /[A-Za-z]{3}\s+[A-Za-z]{2}/.test(body) && !/[<>{}=;]/.test(body))
    )
      found.push(body);
  }
  return found;
}

function quoteLike(original: string, quote: string): string {
  return original.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`);
}

export async function localizeWidgetHtml(
  html: string,
  directive: string | undefined,
  translate: (system: string, prompt: string) => Promise<string>,
): Promise<string> {
  const target = courseTarget(directive);
  if (!target || (target === 'en' && !HAN.test(html))) return html;
  const needs = (text: string) => displayNeedsTranslation(text, directive);
  const whole = /<html[\s>]/i.test(html);
  const root = (whole ? parse(html) : parseFragment(html)) as Node;
  const texts: DefaultTreeAdapterTypes.TextNode[] = [];
  const attrs: Array<{ name: string; value: string }> = [];
  const scripts: DefaultTreeAdapterTypes.TextNode[] = [];
  const identifiers = new Set<string>();
  walk(root, (node) => {
    if ('attrs' in node)
      for (const attr of node.attrs)
        if (attr.name === 'id' || attr.name === 'name' || attr.name === 'class') {
          identifiers.add(attr.value);
          attr.value.split(/\s+/).forEach((value) => identifiers.add(value));
        }
  });
  walk(root, (node) => {
    if (node.nodeName === '#text') {
      const parent = (node as DefaultTreeAdapterTypes.TextNode).parentNode as
        | DefaultTreeAdapterTypes.Element
        | undefined;
      const tag = parent && 'tagName' in parent ? parent.tagName : '';
      if (tag === 'script') scripts.push(node as DefaultTreeAdapterTypes.TextNode);
      else if (
        tag !== 'style' &&
        tag !== 'script' &&
        needs((node as DefaultTreeAdapterTypes.TextNode).value)
      )
        texts.push(node as DefaultTreeAdapterTypes.TextNode);
    } else if ('attrs' in node) {
      for (const attr of node.attrs)
        if (VISIBLE_ATTRS.has(attr.name) && needs(attr.value)) attrs.push(attr);
    }
  });
  // Visible prose may be translated; DOM selectors are executable identifiers.
  const literals = [
    ...new Set(scripts.flatMap((node) => scriptLiterals(node.value, target !== 'en'))),
  ].filter((value) => !identifiers.has(value) && !/^[#.\[]/.test(value));
  const sources = [
    ...new Set([
      ...texts.map((node) => node.value.trim()),
      ...attrs.map((attr) => attr.value),
      ...literals,
    ]),
  ].filter(needs);
  if (!sources.length) return html;
  const items = sources.map((text) => ({ type: 'speech', text }));
  const system = (s: string) =>
    s.replace('classroom dialogue', 'user-interface text of an interactive teaching page') +
    ' These are button captions, labels and status messages: keep them short. Keep numbers, symbols, variable names and code unchanged.';
  const translated = await translateTexts(sources, directive, (s, p) => translate(system(s), p));
  const localized = items.map((item) => ({
    ...item,
    text: translated.get(item.text) ?? item.text,
  }));
  if (directive)
    assertDisplayLanguage(
      localized.map((item) => item.text),
      directive,
    );
  const numbers = (text: string) => JSON.stringify((text.match(/\d+(?:\.\d+)?/g) ?? []).sort());
  const map = new Map<string, string>();
  localized.forEach((item, i) => {
    const source = sources[i]!;
    if (item.text && item.text !== source && numbers(item.text) === numbers(source))
      map.set(source, item.text);
  });
  if (!map.size) return html;
  for (const node of texts) {
    const key = node.value.trim();
    const value = map.get(key);
    if (value) node.value = node.value.replace(key, value);
  }
  for (const attr of attrs) attr.value = map.get(attr.value) ?? attr.value;
  for (const node of scripts) {
    let source = node.value;
    for (const [from, to] of map)
      for (const quote of ["'", '"', '`']) {
        const literal = `${quote}${quoteLike(from, quote)}${quote}`;
        if (source.includes(literal))
          source = source.split(literal).join(`${quote}${quoteLike(to, quote)}${quote}`);
        // Literals in the source are already escaped; match them as written too.
        const raw = `${quote}${from}${quote}`;
        if (source.includes(raw))
          source = source.split(raw).join(`${quote}${quoteLike(to, quote)}${quote}`);
      }
    node.value = source;
  }
  return serialize(root as DefaultTreeAdapterTypes.Document);
}
