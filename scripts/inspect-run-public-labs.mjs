// Read only: display public exercises for a single local generation run.
const id = process.argv[2];
if (!/^run-[A-Za-z0-9_-]+$/.test(id ?? '')) throw new Error('Specify one run');
const base = 'http://127.0.0.1:3000';
const response = await fetch(`${base}/api/generation-runs/${id}`);
if (!response.ok) throw new Error(`Run HTTP ${response.status}`);
const { run } = await response.json();
const outlines = run.outline?.outlines ?? [];
const ids = [...new Set(outlines.map((o) => o.eduplus?.courseId).filter(Boolean))];
for (const courseId of ids) {
  const res = await fetch(`${base}/api/eduplus/courses/${courseId}`);
  if (!res.ok) throw new Error(`Course HTTP ${res.status}`);
  const data = await res.json();
  console.log(JSON.stringify({ state: run.state, stageId: run.stageId, course: data }, null, 2));
}
