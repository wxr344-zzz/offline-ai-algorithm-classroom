import { getEduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import { AgentAPIError, downloadTeacherNotebook } from '@/lib/server/eduplus-agent-client';
import { withEduplusOwner } from '@/lib/server/eduplus-route';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  return withEduplusOwner(request, async (ownerId, headers, principal) => {
    // Roles come exclusively from the registered authentication method, never URL/body/cookies parsed here.
    if (
      principal.assurance !== 'verified' ||
      (!principal.roles.has('eduplus:teacher') && !principal.roles.has('admin'))
    )
      throw new AgentAPIError(403, 'TEACHER_ROLE_REQUIRED', '教师版导出需要经过认证的教师权限。');
    const privateOutput = await (
      await getEduplusCourseStore()
    ).getPrivateForTeacher(ownerId, courseId);
    if (!privateOutput) throw new AgentAPIError(404, 'COURSE_NOT_FOUND', '课程不存在或无权访问。');
    const notebook = await downloadTeacherNotebook(privateOutput, request.signal);
    headers.set('Content-Type', 'application/x-ipynb+json');
    headers.set('Content-Disposition', 'attachment; filename="eduplus-teacher.ipynb"');
    return new Response(notebook, { headers });
  });
}
