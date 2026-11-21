import { randomUUID } from 'node:crypto';
import { AgentAPIError } from '@/lib/server/eduplus-agent-client';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';
import type { OwnerPrincipal } from '@/lib/server/identity/types';

export function withEduplusOwner(
  request: Request,
  handler: (ownerId: string, headers: Headers, principal: OwnerPrincipal) => Promise<Response>,
): Promise<Response> {
  return withRequestOwner(request, async (principal, headers) => {
    const requestId = randomUUID();
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Request-ID', requestId);
    try {
      return await handler(principal.ownerId, headers, principal);
    } catch (error) {
      const ownerFailure = ownerWriteErrorResponse(error, headers);
      if (ownerFailure) return ownerFailure;
      const failure =
        error instanceof AgentAPIError
          ? error
          : new AgentAPIError(503, 'PERSISTENCE_UNAVAILABLE', '课程读取或导出失败，请稍后重试。');
      console.error('[eduplus]', { requestId, code: failure.code });
      return Response.json(
        { error: { code: failure.code, message: failure.message, requestId } },
        { status: failure.status, headers },
      );
    }
  });
}
