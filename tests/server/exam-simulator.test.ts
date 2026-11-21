import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestSimulation } from '@/lib/server/exam-simulator';
const ensure = vi.hoisted(() => vi.fn());
vi.mock('@/lib/server/eduplus-local-agent', () => ({ ensureLocalAgent: ensure }));
beforeEach(() => {
  vi.stubEnv('EDUPLUS_AGENT_SERVICE_TOKEN', 'fixed-test-service-token-longer-than-32-characters');
  vi.stubEnv('EDUPLUS_AGENT_BASE_URL', 'http://127.0.0.1:8001');
  ensure.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe('Python simulator bridge', () => {
  it('uses fixed authenticated endpoints, without sending source code', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ profiles: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await requestSimulation();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.pathname).toBe('/internal/v1/simulations');
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe('no-store');
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    const input = {
      algorithm: 'complete-knapsack',
      input: { weights: [2], values: [3], capacity: 6 },
    };
    await requestSimulation(input);
    expect(fetchMock.mock.calls[1][0].pathname).toBe('/internal/v1/simulations/trace');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(input);
  });
  it('retains algorithm input errors rather than displaying a fabricated trace', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'INVALID_SIMULATION_INPUT', message: '边权必须非负' } },
            { status: 400 },
          ),
        ),
    );
    await expect(requestSimulation({ algorithm: 'dijkstra' })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_SIMULATION_INPUT',
      message: '边权必须非负',
    });
  });
});
