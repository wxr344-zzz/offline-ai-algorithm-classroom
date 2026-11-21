import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import {
  AgentAPIError,
  callAgentForStorage,
  parseGenerateRequest,
} from '@/lib/server/eduplus-agent-client';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getEduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';

export const runtime = 'nodejs';
export const maxDuration = 660;

export async function POST(request: Request) {
  return withRequestOwner(request, async (principal, ownerHeaders) => {
    const requestId = randomUUID();
    const headers = new Headers(ownerHeaders);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Request-ID', requestId);
    try {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new AgentAPIError(400, 'INVALID_JSON', '请求体必须是有效的 JSON。');
      }
      const { prompt } = parseGenerateRequest(body);
      const store = await getEduplusCourseStore();
      const generated = await callAgentForStorage(prompt, request.signal, principal.ownerId);
      const result = await store.save(principal.ownerId, generated);
      return NextResponse.json(result, { status: 200, headers });
    } catch (error: unknown) {
      const ownerError = ownerWriteErrorResponse(error, headers);
      if (ownerError) return ownerError;
      const failure =
        error instanceof AgentAPIError
          ? error
          : new AgentAPIError(
              500,
              'INTERNAL_ERROR',
              '课程生成失败，请通过请求 ID 查看服务端日志。',
            );
      if (failure.status >= 500) {
        console.error('[api/generate]', {
          requestId,
          code: failure.code,
          upstreamRequestId: failure.upstreamRequestId,
        });
      }
      if (failure.status === 429) headers.set('Retry-After', '5');
      return NextResponse.json(
        { error: { code: failure.code, message: failure.message, requestId } },
        { status: failure.status, headers },
      );
    }
  });
}
