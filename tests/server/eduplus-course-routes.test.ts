import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getCourse } from '@/app/api/eduplus/courses/[courseId]/route';
import { GET as exportNotebook } from '@/app/api/eduplus/courses/[courseId]/notebook/route';
import fixture from '@/contracts/examples/public-lab.json';

const dependencies = vi.hoisted(() => ({ get: vi.fn(), getDraft: vi.fn(), notebook: vi.fn() }));
vi.mock('@/lib/persistence/eduplus-courses', () => ({
  getEduplusCourseStore: async () => ({ get: dependencies.get, getDraft: dependencies.getDraft }),
}));
vi.mock('@/lib/server/eduplus-agent-client', async (original) => ({
  ...(await original<typeof import('@/lib/server/eduplus-agent-client')>()),
  downloadStudentNotebook: dependencies.notebook,
}));
vi.mock('@/lib/server/identity/with-owner', () => ({
  withRequestOwner: async (
    _request: Request,
    handler: (principal: { ownerId: string }, headers: Headers) => Promise<Response>,
  ) => handler({ ownerId: 'authenticated-owner' }, new Headers({ 'Set-Cookie': 'owner=test' })),
}));
const context = () => ({ params: Promise.resolve({ courseId: fixture.courseId }) });
beforeEach(() => {
  dependencies.get.mockReset().mockResolvedValue(fixture);
  dependencies.notebook.mockReset();
  dependencies.getDraft.mockReset().mockResolvedValue({
    code: '# student work',
    revision: 2,
    updatedAt: '2026-10-13T00:00:00.000Z',
  });
});
describe('owner-scoped course reading and downloads', () => {
  it('uses the resolved owner instead of a client owner parameter', async () => {
    const response = await getCourse(new Request('http://local/api?ownerId=attacker'), context());
    expect(response.status).toBe(200);
    expect(dependencies.get).toHaveBeenCalledWith('authenticated-owner', fixture.courseId);
    expect(response.headers.get('Set-Cookie')).toContain('owner=test');
    expect(await response.json()).toEqual(fixture);
  });
  it('answers the same 404 for a missing course or a different owner', async () => {
    dependencies.get.mockResolvedValueOnce(null);
    const response = await getCourse(new Request('http://local/api'), context());
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('COURSE_NOT_FOUND');
  });
  it('refuses exporting before an owned course is found', async () => {
    dependencies.get.mockResolvedValueOnce(null);
    const response = await exportNotebook(new Request('http://local/api'), context());
    expect(response.status).toBe(404);
    expect(dependencies.notebook).not.toHaveBeenCalled();
  });
  it('returns an attachment generated from the stored public assets', async () => {
    dependencies.notebook.mockResolvedValueOnce(new TextEncoder().encode('{"nbformat":4}').buffer);
    const response = await exportNotebook(
      new Request('http://local/api?sceneType=oj-lab'),
      context(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('oj-lab.ipynb');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(dependencies.notebook).toHaveBeenCalledWith(fixture, 'oj-lab', expect.any(AbortSignal));
  });
  it('rejects invalid export variants', async () => {
    const response = await exportNotebook(
      new Request('http://local/api?sceneType=teacher'),
      context(),
    );
    expect(response.status).toBe(400);
    expect(dependencies.notebook).not.toHaveBeenCalled();
  });
  it('exports only saved student code, preserving public tests and provenance', async () => {
    const document = {
      nbformat: 4,
      metadata: { eduplus: { courseId: fixture.courseId, audience: 'student' } },
      cells: [
        { cell_type: 'markdown', source: '# lesson' },
        { cell_type: 'code', source: '# scaffold', outputs: [], execution_count: null },
        { cell_type: 'code', source: '# public tests' },
      ],
    };
    dependencies.notebook.mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify(document)).buffer,
    );
    const response = await exportNotebook(
      new Request('http://local/api?sceneType=guided-lab&source=draft'),
      context(),
    );
    expect(response.status).toBe(200);
    const notebook = await response.json();
    expect(notebook.cells[1].source).toContain('# student work');
    expect(notebook.cells[2].source).toBe('# public tests');
    expect(notebook.metadata.eduplus).toMatchObject({
      draftRevision: 2,
      codeSource: 'saved-student-draft',
      audience: 'student',
    });
    expect(dependencies.getDraft).toHaveBeenCalledWith(
      'authenticated-owner',
      fixture.courseId,
      fixture.scenes[0].sceneId,
    );
    expect(response.headers.get('content-disposition')).toContain('-draft.ipynb');
  });
  it('refuses unsaved drafts and does not call export', async () => {
    dependencies.getDraft.mockResolvedValueOnce({ revision: 0 });
    const response = await exportNotebook(new Request('http://local/api?source=draft'), context());
    expect(response.status).toBe(409);
    expect(dependencies.notebook).not.toHaveBeenCalled();
  });
});
