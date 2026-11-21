import fs from 'node:fs';
import assert from 'node:assert/strict';
import { CODING_MODEL, TEACHING_MODEL } from './dual-model-gateway.mjs';
const base = 'http://127.0.0.1:11436';
const results = [];
async function generate(model, prompt) {
  const started = Date.now();
  const r = await fetch(base + '/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      format: 'json',
      stream: false,
      options: { num_predict: 180, temperature: 0 },
    }),
    signal: AbortSignal.timeout(180000),
  });
  const o = await r.json();
  assert.equal(r.status, 200, JSON.stringify(o));
  const parsed = JSON.parse(o.response);
  const ps = await fetch('http://127.0.0.1:11434/api/ps').then((r) => r.json());
  const resident = ps.models.find((m) => m.name === model);
  results.push({
    model,
    elapsedMs: Date.now() - started,
    result: parsed,
    thinkingCharacters: (o.thinking ?? '').length,
    tokens: o.eval_count,
    tokensPerSecond: o.eval_duration ? o.eval_count / (o.eval_duration / 1e9) : null,
    resident: resident
      ? { size: resident.size, sizeVram: resident.size_vram, context: resident.context_length }
      : null,
  });
  console.log(JSON.stringify(results.at(-1)));
  return parsed;
}
const coding = await generate(
  CODING_MODEL,
  'Return only JSON with field result equal to the ascending order of [3,1,2].',
);
assert.deepEqual(coding.result, [1, 2, 3]);
const teaching = await generate(
  TEACHING_MODEL,
  '质量为2kg的物体所受合力为6N。只返回JSON：result为加速度的数值，explanation为一句简体中文解释。',
);
assert.equal(teaching.result, 3);
assert.ok(typeof teaching.explanation === 'string' && teaching.explanation.length > 0);
assert.equal(results.at(-1).thinkingCharacters, 0, 'Teaching thinking must be disabled');
const started = Date.now();
const r = await fetch(base + '/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    model: TEACHING_MODEL,
    messages: [{ role: 'user', content: '只返回JSON：{"ok":true}，不要其他内容。' }],
    response_format: { type: 'json_object' },
    max_tokens: 80,
    stream: false,
  }),
  signal: AbortSignal.timeout(180000),
});
const o = await r.json();
assert.equal(r.status, 200, JSON.stringify(o));
assert.equal(JSON.parse(o.choices[0].message.content).ok, true);
results.push({
  model: TEACHING_MODEL,
  api: 'openai-chat-completions',
  status: r.status,
  elapsedMs: Date.now() - started,
});
fs.writeFileSync('logs/dual-live-model-check.json', JSON.stringify(results, null, 2));
console.log('Both real local models and the web transport passed.');
