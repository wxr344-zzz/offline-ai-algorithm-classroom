/** Recover an explicitly selected existing run through the normal owner-scoped command. */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Pool } from 'pg';
import { retryGenerationRun } from '../lib/server/generation/run/store';
import { getEduplusCourseStore } from '../lib/persistence/eduplus-courses';
import { parseGeneratedCourse } from '../lib/server/eduplus-agent-client';
const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const id = process.argv[2];
if (!/^run-[A-Za-z0-9_-]+$/.test(id ?? '')) throw new Error('Specify an existing run');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const run = (await pool.query('SELECT owner_id,state FROM generation_runs WHERE id=$1', [id]))
    .rows[0];
  if (!run || run.state !== 'paused') throw new Error('Run must be paused');
  if (process.argv[3]) {
    const asset = path.resolve(process.argv[3]);
    const root = path.resolve('logs') + path.sep;
    if (!asset.startsWith(root)) throw new Error('Reviewed asset must be in workspace logs');
    const generated = parseGeneratedCourse(JSON.parse(await readFile(asset, 'utf8')));
    execFileSync(
      path.resolve('.venv/Scripts/python.exe'),
      ['scripts/audit-executable-course.py', asset],
      { timeout: 300000, stdio: 'pipe' },
    );
    await (await getEduplusCourseStore()).save(run.owner_id, generated);
    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      const locked = (
        await tx.query('SELECT owner_id,state,step FROM generation_runs WHERE id=$1 FOR UPDATE', [
          id,
        ])
      ).rows[0];
      if (
        locked?.owner_id !== run.owner_id ||
        locked.state !== 'paused' ||
        locked.step !== 'outline'
      )
        throw new Error('Run changed; recovery stopped');
      const existing = (
        await tx.query(
          "SELECT output FROM generation_run_steps WHERE run_id=$1 AND step_id='outline:lab-course'",
          [id],
        )
      ).rows[0];
      if (existing) throw new Error('Accepted lab checkpoint already exists');
      await tx.query(
        "INSERT INTO generation_run_steps(run_id,step_id,output) VALUES($1,'outline:lab-course',$2::jsonb)",
        [id, JSON.stringify(generated.publicCourse.courseId)],
      );
      await tx.query('COMMIT');
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally {
      tx.release();
    }
  }
  const result = await retryGenerationRun(id, run.owner_id, { commandId: randomUUID() });
  console.log(JSON.stringify({ id, result }));
} finally {
  await pool.end();
}
process.exit(0);
