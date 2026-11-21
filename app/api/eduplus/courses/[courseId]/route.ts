import { getEduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import { withEduplusOwner } from '@/lib/server/eduplus-route';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  return withEduplusOwner(request, async (ownerId, headers) => {
    const course = await (await getEduplusCourseStore()).get(ownerId, courseId);
    return course
      ? Response.json(course, { headers })
      : Response.json(
          { error: { code: 'COURSE_NOT_FOUND', message: '课程不存在或无权访问。' } },
          { status: 404, headers },
        );
  });
}
