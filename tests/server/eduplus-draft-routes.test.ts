import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, PUT } from '@/app/api/eduplus/courses/[courseId]/drafts/[sceneId]/route';
import { GET as getRuntime } from '@/app/api/eduplus/runtime/route';
import { AgentAPIError } from '@/lib/server/eduplus-agent-client';
const store = vi.hoisted(() => ({ getDraft: vi.fn(), saveDraft: vi.fn() }));
vi.mock('@/lib/persistence/eduplus-courses', () => ({ getEduplusCourseStore: async () => store }));
vi.mock('@/lib/server/identity/with-owner', () => ({
  withRequestOwner: async (
    _request: Request,
    body: (principal: { ownerId: string }, headers: Headers) => Promise<Response>,
  ) => body({ ownerId: 'resolved-owner' }, new Headers({ 'Set-Cookie': 'owner=test' })),
}));
const context = () => ({ params: Promise.resolve({ courseId: 'course', sceneId: 'scene' }) });
const draft = { sceneId: 'scene', code: '# code', problemVersion: 1, revision: 0, updatedAt: null };
const body = { code: '# next', problemVersion: 1, revision: 0 };
function request(data: unknown = body, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api', {
    method: 'PUT',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
beforeEach(() => {
  store.getDraft.mockReset().mockResolvedValue(draft);
  store.saveDraft.mockReset().mockResolvedValue({ ...draft, revision: 1 });
});
describe('draft APIs and isolated runtime delivery', () => {
  it('uses server identity for both reading and saving and keeps owner cookies', async () => {
    expect(
      (await GET(new Request('http://localhost:3000/api?ownerId=other'), context())).status,
    ).toBe(200);
    const response = await PUT(request(), context());
    expect(response.status).toBe(200);
    expect(store.getDraft).toHaveBeenCalledWith('resolved-owner', 'course', 'scene');
    expect(store.saveDraft).toHaveBeenCalledWith('resolved-owner', 'course', 'scene', body);
    expect(response.headers.get('set-cookie')).toContain('owner=test');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('accepts the actual local Host when Next internally normalizes the URL to localhost', async () => {
    expect(
      (
        await PUT(
          request(body, { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000' }),
          context(),
        )
      ).status,
    ).toBe(200);
  });
  it.each(['https://other.example', 'null', 'bad origin'])(
    'rejects cross-origin/malformed mutation origins (%s)',
    async (origin) => {
      expect((await PUT(request(body, { Origin: origin }), context())).status).toBe(403);
      expect(store.saveDraft).not.toHaveBeenCalled();
    },
  );
  it('rejects invalid shapes, extra owner fields, and non-JSON bodies', async () => {
    for (const invalid of [
      { ...body, revision: -1 },
      { ...body, ownerId: 'attacker' },
      { ...body, code: 42 },
    ])
      expect((await PUT(request(invalid), context())).status).toBe(400);
    const malformed = new Request('http://localhost:3000/api', { method: 'PUT', body: '{invalid' });
    expect((await PUT(malformed, context())).status).toBe(400);
    expect(store.saveDraft).not.toHaveBeenCalled();
  });
  it('preserves controlled CAS conflict errors', async () => {
    store.saveDraft.mockRejectedValue(new AgentAPIError(409, 'DRAFT_CONFLICT', 'conflict'));
    const response = await PUT(request(), context());
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('DRAFT_CONFLICT');
  });
  it('bounds bodies even when Content-Length is absent', async () => {
    expect((await PUT(request({ ...body, code: 'x'.repeat(800000) }), context())).status).toBe(413);
    expect(store.saveDraft).not.toHaveBeenCalled();
  });
  it('restricts sandbox traffic to the runtime assets and uses a nonce', async () => {
    const response = await getRuntime(new Request('http://localhost:3000/api/eduplus/runtime'));
    const csp = response.headers.get('content-security-policy')!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(
      'connect-src http://localhost:3000/vendor/eduplus/pyodide/ http://localhost:3000/eduplus-runtime/worker.js',
    );
    expect(csp).not.toContain("connect-src 'self'");
    expect(csp).toMatch(/script-src 'nonce-[^']+'/);
    const html = await response.text();
    expect(html).toContain('event.source !== parent');
    expect(html).toContain("credentials: 'omit'");
    expect(html).not.toContain('document.getElementById');
  });
});
