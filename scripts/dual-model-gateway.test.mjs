import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createGateway,
  prepareBody,
  TEACHING_MODEL,
  CODING_MODEL,
  CODING_RUNTIME_MODEL,
} from './dual-model-gateway.mjs';

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
async function rig(t, handler) {
  const upstream = http.createServer(handler),
    url = await listen(upstream);
  const gateway = createGateway({ upstream: url, logger: () => {}, codingAlias: false }),
    base = await listen(gateway);
  t.after(async () => {
    await close(gateway);
    await close(upstream);
  });
  return base;
}
const send = (base, model, extra = {}) =>
  fetch(base + '/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: 'test', stream: false, ...extra }),
  });
test('teaching context and thinking overrides do not mutate Qwen settings or caller input', () => {
  const input = { model: TEACHING_MODEL, options: { temperature: 0.2 }, think: true };
  const prepared = prepareBody(input, true);
  assert.equal(prepared.think, false);
  assert.equal(prepared.options.num_ctx, 16384);
  assert.deepEqual(input, { model: TEACHING_MODEL, options: { temperature: 0.2 }, think: true });
  const coding = { model: CODING_MODEL, options: { num_ctx: 4096 }, think: true };
  assert.deepEqual(prepareBody(coding, true), { ...coding, keep_alive: '5m' });
  // Qwen without an explicit window gets the 16K context on native calls,
  // and OpenAI-compatible calls use the context-carrying alias when present.
  assert.equal(prepareBody({ model: CODING_MODEL }, true).options.num_ctx, 16384);
  assert.equal(
    prepareBody({ model: CODING_MODEL }, false, { codingAlias: CODING_RUNTIME_MODEL }).model,
    CODING_RUNTIME_MODEL,
  );
  assert.equal(prepareBody({ model: CODING_MODEL }, false).model, CODING_MODEL);
  assert.throws(() => prepareBody({ model: 'unapproved' }, true));
});
test('concurrent generations execute serially and unload the previous model before switching', async (t) => {
  let active = 0,
    max = 0;
  const sequence = [];
  const base = await rig(t, async (req, res) => {
    let raw = '';
    for await (const b of req) raw += b;
    const body = JSON.parse(raw);
    sequence.push([body.model, body.keep_alive]);
    active++;
    max = Math.max(max, active);
    await delay(25);
    active--;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ done: true }));
  });
  const first = send(base, CODING_MODEL),
    second = send(base, TEACHING_MODEL);
  const responses = await Promise.all([first, second]);
  await Promise.all(responses.map((r) => r.text()));
  assert.equal(max, 1);
  assert.deepEqual(
    sequence.map((s) => s[0]),
    [CODING_MODEL, CODING_MODEL, TEACHING_MODEL],
  );
  assert.equal(sequence[1][1], 0);
});
test('streaming chunks are forwarded before completion', async (t) => {
  let finish;
  const gate = new Promise((r) => (finish = r));
  const base = await rig(t, async (req, res) => {
    for await (const _ of req) {
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write('{"response":"first","done":false}\n');
    await gate;
    res.end('{"response":"last","done":true}\n');
  });
  const response = await send(base, CODING_MODEL, { stream: true });
  const reader = response.body.getReader();
  const chunk = await reader.read();
  assert.match(new TextDecoder().decode(chunk.value), /first/);
  finish();
  let end = '';
  for (;;) {
    const c = await reader.read();
    if (c.done) break;
    end += new TextDecoder().decode(c.value);
  }
  assert.match(end, /last/);
});
test('client cancellation frees the queue for the next request', async (t) => {
  let calls = 0;
  let seen;
  const started = new Promise((r) => (seen = r));
  const base = await rig(t, async (req, res) => {
    for await (const _ of req) {
    }
    calls++;
    if (calls === 1) {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write('{"part":1}\n');
      seen();
    } else res.end('{"done":true}');
  });
  const controller = new AbortController();
  const response = await fetch(base + '/api/generate', {
    method: 'POST',
    body: JSON.stringify({ model: CODING_MODEL }),
    signal: controller.signal,
  });
  await started;
  controller.abort();
  await response.text().catch(() => {});
  const next = await send(base, CODING_MODEL);
  assert.equal(next.status, 200);
  assert.match(await next.text(), /true/);
});
test('model mutation and unknown models are rejected without forwarding', async (t) => {
  let requests = 0;
  const base = await rig(t, (req, res) => {
    requests++;
    res.end('{}');
  });
  assert.equal((await fetch(base + '/api/pull', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await send(base, 'outside-model')).status, 502);
  assert.equal(requests, 0);
});
test('OpenAI-compatible Qwen calls run on the context-carrying alias when it is installed', async (t) => {
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    let raw = '';
    for await (const b of req) raw += b;
    if (req.url === '/api/tags') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ models: [{ name: CODING_RUNTIME_MODEL }] }));
    }
    seen.push([req.url, JSON.parse(raw).model]);
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  });
  const url = await listen(upstream);
  const gateway = createGateway({ upstream: url, logger: () => {} });
  const base = await listen(gateway);
  t.after(async () => {
    await close(gateway);
    await close(upstream);
  });
  const post = (path, body) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.text());
  await post('/v1/chat/completions', { model: CODING_MODEL, messages: [] });
  await post('/api/show', { model: CODING_MODEL });
  await post('/v1/chat/completions', { model: TEACHING_MODEL, messages: [] });
  assert.deepEqual(seen, [
    ['/v1/chat/completions', CODING_RUNTIME_MODEL],
    ['/api/show', CODING_RUNTIME_MODEL],
    ['/api/generate', CODING_RUNTIME_MODEL],
    ['/v1/chat/completions', TEACHING_MODEL],
  ]);
});
