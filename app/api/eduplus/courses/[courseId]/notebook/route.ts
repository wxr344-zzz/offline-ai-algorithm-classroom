import { getEduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import { downloadStudentNotebook, AgentAPIError } from '@/lib/server/eduplus-agent-client';
import { withEduplusOwner } from '@/lib/server/eduplus-route';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  return withEduplusOwner(request, async (ownerId, headers) => {
    const sceneType = new URL(request.url).searchParams.get('sceneType') ?? 'guided-lab';
    if (!['guided-lab', 'oj-lab'].includes(sceneType))
      throw new AgentAPIError(400, 'INVALID_REQUEST', '实验页面类型无效。');
    const source = new URL(request.url).searchParams.get('source') ?? 'template';
    if (!['template', 'draft'].includes(source))
      throw new AgentAPIError(400, 'INVALID_REQUEST', '导出来源无效。');
    const store = await getEduplusCourseStore();
    const course = await store.get(ownerId, courseId);
    if (!course) throw new AgentAPIError(404, 'COURSE_NOT_FOUND', '课程不存在或无权访问。');
    let savedDraft;
    if (source === 'draft') {
      const scene = course.scenes.find((item) => item.sceneType === sceneType);
      if (!scene) throw new AgentAPIError(400, 'NO_LAB_DRAFT', '当前课程没有实验草稿。');
      savedDraft = await store.getDraft(ownerId, courseId, scene.sceneId);
      if (savedDraft.revision === 0)
        throw new AgentAPIError(409, 'DRAFT_NOT_SAVED', '请先保存作答，再下载草稿 Notebook。');
    }
    let notebook: ArrayBuffer | string = await downloadStudentNotebook(
      course,
      sceneType,
      request.signal,
    );
    if (savedDraft) {
      const document = JSON.parse(new TextDecoder().decode(notebook));
      if (document.cells.length !== 3 || document.cells[1]?.cell_type !== 'code')
        throw new AgentAPIError(502, 'INVALID_EXPORT', 'Notebook 编程单元格格式无效。');
      // Preserve even unfinished/syntax-invalid student work; export never executes it.
      document.cells[1].source = '# 以下为已保存的学生作答\n' + savedDraft.code;
      document.cells[1].outputs = [];
      document.cells[1].execution_count = null;
      document.metadata.eduplus.draftRevision = savedDraft.revision;
      document.metadata.eduplus.draftUpdatedAt = savedDraft.updatedAt;
      document.metadata.eduplus.codeSource = 'saved-student-draft';
      notebook = JSON.stringify(document, null, 2) + '\n';
    }
    headers.set('Content-Type', 'application/x-ipynb+json');
    headers.set(
      'Content-Disposition',
      `attachment; filename="eduplus-${sceneType}${source === 'draft' ? '-draft' : ''}.ipynb"`,
    );
    return new Response(notebook, { headers });
  });
}
