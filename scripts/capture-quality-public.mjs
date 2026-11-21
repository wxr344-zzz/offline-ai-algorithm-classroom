import { readFile, writeFile } from 'node:fs/promises';
for (const [name, stage] of [
  ['knapsack', 'stage-PepYtATxqt1H'],
  ['dijkstra', 'stage-yPwxDpKVAx-t'],
]) {
  const repaired = JSON.parse(await readFile(`logs/${stage}-quality-assets.json`, 'utf8'));
  const response = await fetch(
    `http://127.0.0.1:3000/api/eduplus/courses/${repaired.publicCourse.courseId}`,
  );
  if (!response.ok) throw new Error(`Public API failed: ${response.status}`);
  const body = await response.json();
  await writeFile(
    `logs/cross-algorithm-20261017/${name}-verified-assets.json`,
    JSON.stringify(body, null, 2),
  );
  console.log(
    JSON.stringify({ name, publicAPI: response.status, courseId: repaired.publicCourse.courseId }),
  );
}
