import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

import { POST } from '@/app/api/generate/route';
import fixture from '@/contracts/examples/public-lab.json';
import generatedFixture from '@/tests/fixtures/eduplus-generated.json';
import {
  callAgentCore,
  parsePublicCourse,
  parseGeneratedCourse,
} from '@/lib/server/eduplus-agent-client';

const persistence = vi.hoisted(() => ({ save: vi.fn(), get: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/persistence/eduplus-courses', () => ({
  getEduplusCourseStore: async () => persistence,
}));
vi.mock('@/lib/server/identity/with-owner', () => ({
  withRequestOwner: async (
    _request: Request,
    handler: (principal: { ownerId: string }, headers: Headers) => Promise<Response>,
  ) => handler({ ownerId: 'owner-test' }, new Headers({ 'Set-Cookie': 'owner=test; HttpOnly' })),
}));

function request(body: unknown) {
  return new Request('http://localhost/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv('EDUPLUS_AGENT_BASE_URL', 'http://127.0.0.1:8001');
  vi.stubEnv('EDUPLUS_AGENT_HTTP_TIMEOUT_MS', '630000');
  vi.stubEnv('EDUPLUS_AGENT_SERVICE_TOKEN', 'x'.repeat(64));
  persistence.save
    .mockReset()
    .mockImplementation(async (_owner, generated) => generated.publicCourse);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('EduPlus Next.js → Python bridge', () => {
  it('returns the real v1 contract with a trimmed prompt', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(generatedFixture));
    vi.stubGlobal('fetch', fetcher);
    const response = await POST(request({ prompt: ' 列表求和 ' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(parsePublicCourse(fixture));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Request-ID')).toBeTruthy();
    const [endpoint, options] = fetcher.mock.calls[0];
    expect(String(endpoint)).toBe('http://127.0.0.1:8001/internal/v1/generate');
    expect(options.headers.Authorization).toBe(`Bearer ${'x'.repeat(64)}`);
    expect(persistence.save).toHaveBeenCalledWith(
      'owner-test',
      parseGeneratedCourse(generatedFixture),
    );
    expect(JSON.parse(options.body)).toEqual({
      prompt: '列表求和',
      cache_namespace: `owner:${createHash('sha256').update('owner-test').digest('hex')}`,
    });
    expect(options.body).not.toContain('owner-test');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    {},
    { prompt: '' },
    { prompt: ' ' },
    { prompt: 7 },
    { prompt: 'x', extra: 'secret' },
    { prompt: 'x'.repeat(12001) },
  ])('rejects invalid requests before contacting Python: %j', async (body) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const response = await POST(
      new Request('http://localhost/api/generate', { method: 'POST', body: '{' }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_JSON');
  });

  it.each([
    [429, 'AGENT_BUSY'],
    [503, 'OLLAMA_UNAVAILABLE'],
    [503, 'OLLAMA_REPETITION'],
    [503, 'OLLAMA_GENERATION_ERROR'],
    [503, 'MODEL_NOT_FOUND'],
    [504, 'AGENT_TIMEOUT'],
    [502, 'GENERATION_FAILED'],
    [502, 'ALGORITHM_CONTRACT_FAILED'],
    [502, 'REFERENCE_EXECUTION_FAILED'],
    [500, 'INTERNAL_ERROR'],
  ])('maps %s/%s without exposing upstream details', async (status, code) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code, message: 'PRIVATE_TRACE' } },
            { status, headers: { 'X-Request-ID': 'upstream-1' } },
          ),
        ),
    );
    const response = await POST(request({ prompt: '实验' }));
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error.code).toBe(code);
    expect(body.error.requestId).toBe(response.headers.get('X-Request-ID'));
    expect(JSON.stringify(body)).not.toContain('PRIVATE_TRACE');
    if (status === 429) expect(response.headers.get('Retry-After')).toBe('5');
  });

  it('returns 503 if Python is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('PRIVATE_ADDRESS')));
    const response = await POST(request({ prompt: '实验' }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('AGENT_UNAVAILABLE');
  });

  it('rejects secret fields in Python response', async () => {
    const contaminated = structuredClone(fixture);
    Object.assign(contaminated.scenes[0], { referenceSolution: 'SECRET_ANSWER' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ...generatedFixture, publicCourse: contaminated })),
    );
    const response = await POST(request({ prompt: '实验' }));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('SECRET_ANSWER');
  });

  it('rejects inconsistent dual scenes', () => {
    const invalid = structuredClone(fixture);
    invalid.scenes[1].courseId = 'other-course';
    expect(() => parsePublicCourse(invalid)).toThrow('身份不一致');
  });

  it('supports a theory course with no scenes', () => {
    expect(parsePublicCourse({ ...fixture, requiresLab: false, scenes: [] }).scenes).toEqual([]);
  });

  it('bounds fetch time and distinguishes client cancellation', async () => {
    vi.useFakeTimers();
    vi.stubEnv('EDUPLUS_AGENT_HTTP_TIMEOUT_MS', '20');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            if (options.signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
            options.signal.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          }),
      ),
    );
    const timed = callAgentCore('实验').catch((error) => error);
    await vi.advanceTimersByTimeAsync(21);
    expect(await timed).toMatchObject({ status: 504, code: 'AGENT_TIMEOUT' });
    const controller = new AbortController();
    const cancelled = callAgentCore('实验', controller.signal).catch((error) => error);
    controller.abort();
    expect(await cancelled).toMatchObject({ status: 499, code: 'REQUEST_CANCELLED' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports invalid server configuration without fetching', async () => {
    vi.stubEnv('EDUPLUS_AGENT_BASE_URL', 'not-a-url');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(callAgentCore('实验')).rejects.toMatchObject({
      status: 500,
      code: 'AGENT_CONFIG_ERROR',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not report success if persistence fails', async () => {
    persistence.save.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_DETAIL'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(generatedFixture)));
    const response = await POST(request({ prompt: '实验' }));
    expect(response.status).toBe(500);
    expect(response.headers.get('Set-Cookie')).toContain('owner=test');
    expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_DATABASE_DETAIL');
  });
});
