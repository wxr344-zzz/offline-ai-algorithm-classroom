import { isDocumentWriteRefusedError } from '@openmaic/storage';
import { getEduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { isStageIdTakenError } from '@/lib/persistence/owner-bound-document-store';
import { callTeachingCore, AgentAPIError } from '@/lib/server/eduplus-agent-client';
import { requireSameOrigin } from '@/lib/server/eduplus-request';
import { withEduplusOwner } from '@/lib/server/eduplus-route';
import { buildNativeClassroom } from '@/lib/eduplus/classroom-adapter';
import {
  applyLabDisplay,
  applyTeachingTexts,
  labDisplayTexts,
  teachingTexts,
} from '@/lib/eduplus/lab-display';
import { persistentCourseDisplay } from '@/lib/server/persistent-course-display';
import { teachingModelCall } from '@/lib/server/lab-display-model';

export const runtime = 'nodejs';
export const maxDuration = 660;
type Context = { params: Promise<{ courseId: string }> };
export async function GET(request: Request, context: Context) {
  const { courseId } = await context.params;
  return withEduplusOwner(request, async (ownerId, headers) => {
    const store = await getEduplusCourseStore();
    const course = await store.get(ownerId, courseId);
    const classroom = course ? await store.getClassroom(ownerId, courseId) : null;
    if (!course || !classroom)
      throw new AgentAPIError(404, 'CLASSROOM_NOT_FOUND', '原生课堂尚未创建或无权访问。');
    // The Lab text is generated in Chinese; a course taught in another language
    // sees a translated display copy (statements, steps, plan). Grading assets
    // and the stored course are untouched; on any failure the original shows.
    const lang = new URL(request.url).searchParams.get('lang') ?? '';
    if (/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(lang) && lang !== 'zh-CN') {
      try {
        const translate = teachingModelCall(
          ownerId,
          AbortSignal.any([request.signal, AbortSignal.timeout(150_000)]),
        );
        const map = await persistentCourseDisplay(
          store,
          ownerId,
          courseId,
          lang,
          [...labDisplayTexts(course), ...teachingTexts(classroom.teaching)],
          translate,
        );
        return Response.json(
          {
            ...classroom,
            teaching: applyTeachingTexts(classroom.teaching, map),
            course: applyLabDisplay(course, map),
          },
          { headers },
        );
      } catch {
        // Do not present untranslated source as if language preparation passed.
        throw new AgentAPIError(
          503,
          'COURSE_LANGUAGE_PENDING',
          `Course language preparation (${lang}) is incomplete. Please retry opening this page.`,
        );
      }
    }
    return Response.json({ ...classroom, course }, { headers });
  });
}
export async function POST(request: Request, context: Context) {
  const { courseId } = await context.params;
  return withEduplusOwner(request, async (ownerId, headers, principal) => {
    requireSameOrigin(request);
    const store = await getEduplusCourseStore();
    const course = await store.get(ownerId, courseId);
    if (!course) throw new AgentAPIError(404, 'COURSE_NOT_FOUND', '课程不存在或无权访问。');
    const existing = await store.getClassroom(ownerId, courseId);
    if (existing) {
      const document = await (
        await getOwnerScopedDocumentStore(principal)
      ).loadDocument(existing.stageId);
      if (!document)
        throw new AgentAPIError(
          409,
          'CLASSROOM_REMOVED',
          '原生课堂已删除或无法访问，请恢复课堂后重试。',
        );
      return Response.json(
        { stageId: existing.stageId, url: `/classroom/${existing.stageId}` },
        { headers },
      );
    }
    const teaching = await callTeachingCore(course, request.signal);
    const document = buildNativeClassroom(course, teaching);
    if (request.signal.aborted)
      throw new AgentAPIError(499, 'REQUEST_CANCELLED', '课堂创建请求已取消。');
    const documents = await getOwnerScopedDocumentStore(principal, async (tx) => {
      const owned = await tx.query(
        'SELECT course_id FROM eduplus_courses WHERE course_id=$1 AND owner_id=$2 FOR SHARE',
        [courseId, ownerId],
      );
      if (!owned.rows.length)
        throw new AgentAPIError(404, 'COURSE_NOT_FOUND', '课程不存在或无权访问。');
    });
    try {
      await documents.createDocument(document, {
        inTransaction: async (tx) => {
          const result = await tx.query(
            `UPDATE eduplus_courses SET classroom_data=$3::jsonb
          WHERE course_id=$1 AND owner_id=$2 AND classroom_data IS NULL RETURNING course_id`,
            [courseId, ownerId, JSON.stringify({ stageId: document.stage.id, teaching })],
          );
          if (!result.rows.length)
            throw new AgentAPIError(
              409,
              'CLASSROOM_CONFLICT',
              '课堂已在其他页面创建，请重新读取。',
            );
        },
      });
    } catch (error) {
      if (isStageIdTakenError(error)) {
        const committed = await store.getClassroom(ownerId, courseId);
        if (committed?.stageId === document.stage.id)
          return Response.json(
            { stageId: committed.stageId, url: `/classroom/${committed.stageId}` },
            { headers },
          );
        throw new AgentAPIError(409, 'STAGE_ID_TAKEN', '课堂标识已存在，未覆盖原课程。');
      }
      if (isDocumentWriteRefusedError(error))
        throw new AgentAPIError(403, 'CREATE_REFUSED', '当前用户无权创建课堂。');
      throw error;
    }
    return Response.json(
      { stageId: document.stage.id, url: `/classroom/${document.stage.id}` },
      { status: 201, headers },
    );
  });
}
