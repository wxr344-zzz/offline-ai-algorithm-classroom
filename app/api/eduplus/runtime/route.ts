import { randomBytes } from 'node:crypto';

export const runtime = 'nodejs';
// This frame has an opaque origin (sandbox without allow-same-origin).
// Its CSP permits only runtime assets. Student Python cannot fetch app APIs or external sites.
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const nonce = randomBytes(24).toString('base64');
  const assetBase = `${origin}/vendor/eduplus/pyodide/`;
  const workerSource = `${origin}/eduplus-runtime/worker.js`;
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
    `script-src 'nonce-${nonce}' 'unsafe-eval' 'wasm-unsafe-eval' ${assetBase}`,
    `connect-src ${assetBase} ${workerSource}`,
    'worker-src blob:',
  ].join('; ');
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script nonce="${nonce}">
(() => {
  let port, worker, disposed = false;
  function dispose() { disposed = true; worker?.terminate(); worker = null; }
  window.addEventListener('pagehide', dispose, { once: true });
  window.addEventListener('message', async (event) => {
    if (event.source !== parent || event.data?.type !== 'connect' || port || !event.ports[0]) return;
    port = event.ports[0];
    port.onmessage = ({data}) => {
      if (data.type === 'dispose') dispose();
      else if (data.type === 'run' && !disposed) worker?.postMessage(data);
    };
    port.start();
    try {
      const response = await fetch(${JSON.stringify(workerSource)}, {credentials: 'omit'});
      if (!response.ok) throw new Error('运行脚本加载失败');
      const source = await response.text();
      if (disposed) return;
      const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = ({data}) => { if (!disposed) port.postMessage(data); };
      worker.onerror = (event) => {
        event.preventDefault();
        if (!disposed) port.postMessage({type: 'error', message: 'Python Worker 加载失败，请检查本地运行资源。'});
      };
      worker.postMessage({type: 'init', assetBase: ${JSON.stringify(assetBase)}});
    } catch (error) {
      if (!disposed) port.postMessage({type: 'error', message: String(error.message ?? error).slice(0, 1000)});
    }
  });
  // Signal only after the connect listener is installed. The parent validates
  // this frame's WindowProxy before transferring the one-use MessagePort.
  parent.postMessage({type:'eduplus-runtime-awaiting-port'}, '*');
})();
</script></body></html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
