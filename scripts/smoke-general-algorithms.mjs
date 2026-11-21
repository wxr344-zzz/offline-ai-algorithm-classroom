// Live local-model integration test. Never executes model-generated Python on the host.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const prompts = process.argv.slice(2);
if (!prompts.length) throw new Error('Pass one or more algorithm requests');
const results = [];
for (const [index, prompt] of prompts.entries()) {
  const checkpoint = `logs/general-algorithm-live-${index}.pending.json`;
  let course;
  try {
    const saved = JSON.parse(await readFile(checkpoint, 'utf8'));
    if (saved.prompt === prompt && saved.version === 'typed-transfer-v2') course = saved.course;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!course) {
    const generated = await fetch('http://127.0.0.1:8001/v1/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(630000),
    });
    course = await generated.json();
    if (!generated.ok) throw new Error(JSON.stringify(course.error));
    await writeFile(
      checkpoint,
      JSON.stringify({ version: 'typed-transfer-v2', prompt, course }, null, 2),
    );
  }
  if (!course.requiresLab || course.scenes.length !== 2)
    throw new Error('Algorithm silently became a theory lesson');
  const [guided, oj] = course.scenes;
  if (
    guided.sceneType !== 'guided-lab' ||
    oj.sceneType !== 'oj-lab' ||
    guided.problem.publicTestCases.length < 4 ||
    oj.problem.executionMode !== 'stdio' ||
    /class Solution|def solve/.test(oj.interactiveCode) ||
    guided.problem.instructions === oj.problem.instructions
  )
    throw new Error('Incomplete or duplicated Lab pair');
  const response = await fetch('http://127.0.0.1:8001/internal/v1/teaching', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.EDUPLUS_AGENT_SERVICE_TOKEN}`,
    },
    body: JSON.stringify(course),
    signal: AbortSignal.timeout(630000),
  });
  const teaching = await response.json();
  if (!response.ok || !teaching.algorithmTrace?.steps?.length)
    throw new Error('Missing algorithm trace: ' + response.status);
  await writeFile(
    `logs/general-algorithm-live-${index}.json`,
    JSON.stringify({ prompt, course, teaching }, null, 2),
  );
  results.push({
    prompt,
    topic: course.topic,
    guided: guided.problem.title,
    independent: oj.problem.title,
    publicAssertions: guided.problem.publicTestCases.length,
    traceSteps: teaching.algorithmTrace.steps.length,
  });
  console.log(JSON.stringify(results.at(-1)));
}
await writeFile('logs/general-algorithm-live-results.json', JSON.stringify(results, null, 2));
