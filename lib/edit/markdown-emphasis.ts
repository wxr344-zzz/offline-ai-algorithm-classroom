import type { PPTElement } from '@openmaic/dsl';

/**
 * Slide text is HTML and speech is spoken, but a model sometimes writes
 * Markdown emphasis (**初始化参数**) anyway, which shows literal asterisks.
 * Bold pairs become <strong> on slides and plain words in speech; a stray
 * leftover ** is removed. Single * stays (it may be multiplication).
 * Markdown heading markers (### 标题) become a bold line on slides and are
 * dropped in speech; a # inside a line (C#, #include) is kept.
 */
const BOLD = /\*\*([^*<>\n]+?)\*\*/g;

// A Markdown heading line ("### 递归方法") at the start of the text, a line or a block.
const HEADING_HTML = /(^|>|\n)(\s*)#{1,6}[ \u00a0]+([^<\n]+)/g;
const HEADING_TEXT = /(^|\n)[ \t]*#{1,6}[ \t\u00a0]+/g;

export function emphasisToHtml(html: string): string {
  if (html.includes('#')) html = html.replace(HEADING_HTML, '$1$2<strong>$3</strong>');
  if (!html.includes('**')) return html;
  return html.replace(BOLD, '<strong>$1</strong>').replace(/\*\*/g, '');
}

export function stripEmphasis(text: string): string {
  if (text.includes('#')) text = text.replace(HEADING_TEXT, '$1');
  if (!text.includes('**') && !text.includes('__')) return text;
  return text
    .replace(BOLD, '$1')
    .replace(/__([^_\n]+?)__/g, '$1')
    .replace(/\*\*/g, '');
}

/**
 * Chinese has no italic letterforms: browsers slant the glyphs, which reads as
 * a broken font next to upright text. Italic emphasis in CJK text is dropped
 * (the words stay); Latin-only text keeps its italics.
 */
export function uprightCjk(html: string): string {
  if (!/[\u3400-\u9fff]/.test(html) || !/<(?:em|i)\b|italic/i.test(html)) return html;
  return html
    .replace(/<\/?(?:em|i)(?:\s[^>]*)?>/gi, '')
    .replace(/font-style\s*:\s*(?:italic|oblique)\s*;?/gi, '');
}

export function slideEmphasisToHtml(elements: PPTElement[]): PPTElement[] {
  let changed = false;
  const result = elements.map((element) => {
    if (element.type === 'text') {
      const content = uprightCjk(emphasisToHtml(element.content));
      if (content !== element.content) {
        changed = true;
        return { ...element, content };
      }
    }
    if (element.type === 'shape' && element.text?.content) {
      const content = uprightCjk(emphasisToHtml(element.text.content));
      if (content !== element.text.content) {
        changed = true;
        return { ...element, text: { ...element.text, content } };
      }
    }
    return element;
  });
  return changed ? result : elements;
}
