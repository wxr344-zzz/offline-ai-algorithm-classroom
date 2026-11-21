import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import pg from 'pg';
const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const stageId = process.argv[2];
if (!/^stage-[A-Za-z0-9_-]+$/.test(stageId ?? '')) throw new Error('Specify one stage');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const { rows } = await pool.query(
    `SELECT m.owner_id, s.data FROM stage_meta m JOIN document_stages s ON s.id=m.stage_id WHERE m.stage_id=$1 AND m.deleted_at IS NULL`,
    [stageId],
  );
  if (!rows.length) throw new Error('Missing stage');
  const owner = rows[0].owner_id;
  const scenes = await pool.query(
    'SELECT data FROM document_scenes WHERE stage_id=$1 ORDER BY scene_order',
    [stageId],
  );
  const refs = scenes.rows
    .filter((row) => row.data.content.eduplus)
    .map((row) => ({ sceneId: row.data.id, title: row.data.title, ...row.data.content.eduplus }));
  const ids = [...new Set(refs.map((ref) => ref.courseId))];
  const courses = await pool.query(
    'SELECT course_id,owner_id,public_data,classroom_data FROM eduplus_courses WHERE course_id=ANY($1::text[])',
    [ids],
  );
  console.log(
    JSON.stringify(
      {
        singleUser: process.env.OWNER_SINGLE_USER ?? 'unset',
        singleUserId: process.env.OWNER_SINGLE_USER_ID ?? 'default',
        stageOwnerKind: owner.startsWith('anon:') ? 'anonymous' : 'named',
        stageOwnerDigest: createHash('sha256').update(owner).digest('hex').slice(0, 10),
        refs,
        courses: courses.rows.map((row) => ({
          courseId: row.course_id,
          sameOwner: row.owner_id === owner,
          boundStage: row.classroom_data?.stageId,
          phases: row.public_data.scenes.map((scene) => scene.sceneType),
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
