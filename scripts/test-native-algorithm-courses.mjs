// Real homepage-pipeline tests; no generated Python is executed on the host.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:3000';
const directory = 'logs/cross-algorithm-20261017';
await mkdir(directory, { recursive: true });
const cases = [
  [
    'binary-search',
    '讲解二分查找算法，包含编程练习。在非递减整数数组中查找目标值，重复值返回第一个位置，找不到返回 -1。',
  ],
  ['dijkstra', '讲解 Dijkstra 非负权图单源最短路径算法，包含编程练习。不可达节点距离用 -1 表示。'],
  [
    'knapsack',
    '讲解 0/1 背包动态规划算法，包含编程练习。物品只能选一次，总重量不超过容量，求最大总价值。',
  ],
];
async function request(path, body) {
  const response = await fetch(
    base + path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data.error ?? data)}`);
  return data;
}
for (const [name, requirement] of cases) {
  const checkpoint = `${directory}/${name}-run.json`;
  let run;
  try {
    run = JSON.parse(await readFile(checkpoint, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!run) {
    run = (
      await request('/api/generation-runs', {
        requirement,
        locale: 'zh-CN',
        interactive: false,
        taskEngine: false,
        agents: { mode: 'preset', agentIds: ['default-1', 'default-2', 'default-3', 'default-4'] },
        outlineReview: 'auto',
      })
    ).run;
    await writeFile(checkpoint, JSON.stringify(run, null, 2));
  }
  let previous = '';
  const started = Date.now();
  while (Date.now() - started < 1800000) {
    run = (await request(`/api/generation-runs/${run.id}`)).run;
    await writeFile(`${directory}/${name}-latest.json`, JSON.stringify(run, null, 2));
    const progress = JSON.stringify({
      name,
      id: run.id,
      state: run.state,
      step: run.step,
      stageId: run.stageId,
      progress: run.progress,
      error: run.error,
    });
    if (progress !== previous) {
      console.log(progress);
      previous = progress;
    }
    if (['completed', 'paused', 'ended'].includes(run.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (run.state !== 'completed') {
    console.log(JSON.stringify({ name, result: 'not-complete' }));
    continue;
  }
  const refs = run.outline.outlines.filter((outline) => outline.eduplus);
  const courseId = refs.find((outline) => outline.eduplus.phase === 'guided-lab')?.eduplus.courseId;
  if (!courseId) throw new Error(`${name}: missing native Lab binding`);
  const course = await request(`/api/eduplus/courses/${courseId}`);
  const classroom = await request(`/api/eduplus/courses/${courseId}/classroom`);
  const review = await request(`/api/eduplus/courses/${courseId}/review`);
  await writeFile(
    `${directory}/${name}-public.json`,
    JSON.stringify({ course, classroom, review }, null, 2),
  );
  console.log(
    JSON.stringify({
      name,
      result: 'generated',
      stageId: run.stageId,
      courseId,
      phases: refs.map((outline) => outline.eduplus.phase),
    }),
  );
}
