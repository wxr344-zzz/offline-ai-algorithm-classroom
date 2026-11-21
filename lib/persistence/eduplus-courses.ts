import type { Queryable } from '@openmaic/storage/document/pg';
import { applySchemaMigrations, type SchemaMigrationSet } from '@openmaic/storage/pg-migrations';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';
import {
  AgentAPIError,
  parseGeneratedCourse,
  parsePublicCourse,
} from '@/lib/server/eduplus-agent-client';
import type { GeneratedCourse, FinalOutput } from '@/lib/server/eduplus-internal.generated';
import type { PublicCourse } from '@/lib/types/eduplus.generated';
import type { LabScene, SaveDraftRequest, StudentDraft } from '@/lib/types/eduplus-practice';
import { parseClassroomRecord, type ClassroomRecord } from '@/lib/eduplus/classroom-contract';
import type { PracticeEvent, PracticeEventInput } from '@/lib/types/eduplus-learning';

export const EDUPLUS_COURSE_MIGRATIONS: SchemaMigrationSet = {
  store: 'eduplus-courses',
  migrations: [
    {
      version: 1,
      name: 'baseline',
      transaction: false,
      up: `
CREATE TABLE IF NOT EXISTS eduplus_courses (
  course_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
  public_data JSONB NOT NULL, private_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (public_data->>'courseId' = course_id),
  CHECK (private_data->>'course_id' = course_id)
);
CREATE INDEX IF NOT EXISTS eduplus_courses_owner_created_idx ON eduplus_courses(owner_id, created_at DESC, course_id);
`,
    },
    {
      version: 2,
      name: 'student-drafts',
      up: `
CREATE TABLE eduplus_drafts (
  course_id TEXT NOT NULL REFERENCES eduplus_courses(course_id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL, problem_version INTEGER NOT NULL CHECK (problem_version > 0),
  code TEXT NOT NULL CHECK (octet_length(code) <= 100000),
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, scene_id, problem_version)
);
`,
    },
    {
      version: 3,
      name: 'classroom-and-learning-events',
      up: `
ALTER TABLE eduplus_courses ADD COLUMN classroom_data JSONB;
CREATE TABLE eduplus_practice_events (
  course_id TEXT NOT NULL REFERENCES eduplus_courses(course_id) ON DELETE CASCADE,
  event_id UUID NOT NULL, payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, event_id),
  CHECK (octet_length(payload::text) <= 20000)
);
CREATE INDEX eduplus_practice_events_recent_idx ON eduplus_practice_events(course_id, created_at DESC);
`,
    },
    {
      version: 4,
      name: 'persistent-course-display-translations',
      up: `ALTER TABLE eduplus_courses ADD COLUMN display_translations JSONB NOT NULL DEFAULT '{}'::jsonb;`,
    },
  ],
};
export async function ensureEduplusCourseSchema(queryable: Queryable): Promise<void> {
  await applySchemaMigrations(queryable, EDUPLUS_COURSE_MIGRATIONS);
}
interface CourseProvider {
  pool: Queryable;
  withTransaction<T>(body: (tx: Queryable) => Promise<T>): Promise<T>;
}
export class EduplusCourseStore {
  constructor(private readonly provider: CourseProvider) {}
  async getDisplayTexts(
    ownerId: string,
    courseId: string,
    language: string,
  ): Promise<Map<string, string>> {
    const result = await this.provider.pool.query<
      { texts: Record<string, string> | null } & Record<string, unknown>
    >(
      'SELECT display_translations -> $3 AS texts FROM eduplus_courses WHERE course_id=$1 AND owner_id=$2',
      [courseId, ownerId, language],
    );
    return new Map(Object.entries(result.rows[0]?.texts ?? {}));
  }
  async saveDisplayTexts(
    ownerId: string,
    courseId: string,
    language: string,
    texts: ReadonlyMap<string, string>,
  ): Promise<void> {
    const value = JSON.stringify(Object.fromEntries(texts));
    if (Buffer.byteLength(value, 'utf8') > 1024 * 1024)
      throw new Error('Display translation too large');
    await this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, ownerId, courseId);
      await tx.query(
        'UPDATE eduplus_courses SET display_translations=jsonb_set(display_translations, ARRAY[$3]::text[], $4::jsonb) WHERE course_id=$1 AND owner_id=$2',
        [courseId, ownerId, language, value],
      );
    });
  }
  async save(ownerId: string, value: GeneratedCourse): Promise<PublicCourse> {
    const generated = parseGeneratedCourse(value);
    const publicCourse = parsePublicCourse(generated.publicCourse);
    if (Buffer.byteLength(JSON.stringify(generated), 'utf8') > 2 * 1024 * 1024) {
      throw new AgentAPIError(502, 'COURSE_TOO_LARGE', '生成课程资产超出存储上限。');
    }
    await this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, ownerId, publicCourse.courseId);
      // Immutable generation snapshot; never silently overwrite grading assets.
      await tx.query(
        'INSERT INTO eduplus_courses(course_id, owner_id, public_data, private_data) VALUES ($1, $2, $3::jsonb, $4::jsonb)',
        [
          publicCourse.courseId,
          ownerId,
          JSON.stringify(publicCourse),
          JSON.stringify(generated.privateOutput),
        ],
      );
    });
    return publicCourse;
  }
  async get(ownerId: string, courseId: string): Promise<PublicCourse | null> {
    const result = await this.provider.pool.query<
      { public_data: unknown } & Record<string, unknown>
    >('SELECT public_data FROM eduplus_courses WHERE course_id = $1 AND owner_id = $2', [
      courseId,
      ownerId,
    ]);
    return result.rows[0] ? parsePublicCourse(result.rows[0].public_data) : null;
  }
  /**
   * Server-only. The reference solution of one Lab scene, so the server can
   * compute the reference OUTPUT for a learner's own input (like an online
   * judge). The code itself must never be sent to a client.
   */
  async referenceForScene(
    ownerId: string,
    courseId: string,
    sceneId: string,
  ): Promise<{ code: string; problem: LabScene['problem'] } | null> {
    const output = await this.getPrivateForTeacher(ownerId, courseId);
    const problem = output?.problem;
    if (!problem) return null;
    if (problem.guided_scene.sceneId === sceneId)
      return { code: problem.reference_solution, problem: problem.guided_scene.problem };
    if (problem.oj_scene.sceneId === sceneId)
      return {
        code: problem.oj_assessment?.reference_solution ?? problem.reference_solution,
        problem: problem.oj_scene.problem,
      };
    return null;
  }
  /** Server-only. A caller must authorize the teacher role BEFORE calling this method. */
  async getPrivateForTeacher(ownerId: string, courseId: string): Promise<FinalOutput | null> {
    const result = await this.provider.pool.query<
      { public_data: unknown; private_data: unknown } & Record<string, unknown>
    >('SELECT public_data, private_data FROM eduplus_courses WHERE course_id=$1 AND owner_id=$2', [
      courseId,
      ownerId,
    ]);
    const row = result.rows[0];
    return row
      ? parseGeneratedCourse({ publicCourse: row.public_data, privateOutput: row.private_data })
          .privateOutput
      : null;
  }
  async list(ownerId: string): Promise<PublicCourse[]> {
    const result = await this.provider.pool.query<
      { public_data: unknown } & Record<string, unknown>
    >(
      'SELECT public_data FROM eduplus_courses WHERE owner_id = $1 ORDER BY created_at DESC, course_id LIMIT 50',
      [ownerId],
    );
    return result.rows.map((row) => parsePublicCourse(row.public_data));
  }
  async getClassroom(ownerId: string, courseId: string): Promise<ClassroomRecord | null> {
    const result = await this.provider.pool.query<
      { classroom_data: unknown } & Record<string, unknown>
    >('SELECT classroom_data FROM eduplus_courses WHERE course_id = $1 AND owner_id = $2', [
      courseId,
      ownerId,
    ]);
    return result.rows[0]?.classroom_data
      ? parseClassroomRecord(result.rows[0].classroom_data)
      : null;
  }
  async recordPractice(
    ownerId: string,
    courseId: string,
    input: PracticeEventInput,
  ): Promise<void> {
    await this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, ownerId, courseId);
      const result = await tx.query<{ public_data: unknown } & Record<string, unknown>>(
        'SELECT public_data FROM eduplus_courses WHERE course_id = $1 AND owner_id = $2 FOR SHARE',
        [courseId, ownerId],
      );
      const scene = this.findScene(
        result.rows[0] ? parsePublicCourse(result.rows[0].public_data) : null,
        input.sceneId,
      );
      if (scene.problem.problemVersion !== input.problemVersion)
        throw new AgentAPIError(409, 'PROBLEM_VERSION_CONFLICT', '题目版本已变化。');
      const total = scene.problem.publicTestCases.length;
      if (
        (input.status === 'completed' && (input.total !== total || input.passed > total)) ||
        (input.status !== 'completed' && (input.total !== 0 || input.passed !== 0))
      )
        throw new AgentAPIError(
          400,
          'INVALID_PRACTICE_EVENT',
          '评测记录用例数与题目不一致，请刷新题目后重新评测。',
        );
      if (input.draftRevision !== null) {
        const draft = await tx.query(
          'SELECT revision FROM eduplus_drafts WHERE course_id=$1 AND scene_id=$2 AND problem_version=$3 AND revision=$4',
          [courseId, input.sceneId, input.problemVersion, input.draftRevision],
        );
        if (!draft.rows.length)
          throw new AgentAPIError(409, 'DRAFT_CONFLICT', '草稿修订号已变化，练习记录未保存。');
      }
      // Client-reported public practice facts; never write a grade or hidden-test result.
      await tx.query(
        'INSERT INTO eduplus_practice_events(course_id,event_id,payload) VALUES ($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',
        [courseId, input.eventId, JSON.stringify(input)],
      );
    });
  }
  async listPractice(ownerId: string, courseId: string): Promise<PracticeEvent[]> {
    const result = await this.provider.pool.query<
      { payload: PracticeEventInput; created_at: Date | string } & Record<string, unknown>
    >(
      `SELECT e.payload, e.created_at FROM eduplus_practice_events e JOIN eduplus_courses c ON c.course_id=e.course_id
       WHERE c.owner_id=$1 AND e.course_id=$2 ORDER BY e.created_at DESC, e.event_id DESC LIMIT 100`,
      [ownerId, courseId],
    );
    return result.rows.map((row) => ({
      ...row.payload,
      source: 'browser-practice',
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
  private findScene(course: PublicCourse | null, sceneId: string): LabScene {
    const scene = course?.scenes.find((item) => item.sceneId === sceneId);
    if (!scene) throw new AgentAPIError(404, 'SCENE_NOT_FOUND', '实验不存在或无权访问。');
    return scene;
  }
  async getDraft(ownerId: string, courseId: string, sceneId: string): Promise<StudentDraft> {
    const scene = this.findScene(await this.get(ownerId, courseId), sceneId);
    const result = await this.provider.pool.query<
      { code: string; revision: number; updated_at: Date | string } & Record<string, unknown>
    >(
      `SELECT d.code, d.revision, d.updated_at FROM eduplus_drafts d
       JOIN eduplus_courses c ON c.course_id = d.course_id
       WHERE c.owner_id = $1 AND d.course_id = $2 AND d.scene_id = $3 AND d.problem_version = $4`,
      [ownerId, courseId, sceneId, scene.problem.problemVersion],
    );
    const row = result.rows[0];
    return {
      sceneId,
      problemVersion: scene.problem.problemVersion,
      code: row?.code ?? scene.interactiveCode,
      revision: row?.revision ?? 0,
      updatedAt: row ? new Date(row.updated_at).toISOString() : null,
    };
  }
  async saveDraft(
    ownerId: string,
    courseId: string,
    sceneId: string,
    input: SaveDraftRequest,
  ): Promise<StudentDraft> {
    if (Buffer.byteLength(input.code, 'utf8') > 100000)
      throw new AgentAPIError(400, 'DRAFT_TOO_LARGE', '代码不能超过 100 KB。');
    return this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, ownerId, courseId);
      const course = await tx.query<{ public_data: unknown } & Record<string, unknown>>(
        'SELECT public_data FROM eduplus_courses WHERE course_id = $1 AND owner_id = $2 FOR SHARE',
        [courseId, ownerId],
      );
      const scene = this.findScene(
        course.rows[0] ? parsePublicCourse(course.rows[0].public_data) : null,
        sceneId,
      );
      if (scene.problem.problemVersion !== input.problemVersion)
        throw new AgentAPIError(
          409,
          'PROBLEM_VERSION_CONFLICT',
          '题目版本已变化，请重新读取课程。',
        );
      // Compare-and-swap: another tab's newer code must never be silently overwritten.
      const result = await tx.query<
        { code: string; revision: number; updated_at: Date | string } & Record<string, unknown>
      >(
        input.revision === 0
          ? `INSERT INTO eduplus_drafts(course_id, scene_id, problem_version, code, revision)
             VALUES ($1, $2, $3, $4, 1)
             ON CONFLICT (course_id, scene_id, problem_version) DO NOTHING
             RETURNING code, revision, updated_at`
          : `UPDATE eduplus_drafts SET code = $4, revision = revision + 1, updated_at = now()
           WHERE course_id = $1 AND scene_id = $2 AND problem_version = $3 AND revision = $5
           RETURNING code, revision, updated_at`,
        input.revision === 0
          ? [courseId, sceneId, input.problemVersion, input.code]
          : [courseId, sceneId, input.problemVersion, input.code, input.revision],
      );
      const row = result.rows[0];
      if (!row)
        throw new AgentAPIError(
          409,
          'DRAFT_CONFLICT',
          '草稿已在其他页面修改。请先备份当前代码，再重新加载草稿。',
        );
      return {
        sceneId,
        problemVersion: input.problemVersion,
        code: row.code,
        revision: row.revision,
        updatedAt: new Date(row.updated_at).toISOString(),
      };
    });
  }
}
export async function getEduplusCourseStore(): Promise<EduplusCourseStore> {
  if (!process.env.DATABASE_URL?.trim())
    throw new AgentAPIError(503, 'PERSISTENCE_UNAVAILABLE', '课程数据库尚未配置。');
  try {
    const { getServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    return new EduplusCourseStore(await getServerPersistenceProvider(process.env.DATABASE_URL));
  } catch {
    throw new AgentAPIError(503, 'PERSISTENCE_UNAVAILABLE', '课程数据库连接或初始化失败。');
  }
}
export async function rekeyEduplusCourses(
  tx: Queryable,
  from: string,
  to: string,
): Promise<number> {
  const present = await tx.query<{ present: boolean } & Record<string, unknown>>(
    "SELECT to_regclass('eduplus_courses') IS NOT NULL AS present",
  );
  if (!present.rows[0]?.present) return 0;
  const result = await tx.query(
    'UPDATE eduplus_courses SET owner_id = $2 WHERE owner_id = $1 RETURNING course_id',
    [from, to],
  );
  return result.rows.length;
}
