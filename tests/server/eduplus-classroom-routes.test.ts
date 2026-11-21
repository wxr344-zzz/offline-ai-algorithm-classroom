import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/eduplus/courses/[courseId]/classroom/route';
import fixture from '@/contracts/examples/public-lab.json';
import teaching from '@/tests/fixtures/eduplus-teaching.json';
import { parseTeaching } from '@/lib/eduplus/classroom-contract';
import { nativeStageId } from '@/lib/eduplus/classroom-adapter';

const deps = vi.hoisted(() => ({
  get: vi.fn(),
  getClassroom: vi.fn(),
  teaching: vi.fn(),
  create: vi.fn(),
  tx: vi.fn(),
  documentStore: vi.fn(),
  load: vi.fn(),
}));
vi.mock('@/lib/persistence/eduplus-courses', () => ({
  getEduplusCourseStore: async () => ({ get: deps.get, getClassroom: deps.getClassroom }),
}));
vi.mock('@/lib/server/eduplus-agent-client', async (original) => ({
  ...(await original<typeof import('@/lib/server/eduplus-agent-client')>()),
  callTeachingCore: deps.teaching,
}));
vi.mock('@/lib/server/agent-runtime/owner-scoped-documents', () => ({
  getOwnerScopedDocumentStore: deps.documentStore,
}));
vi.mock('@/lib/server/identity/with-owner', () => ({
  withRequestOwner: async (
    _request: Request,
    body: (principal: { ownerId: string }, headers: Headers) => Promise<Response>,
  ) => body({ ownerId: 'owner-a' }, new Headers({ 'Set-Cookie': 'owner=test' })),
}));
const context = () => ({ params: Promise.resolve({ courseId: fixture.courseId }) });
beforeEach(() => {
  deps.get.mockReset().mockResolvedValue(fixture);
  deps.getClassroom.mockReset().mockResolvedValue(null);
  deps.teaching.mockReset().mockResolvedValue(parseTeaching(teaching));
  deps.tx.mockReset().mockResolvedValue({ rows: [{ course_id: fixture.courseId }] });
  deps.create
    .mockReset()
    .mockImplementation(async (_document, options) => options.inTransaction({ query: deps.tx }));
  deps.load.mockReset().mockResolvedValue({ stage: { id: 'existing' } });
  deps.documentStore
    .mockReset()
    .mockResolvedValue({ createDocument: deps.create, loadDocument: deps.load });
});
describe('atomic native classroom creation', () => {
  it('uses the actual principal and writes the mapping on the document transaction', async () => {
    const response = await POST(new Request('http://local/api', { method: 'POST' }), context());
    expect(response.status).toBe(201);
    expect((await response.json()).stageId).toBe(nativeStageId(fixture.courseId));
    expect(deps.documentStore).toHaveBeenCalledWith({ ownerId: 'owner-a' }, expect.any(Function));
    expect(deps.create.mock.calls[0][0].scenes).toHaveLength(6);
    const [sql, parameters] = deps.tx.mock.calls[0];
    expect(sql).toContain('classroom_data IS NULL');
    expect(parameters.slice(0, 2)).toEqual([fixture.courseId, 'owner-a']);
    expect(response.headers.get('set-cookie')).toContain('owner=test');
  });
  it('reuses an existing classroom without another model call', async () => {
    deps.getClassroom.mockResolvedValue({ stageId: 'existing', teaching });
    const response = await POST(new Request('http://local/api', { method: 'POST' }), context());
    expect(response.status).toBe(200);
    expect((await response.json()).stageId).toBe('existing');
    expect(deps.teaching).not.toHaveBeenCalled();
    expect(deps.create).not.toHaveBeenCalled();
  });
  it('refuses cross-site creation and other owners before consuming model capacity', async () => {
    const cross = await POST(
      new Request('http://local/api', {
        method: 'POST',
        headers: { Origin: 'https://other.test' },
      }),
      context(),
    );
    expect(cross.status).toBe(403);
    deps.get.mockResolvedValueOnce(null);
    expect(
      (await POST(new Request('http://local/api', { method: 'POST' }), context())).status,
    ).toBe(404);
    expect(deps.teaching).not.toHaveBeenCalled();
  });
  it('refuses reuse when the native classroom was removed without overwriting it', async () => {
    deps.getClassroom.mockResolvedValue({ stageId: 'existing', teaching });
    deps.load.mockResolvedValue(null);
    const response = await POST(new Request('http://local/api', { method: 'POST' }), context());
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('CLASSROOM_REMOVED');
    expect(deps.teaching).not.toHaveBeenCalled();
    expect(deps.create).not.toHaveBeenCalled();
  });
  it('throws on a lost mapping write so the native document transaction rolls back', async () => {
    deps.tx.mockResolvedValueOnce({ rows: [] });
    const response = await POST(new Request('http://local/api', { method: 'POST' }), context());
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('CLASSROOM_CONFLICT');
  });
  it('returns only stored public course and teaching assets', async () => {
    deps.getClassroom.mockResolvedValue({ stageId: 'existing', teaching });
    const response = await GET(new Request('http://local/api'), context());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.course).toEqual(fixture);
    expect(result.teaching).toEqual(teaching);
    expect(JSON.stringify(result)).not.toContain('hiddenTestCases');
  });
});
