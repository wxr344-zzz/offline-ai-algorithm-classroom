import type { PPTElement } from '@openmaic/dsl';
import { restoreLatexSource } from '@/lib/edit/inline-math-text';
import { renderLatexElementHtml } from '@/lib/edit/slide-edit-elements';
import { translateTexts, assertDisplayLanguage, type Translate } from '../course-translation';

/** Formula source and rendered HTML must agree. Translate explicit prose groups,
 * never chemical symbols, variables, coefficients, operators or TeX commands. */
export async function prepareSlideFormulas(
  elements: PPTElement[],
  directive: string | undefined,
  translate: Translate,
): Promise<PPTElement[]> {
  const formulas = elements.filter((element) => element.type === 'latex');
  if (!formulas.length) return elements;
  const sources = new Map(
    formulas.map((element) => [element.id, restoreLatexSource(element.latex)]),
  );
  const prose = [...sources.values()].flatMap((source) =>
    [...source.matchAll(/\\text(?:bf)?\{([^{}]+)\}/g)].map((match) => match[1]!),
  );
  const map = await translateTexts(prose, directive, translate);
  if (directive)
    assertDisplayLanguage(
      prose.map((text) => map.get(text) ?? text),
      directive,
    );
  return elements.map((element) => {
    if (element.type !== 'latex') return element;
    const latex = sources
      .get(element.id)!
      .replace(
        /(\\text(?:bf)?\{)([^{}]+)(\})/g,
        (_match, prefix: string, text: string, end: string) =>
          prefix + (map.get(text) ?? text) + end,
      );
    const html = renderLatexElementHtml(latex);
    if (!html) throw new Error('Formula rendering failed');
    return { ...element, latex, html };
  });
}
