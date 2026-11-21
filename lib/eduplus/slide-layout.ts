import type { GeneratedSlideContent } from '@/lib/types/generation';

export class SlideLayoutError extends Error {}

/** Pure text teaching slides use a predictable native PPT grid instead of LLM coordinates. */
export function stabilizeTextSlide(content: GeneratedSlideContent): GeneratedSlideContent {
  if (!content.elements.length) return content;
  const text = content.elements.filter((item) => item.type === 'text');
  // 背景矩形和装饰线不应让正文绕过排版。包含真正图片/图形的页面保留原布局。
  const decorative = content.elements.every(
    (item) =>
      item.type === 'text' ||
      item.type === 'line' ||
      (item.type === 'shape' && item.width >= 850 && item.height >= 450),
  );
  if (!decorative) {
    for (let i = 0; i < text.length; i++)
      for (let j = i + 1; j < text.length; j++) {
        const a = text[i],
          b = text[j];
        if (
          a.left < b.left + b.width &&
          b.left < a.left + a.width &&
          a.top < b.top + b.height &&
          b.top < a.top + a.height
        )
          throw new SlideLayoutError('讲解页文字框重叠，请拆分内容或重新生成该页。');
      }
    return content;
  }
  const elements = text;
  if (elements.length > 7) throw new SlideLayoutError('讲解页文字块过多，请拆分讲解页后重试。');
  const top = 38,
    titleHeight = 84,
    bodyStart = 140,
    bottom = 525;
  const bodyHeight = (bottom - bodyStart) / Math.max(1, elements.length - 1);
  return {
    ...content,
    background: { type: 'solid', color: '#ffffff' },
    elements: elements.map((item, index) => {
      if (item.type !== 'text') return item;
      const plain = item.content.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ');
      let fontSize =
        index === 0
          ? 30
          : Math.max(
              16,
              Math.min(
                24,
                Math.floor(Math.sqrt((900 * (bodyHeight - 12)) / Math.max(1, plain.length)) * 0.86),
              ),
            );
      const linesAt = (size: number) =>
        item.content
          .split(/<br\s*\/?\s*>|<\/p>|\n/i)
          .reduce(
            (total, line) =>
              total + Math.max(1, Math.ceil((line.replace(/<[^>]*>/g, '').length * size) / 904)),
            0,
          );
      const available = index === 0 ? titleHeight : bodyHeight - 10;
      while (fontSize > 16 && linesAt(fontSize) * fontSize * 1.35 > available) fontSize--;
      if (linesAt(fontSize) * fontSize * 1.35 > available)
        throw new SlideLayoutError('讲解页内容超出可读空间，请拆分讲解页后重试。');
      const html = item.content
        .replace(/font-size\s*:\s*[^;"']+;?/gi, '')
        .replace(/<p\b[^>]*>/gi, '<p style="margin:0 0 6px">');
      return {
        ...item,
        left: 48,
        top: index === 0 ? top : bodyStart + (index - 1) * bodyHeight,
        width: 904,
        height: index === 0 ? titleHeight : bodyHeight - 10,
        rotate: 0,
        content: `<div style="font-size:${fontSize}px;line-height:1.35;overflow-wrap:anywhere;white-space:pre-wrap">${html}</div>`,
        defaultFontName: 'Microsoft YaHei',
        defaultColor: '#172033',
        lineHeight: 1.35,
      };
    }),
  };
}
