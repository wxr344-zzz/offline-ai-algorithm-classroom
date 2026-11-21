// SELECT-only diagnostic. Never calls a repair service or saves database rows.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const stage = process.argv[2];
if (!/^stage-[\w-]+$/.test(stage ?? '')) throw new Error('Invalid stage');
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
try {
  const owner = (await pool.query('SELECT owner_id FROM stage_meta WHERE stage_id=$1 AND deleted_at IS NULL',[stage])).rows[0]?.owner_id;
  if (!owner) throw new Error('Missing classroom');
  const scenes = (await pool.query('SELECT data FROM document_scenes WHERE stage_id=$1 ORDER BY scene_order',[stage])).rows.map(r=>r.data);
  const ids = [...new Set(scenes.map(s=>s.content?.eduplus?.courseId).filter(Boolean))];
  // Legacy scene refs can also be encoded in the generated iframe HTML.
  for (const s of scenes) for (const match of (s.content?.html ?? '').matchAll(/courses\/([a-f0-9-]{36})/g)) ids.push(match[1]);
  const rows = await pool.query('SELECT course_id, private_data FROM eduplus_courses WHERE owner_id=$1 AND course_id=ANY($2::text[])',[owner,[...new Set(ids)]]);
  if (!rows.rows.length) throw new Error('No referenced private asset found');
  const file=`logs/${stage}-quality-readonly-snapshot.json`;
  await writeFile(file,JSON.stringify({scenes,courses:rows.rows}),{flag:'wx'});
  console.log(JSON.stringify({snapshot:file,courseIds:rows.rows.map(r=>r.course_id)}));
} finally {await pool.end();}
