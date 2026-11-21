import { parseFragment, type DefaultTreeAdapterTypes as P } from 'parse5';
import type { PPTElement } from '@openmaic/dsl';
import type { SceneOutline } from '@/lib/types/generation';

export function visibleSlideText(elements: PPTElement[]): string {
  let text = '';
  const visit = (node: P.Node) => {
    if ('tagName' in node && /^(script|style)$/.test(node.tagName)) return;
    if ('value' in node) text += `${node.value} `;
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  for (const element of elements) {
    const content =
      element.type === 'text'
        ? element.content
        : element.type === 'shape'
          ? element.text?.content
          : undefined;
    if (content) visit(parseFragment(content));
  }
  return text.trim();
}

/** Conservative corruption/grounding guard, not a subject-knowledge proof.
 * A purely graphical page is handled by the native diagram pipeline instead. */
export function slideTextIntegrity(elements: PPTElement[], outline: SceneOutline): string | null {
  const text = visibleSlideText(elements);
  if (/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text))
    return 'Replacement or control characters in slide prose';
  if (elements.some((item) => !['text', 'shape', 'line'].includes(item.type))) return null;
  const subject = [outline.title, ...outline.keyPoints]
    .join(' ')
    .toLowerCase()
    .replace(
      /介绍|简介|入门|概念|总结|课程|知识|核心|步骤|介绍|introduction|concepts?|summary|lesson|course|key|steps?|principles|example/gi,
      '',
    );
  const tokens = new Set(subject.match(/[a-z]{4,}/g) ?? []);
  for (const run of subject.match(/[\u3400-\u9fff]+/g) ?? [])
    for (let i = 0; i + 2 <= run.length; i++) tokens.add(run.slice(i, i + 2));
  for (const generic of [
    '作用',
    '基本',
    '机制',
    '过程',
    '定义',
    '原理',
    '主要',
    '阶段',
    '内容',
    '意义',
    '知识',
    '学习',
  ])
    tokens.delete(generic);
  if (
    tokens.size >= 2 &&
    text.length >= 20 &&
    ![...tokens].some((word) => text.toLowerCase().includes(word))
  )
    return 'Slide prose lost all of its planned subject vocabulary';
  return null;
}
