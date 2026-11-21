// Real local-model test; stores public data only, never executes generated code.
import { writeFile } from 'node:fs/promises';
const prompt = process.argv[2];
if (!prompt) throw new Error('Specify an algorithm request');
const started = Date.now();
const response = await fetch('http://127.0.0.1:8001/v1/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt }),
  signal: AbortSignal.timeout(630000),
});
const result = await response.json();
await writeFile(
  'logs/applied-task-live-20261018.json',
  JSON.stringify(
    { prompt, status: response.status, elapsed: Date.now() - started, result },
    null,
    2,
  ),
);
if (!response.ok) throw new Error(JSON.stringify(result.error));
const oj = result.scenes?.find((s) => s.sceneType === 'oj-lab');
if (
  !oj ||
  oj.problem.executionMode !== 'stdio' ||
  !oj.problem.instructions.includes('与引导任务的区别')
)
  throw new Error('Applied task contract missing');
if (/class Solution|def solve/.test(oj.interactiveCode)) throw new Error('OJ skeleton leaked');
console.log(
  JSON.stringify({
    status: response.status,
    topic: result.topic,
    guided: result.scenes[0].problem.title,
    oj: oj.problem.title,
    elapsed: Date.now() - started,
  }),
);
