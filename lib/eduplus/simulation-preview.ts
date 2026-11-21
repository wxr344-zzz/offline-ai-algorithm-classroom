/** Inert export/thumbnail fallback. Playback uses the native Python-backed
 * simulator, never an embedded second algorithm implementation. */
export function simulationPreview(topic: string): string {
  const title = topic.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;padding:48px;background:#f8fafc;color:#0f172a;font:20px/1.8 system-ui}h1{font-size:32px}section{padding:24px;border:1px solid #cbd5e1;border-radius:12px;background:white}</style><h1>${title}：算法推演</h1><section>在课堂中逐步查看计算过程，或修改输入重新计算。<p>按算法展示数据表格、指针、树形结构和工作集合。</p></section></html>`;
}

/** Recover only our inert preview signature, never arbitrary model HTML. This
 * upgrades scenes written before app references survived scene assembly. */
export function simulationReferenceFromPreview(
  html: string,
  widgetType?: string,
): import('./simulation-contract').SimulationReference | undefined {
  // Upgrade our historical blocked export without executing its script. The
  // quoted topic is data; the native player now resolves or generates it.
  if (
    html.includes('此主题尚未匹配到唯一的可信算法执行器，暂不提供自动推演。') &&
    html.includes('已阻止播放大模型编写的未经验证的中间状态。')
  ) {
    const quoted =
      /document\.getElementById\('title'\)\.textContent=("(?:\\.|[^"\\])*")\+'：算法推演'/.exec(
        html,
      )?.[1];
    if (quoted) {
      try {
        const topic: unknown = JSON.parse(quoted);
        if (typeof topic === 'string' && topic.trim() && topic.length <= 2000)
          return { topic, mode: widgetType === 'game' ? 'game' : 'simulation' };
      } catch {
        /* Preserve unrelated HTML. */
      }
    }
  }
  if (
    !html.includes('<section>在课堂中逐步查看计算过程，或修改输入重新计算。') ||
    !html.includes('按算法展示数据表格、指针、树形结构和工作集合。')
  )
    return undefined;
  const encoded = /<h1>([^]*?)：算法推演<\/h1>/.exec(html)?.[1];
  if (!encoded || encoded.length > 2400) return undefined;
  const topic = encoded.replace(
    /&(amp|lt|gt|quot|#39);/g,
    (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]!,
  );
  if (!topic.trim() || topic.length > 2000) return undefined;
  return { topic, mode: widgetType === 'game' ? 'game' : 'simulation' };
}
