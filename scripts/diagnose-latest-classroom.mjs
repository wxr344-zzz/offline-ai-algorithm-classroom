// Read-only diagnostics for the most recent (or a given) generated classroom.
// Usage: node scripts/diagnose-latest-classroom.mjs [stage-id]
// Writes logs/diagnose-<stage-id>.json: the run's planned outline, the outline
// checkpoints, and every slide element's geometry, plus each interactive page's
// HTML as logs/diagnose-<stage-id>-<n>.html. No data is modified.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
const localRequire = createRequire(import.meta.url);
createRequire(localRequire.resolve('next/package.json'))('@next/env').loadEnvConfig(root);
const requested = process.argv[2];
if (requested && !/^stage-[a-zA-Z0-9_-]+$/.test(requested)) throw new Error('Invalid stage id');

const plain = (html = '') =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
const outlineSummary = (outlines = []) =>
  outlines.map((o) => ({
    id: o.id,
    type: o.type,
    widgetType: o.widgetType ?? null,
    title: o.title,
    eduplus: o.eduplus?.phase ?? null,
    algorithmDemo: Boolean(o.algorithmDemo),
  }));

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const run = (
      await pool.query(
        requested
          ? 'SELECT id, input, state, step, outline, stage_id, error, created_at FROM generation_runs WHERE stage_id=$1 ORDER BY created_at DESC LIMIT 1'
          : 'SELECT id, input, state, step, outline, stage_id, error, created_at FROM generation_runs WHERE stage_id IS NOT NULL ORDER BY created_at DESC LIMIT 1',
        requested ? [requested] : [],
      )
    ).rows[0];
    if (!run) throw new Error('No generation run found');
    const steps = (
      await pool.query(
        "SELECT step_id, output FROM generation_run_steps WHERE run_id=$1 AND step_id IN ('outline','outline:base','outline:lab-course')",
        [run.id],
      )
    ).rows;
    // Failed steps and retries, with the server's message (why a page failed).
    const failures = (
      await pool.query(
        "SELECT seq, type, data FROM generation_run_events WHERE run_id=$1 AND (type LIKE '%fail%' OR type LIKE '%error%' OR type LIKE '%retry%') ORDER BY seq",
        [run.id],
      )
    ).rows.map((row) => ({ type: row.type, ...row.data }));
    const scenes = (
      await pool.query('SELECT data FROM document_scenes WHERE stage_id=$1 ORDER BY scene_order', [
        run.stage_id,
      ])
    ).rows.map((row) => row.data);
    const report = {
      stageId: run.stage_id,
      createdAt: run.created_at,
      state: run.state,
      error: run.error,
      requirement: run.input?.requirement,
      agents: run.input?.agents,
      failures,
      plannedOutline: outlineSummary(run.outline?.outlines ?? run.outline),
      checkpoints: Object.fromEntries(
        steps.map((s) => [
          s.step_id,
          typeof s.output === 'string' ? s.output : outlineSummary(s.output?.outlines),
        ]),
      ),
      scenes: scenes.map((scene) => ({
        title: scene.title,
        type: scene.type,
        widgetType: scene.content?.widgetType ?? null,
        elements:
          scene.type === 'slide'
            ? (scene.content?.canvas?.elements ?? []).map((e) => ({
                id: e.id,
                type: e.type,
                left: Math.round(e.left),
                top: Math.round(e.top),
                width: Math.round(e.width),
                height: Math.round(e.height),
                fill: e.fill ?? e.color ?? null,
                text: e.type === 'text' || e.text ? plain(e.content ?? e.text?.content) : undefined,
              }))
            : undefined,
      })),
    };
    // Save each interactive page's HTML next to the report for inspection.
    scenes.forEach((scene, index) => {
      const html = scene.content?.html;
      if (scene.type !== 'interactive' || typeof html !== 'string') return;
      const htmlFile = path.join(root, 'logs', `diagnose-${run.stage_id}-${index + 1}.html`);
      fs.writeFileSync(htmlFile, html, 'utf8');
      report.scenes[index].htmlFile = path.relative(root, htmlFile);
    });
    const file = path.join(root, 'logs', `diagnose-${run.stage_id}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
    console.log(`Wrote ${file}`);
    console.log(
      JSON.stringify(
        {
          requirement: report.requirement,
          error: report.error,
          failures: report.failures,
          plannedOutline: report.plannedOutline,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
