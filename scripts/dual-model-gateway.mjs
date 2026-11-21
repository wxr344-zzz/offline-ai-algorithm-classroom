// Local-only serialization for two models sharing one 8GB GPU. No prompt logging.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const TEACHING_MODEL = 'openmaic-gemma4-e4b:dual-16k';
export const CODING_MODEL = 'qwen2.5-coder:7b';
// Same Qwen weights with a 16K context. Ollama's OpenAI-compatible endpoint cannot
// set num_ctx per request, so without this alias every /v1 Qwen call ran with
// Ollama's default window (usually 4096) and long prompts (classroom director,
// outlines, interactive pages) were silently truncated.
export const CODING_RUNTIME_MODEL = 'openmaic-qwen2.5-coder:dual-16k';
export const CONTEXT_LENGTH = 16384;
export function prepareBody(body, native, { codingAlias } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Invalid model request');
  if (![TEACHING_MODEL, CODING_MODEL].includes(body.model))
    throw new Error('Model is outside the test allowlist');
  const result = { ...body };
  if (native) result.keep_alive = '5m';
  if (body.model === TEACHING_MODEL) {
    if (native) {
      result.think = false;
      result.options = { ...body.options, num_ctx: CONTEXT_LENGTH };
    } else {
      result.reasoning_effort = 'none';
      delete result.reasoning;
    }
  } else if (body.model === CODING_MODEL) {
    if (native) {
      if (!body.options || body.options.num_ctx === undefined)
        result.options = { ...body.options, num_ctx: CONTEXT_LENGTH };
    } else if (codingAlias) {
      result.model = codingAlias;
    }
  }
  return result;
}

/** Whether the local Ollama has the context-carrying Qwen alias (cached, re-checked while missing). */
export function createAliasProbe(upstream, alias = CODING_RUNTIME_MODEL, fetchImpl = fetch) {
  let known = false;
  let checkedAt = 0;
  return async () => {
    if (known) return alias;
    if (Date.now() - checkedAt < 30_000) return undefined;
    checkedAt = Date.now();
    try {
      const tags = await fetchImpl(new URL('/api/tags', upstream), {
        signal: AbortSignal.timeout(3000),
      }).then((r) => r.json());
      known = Boolean(tags?.models?.some((m) => m.name === alias || m.model === alias));
    } catch {
      known = false;
    }
    return known ? alias : undefined;
  };
}

export function createGateway({
  upstream = 'http://127.0.0.1:11434',
  logger = console.log,
  codingAlias,
} = {}) {
  const target = new URL(upstream);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.protocol !== 'http:')
    throw new Error('Upstream must be local');
  const resolveCodingAlias =
    typeof codingAlias === 'function'
      ? codingAlias
      : codingAlias === undefined
        ? createAliasProbe(upstream)
        : async () => codingAlias || undefined;
  let tail = Promise.resolve();
  let currentModel = null;
  let sequence = 0;
  return http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          status: 'ok',
          service: 'openmaic-dual-model-gateway',
          currentModel,
          models: [TEACHING_MODEL, CODING_MODEL],
        }),
      );
    }
    const url = new URL(req.url, upstream);
    if (url.origin !== target.origin || !/^\/(?:api|v1)\//.test(url.pathname)) {
      res.writeHead(404);
      return res.end();
    }
    // The application may read model metadata; the gateway never permits model mutation or downloads.
    const generation = [
      '/api/generate',
      '/api/chat',
      '/v1/chat/completions',
      '/v1/completions',
      '/v1/responses',
    ].includes(url.pathname);
    const metadata =
      ['/api/show', '/api/tags', '/api/ps', '/api/version', '/v1/models'].includes(url.pathname) ||
      url.pathname.startsWith('/v1/models/');
    if ((!generation && !metadata) || !['GET', 'POST'].includes(req.method)) {
      res.writeHead(403);
      return res.end();
    }
    const abort = new AbortController();
    req.on('aborted', () => abort.abort());
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    let release;
    let timer;
    let requestModel;
    const id = ++sequence,
      started = Date.now();
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 20_000_000) throw new Error('Request too large');
        chunks.push(chunk);
      }
      let body = Buffer.concat(chunks);
      if (generation) {
        if (req.method !== 'POST') throw new Error('Generation requires POST');
        const native = url.pathname.startsWith('/api/');
        const parsed = prepareBody(JSON.parse(body.toString('utf8')), native, {
          codingAlias: native ? undefined : await resolveCodingAlias(),
        });
        requestModel = parsed.model;
        body = Buffer.from(JSON.stringify(parsed));
        const previous = tail;
        tail = new Promise((resolve) => {
          release = resolve;
        });
        await previous;
        if (abort.signal.aborted) throw new Error('Cancelled while queued');
        timer = setTimeout(() => abort.abort(), 600_000);
        if (currentModel && currentModel !== requestModel) {
          const unloaded = await fetch(new URL('/api/generate', upstream), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: currentModel, keep_alive: 0, stream: false }),
            signal: AbortSignal.timeout(30000),
          });
          if (!unloaded.ok) throw new Error('Could not unload previous test model');
          await unloaded.arrayBuffer();
          currentModel = null;
        }
      }
      if (!generation && url.pathname === '/api/show' && req.method === 'POST') {
        try {
          const shown = JSON.parse(body.toString('utf8'));
          const alias = shown?.model === CODING_MODEL ? await resolveCodingAlias() : undefined;
          if (alias) body = Buffer.from(JSON.stringify({ ...shown, model: alias }));
        } catch {
          // forward unchanged
        }
      }
      const headers = { 'content-type': req.headers['content-type'] ?? 'application/json' };
      if (req.headers.accept) headers.accept = req.headers.accept;
      const response = await fetch(url, {
        method: req.method,
        headers,
        body: req.method === 'GET' ? undefined : body,
        signal: abort.signal,
      });
      if (generation && response.ok) currentModel = requestModel;
      const outgoing = {};
      for (const key of ['content-type', 'cache-control']) {
        const value = response.headers.get(key);
        if (value) outgoing[key] = value;
      }
      res.writeHead(response.status, outgoing);
      if (response.body) await pipeline(Readable.fromWeb(response.body), res);
      else res.end();
      if (generation)
        logger(
          JSON.stringify({
            id,
            model: requestModel,
            path: url.pathname,
            status: response.status,
            elapsedMs: Date.now() - started,
          }),
        );
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(abort.signal.aborted ? 499 : 502, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: abort.signal.aborted ? 'Model request cancelled' : String(error.message),
          }),
        );
      } else if (!res.destroyed) res.destroy();
      if (generation)
        logger(
          JSON.stringify({
            id,
            model: requestModel,
            path: url.pathname,
            error: abort.signal.aborted ? 'cancelled' : String(error.message),
            elapsedMs: Date.now() - started,
          }),
        );
    } finally {
      if (timer) clearTimeout(timer);
      if (release) release();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createGateway();
  server.listen(11436, '127.0.0.1', () =>
    console.log('Dual-model gateway listening on 127.0.0.1:11436'),
  );
  process.on('SIGINT', () => server.close());
  process.on('SIGTERM', () => server.close());
}
