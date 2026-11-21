import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), request: vi.fn() }));
vi.mock('@/lib/server/eduplus-route', () => ({
  withEduplusOwner: (
    _request: Request,
    handler: (owner: string, headers: Headers) => Promise<Response>,
  ) => handler('owner-a', new Headers()),
}));
vi.mock('@/lib/persistence/eduplus-courses', () => ({
  getEduplusCourseStore: async () => ({ getPrivateForTeacher: mocks.get }),
}));
vi.mock('@/lib/server/exam-simulator', () => ({ requestSimulation: mocks.request }));
import { POST } from '@/app/api/eduplus/simulations/trace/route';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ frames: [] });
});
const request = (body: unknown) =>
  new Request('http://localhost/api/eduplus/simulations/trace', {
    method: 'POST',
    body: JSON.stringify(body),
  });
it('replays only the owned course proof and never returns private source', async () => {
  const proof = {
    kind: 'independent-execution',
    program: { source: 'private source' },
    oracle: 'private checker',
    sourceHash: 'digest',
  };
  mocks.get.mockResolvedValue({
    topic: '自定义算法',
    problem: { pytest_source: '# executable-contract-verification: ' + JSON.stringify(proof) },
  });
  const response = await POST(
    request({ courseId: 'owned-course', topic: '自定义算法', input: { a: 1 } }),
  );
  expect(mocks.get).toHaveBeenCalledWith('owner-a', 'owned-course');
  expect(mocks.request.mock.calls[0][0]).toEqual({
    scope: 'owner-a',
    topic: '自定义算法',
    input: { a: 1 },
    proof,
  });
  expect(await response.text()).not.toContain('private source');
});
it('rejects another owner course, topic substitution and browser supplied proof', async () => {
  mocks.get.mockResolvedValue(null);
  await expect(
    POST(request({ courseId: 'other-course', topic: '自定义算法' })),
  ).rejects.toMatchObject({ status: 404 });
  mocks.get.mockResolvedValue({ topic: '原主题', problem: { pytest_source: '' } });
  await expect(
    POST(request({ courseId: 'owned-course', topic: '另一算法' })),
  ).rejects.toMatchObject({ status: 400 });
  await expect(POST(request({ topic: '原主题', proof: {} }))).rejects.toMatchObject({
    status: 400,
  });
  expect(mocks.request).not.toHaveBeenCalled();
});
