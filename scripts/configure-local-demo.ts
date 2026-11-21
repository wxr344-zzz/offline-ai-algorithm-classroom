/** Scoped, recoverable transition of one user-named classroom to the built-in local demo owner. */
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { lockOwnerIdentities } from '../lib/persistence/owner-merges';
import { getOwnerScopedDocumentStore } from '../lib/server/agent-runtime/owner-scoped-documents';
import { orderNativeLabOutlines } from '../lib/eduplus/native-outline';
import type { AppDocumentOutline } from '../lib/document-store/persistence-types';
const requireLocal = createRequire(import.meta.url);
createRequire(requireLocal.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const stageId = process.argv[2];
if (!/^stage-[A-Za-z0-9_-]+$/.test(stageId ?? '')) throw new Error('Specify exactly one classroom');
if (process.env.PERSISTENCE_SHARED_OWNER_ID)
  throw new Error('Shared deployment: local demo configuration refused');
const destination = 'local';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
async function main() {
  const initial = await pool.query(
    'SELECT owner_id FROM stage_meta WHERE stage_id=$1 AND deleted_at IS NULL',
    [stageId],
  );
  const from = initial.rows[0]?.owner_id;
  if (typeof from !== 'string') throw new Error('Classroom not found');
  if (from !== destination && !from.startsWith('anon:'))
    throw new Error('Only this local anonymous classroom can be adopted');
  const store = await getOwnerScopedDocumentStore(from);
  const doc = await store.loadDocument(stageId);
  const revision = await store.readFreshnessManifest(stageId);
  const outline = doc?.outline as AppDocumentOutline | undefined;
  if (!doc || !revision || !outline?.generationComplete)
    throw new Error('Completed classroom required');
  const courseIds = [
    ...new Set(
      doc.scenes.flatMap((scene) =>
        scene.content.type === 'interactive' && scene.content.eduplus
          ? [scene.content.eduplus.courseId]
          : [],
      ),
    ),
  ];
  if (!courseIds.length) throw new Error('No embedded labs');
  const courses = await pool.query(
    'SELECT * FROM eduplus_courses WHERE course_id=ANY($1::text[]) AND owner_id=$2 ORDER BY course_id',
    [courseIds, from],
  );
  if (
    courses.rows.length !== courseIds.length ||
    courses.rows.some((row) => row.classroom_data?.stageId !== stageId)
  )
    throw new Error('Course ownership or binding mismatch');
  const envPath = '.env.local';
  const environment = await readFile(envPath, 'utf8');
  const settings = ['OWNER_SINGLE_USER', 'OWNER_SINGLE_USER_ID'];
  const previousSettings = Object.fromEntries(
    settings.map((key) => [
      key,
      environment.match(new RegExp(`^\\s*${key}\\s*=.*$`, 'm'))?.[0] ?? null,
    ]),
  );
  await writeFile(
    `logs/${stageId}-before-local-demo.json`,
    JSON.stringify(
      {
        stageId,
        from,
        to: destination,
        revision: revision.rev,
        document: doc,
        courses: courses.rows,
        previousSettings,
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockOwnerIdentities(client, [from, destination], 'exclusive');
    const current = await client.query(
      'SELECT owner_id FROM stage_meta WHERE stage_id=$1 FOR UPDATE',
      [stageId],
    );
    const rev = await client.query(
      'SELECT rev FROM document_stage_revision WHERE stage_id=$1 FOR UPDATE',
      [stageId],
    );
    if (current.rows[0]?.owner_id !== from || Number(rev.rows[0]?.rev) !== revision.rev)
      throw new Error('Concurrent edit: nothing migrated');
    await client.query('UPDATE stage_meta SET owner_id=$2 WHERE stage_id=$1 AND owner_id=$3', [
      stageId,
      destination,
      from,
    ]);
    const legacy = await client.query(
      "SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('document_stages') AND attname='owner_id' AND NOT attisdropped) AS present",
    );
    if (legacy.rows[0].present)
      await client.query('UPDATE document_stages SET owner_id=$2 WHERE id=$1', [
        stageId,
        destination,
      ]);
    const moved = await client.query(
      'UPDATE eduplus_courses SET owner_id=$2 WHERE course_id=ANY($1::text[]) AND owner_id=$3 RETURNING course_id',
      [courseIds, destination, from],
    );
    if (moved.rows.length !== courseIds.length) throw new Error('Concurrent Lab ownership change');
    // Drafts and practice records key by course/scene, so no copy or deletion is needed.
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  let nextEnv = environment;
  for (const [key, value] of [
    ['OWNER_SINGLE_USER', 'true'],
    ['OWNER_SINGLE_USER_ID', destination],
  ]) {
    const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
    nextEnv = pattern.test(nextEnv)
      ? nextEnv.replace(pattern, `${key}=${value}`)
      : `${nextEnv.trimEnd()}\n${key}=${value}\n`;
  }
  await writeFile(envPath, nextEnv, 'utf8');
  const ordered = orderNativeLabOutlines(outline.outlines);
  const positions = new Map(ordered.map((item) => [item.id, item.order]));
  const scenes = doc.scenes
    .filter((scene) => positions.has(scene.outlineId ?? scene.id))
    .map((scene) => ({ ...scene, order: positions.get(scene.outlineId ?? scene.id)! }));
  const checked = new WeakSet<object>();
  const destinationStore = await getOwnerScopedDocumentStore(destination, async (tx) => {
    if (checked.has(tx)) return;
    await tx.query('SELECT stage_id FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 FOR UPDATE', [
      stageId,
      destination,
    ]);
    const current = await tx.query(
      'SELECT rev FROM document_stage_revision WHERE stage_id=$1 FOR UPDATE',
      [stageId],
    );
    if (Number(current.rows[0]?.rev) !== revision.rev)
      throw new Error('Concurrent edit: document layout was not changed');
    checked.add(tx);
  });
  await destinationStore.saveDocument({
    ...doc,
    scenes,
    stage: { ...doc.stage, updatedAt: Date.now() },
    outline: { ...outline, outlines: ordered, updatedAt: Date.now() },
  });
  console.log(
    JSON.stringify({
      stageId,
      localDemo: true,
      scenes: scenes.length,
      linkedCourses: courseIds.length,
      draftsRetained: true,
      otherClassroomsUnchanged: true,
    }),
  );
}
main()
  .catch((error) => {
    console.error(error.code ?? error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
