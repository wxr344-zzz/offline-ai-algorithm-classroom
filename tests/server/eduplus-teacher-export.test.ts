import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/eduplus/courses/[courseId]/teacher-notebook/route';
import generated from '@/tests/fixtures/eduplus-generated.json';
import type { OwnerPrincipal } from '@/lib/server/identity/types';
const deps = vi.hoisted(() => ({
  private: vi.fn(),
  download: vi.fn(),
  principal: null as unknown as OwnerPrincipal,
}));
vi.mock('@/lib/persistence/eduplus-courses', () => ({
  getEduplusCourseStore: async () => ({ getPrivateForTeacher: deps.private }),
}));
vi.mock('@/lib/server/eduplus-agent-client', async (original) => ({
  ...(await original<typeof import('@/lib/server/eduplus-agent-client')>()),
  downloadTeacherNotebook: deps.download,
}));
vi.mock('@/lib/server/identity/with-owner', () => ({
  withRequestOwner: async (
    _request: Request,
    body: (principal: OwnerPrincipal, headers: Headers) => Promise<Response>,
  ) => body(deps.principal, new Headers()),
}));
const context = () => ({ params: Promise.resolve({ courseId: generated.publicCourse.courseId }) });
beforeEach(() => {
  deps.principal = {
    ownerId: 'owner-a',
    kind: 'user',
    assurance: 'verified',
    channel: 'host',
    roles: new Set(['eduplus:teacher']),
  };
  deps.private.mockReset().mockResolvedValue(generated.privateOutput);
  deps.download.mockReset().mockResolvedValue(new TextEncoder().encode('{"nbformat":4}').buffer);
});
describe('teacher export authorization', () => {
  it('requires a verified role before any private database read', async () => {
    deps.principal = { ...deps.principal, roles: new Set(), assurance: 'minted' };
    const response = await GET(new Request('http://local/api?role=eduplus:teacher'), context());
    expect(response.status).toBe(403);
    expect(deps.private).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
  });
  it('does not accept a teacher role with unverified assurance', async () => {
    deps.principal = { ...deps.principal, assurance: 'unverified-legacy' };
    expect((await GET(new Request('http://local/api'), context())).status).toBe(403);
    expect(deps.private).not.toHaveBeenCalled();
  });
  it('keeps course ownership binding even for authenticated teachers', async () => {
    deps.private.mockResolvedValueOnce(null);
    expect((await GET(new Request('http://local/api'), context())).status).toBe(404);
    expect(deps.private).toHaveBeenCalledWith('owner-a', generated.publicCourse.courseId);
    expect(deps.download).not.toHaveBeenCalled();
  });
  it('returns a teacher attachment only after both checks pass', async () => {
    const response = await GET(new Request('http://local/api'), context());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('eduplus-teacher.ipynb');
    expect(deps.download).toHaveBeenCalledWith(generated.privateOutput, expect.any(AbortSignal));
  });
});
