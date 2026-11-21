import { z } from 'zod';
import { getEduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import { AgentAPIError } from '@/lib/server/eduplus-agent-client';
import { withEduplusOwner } from '@/lib/server/eduplus-route';

export const runtime = 'nodejs';
type Context = { params: Promise<{ courseId: string; sceneId: string }> };
const schema = z
  .object({
    problemVersion: z.number().int().positive().max(2147483647),
    code: z.string().max(100000),
    revision: z.number().int().nonnegative().max(2147483646),
  })
  .strict();

async function readBoundedJSON(request: Request): Promise<unknown> {
  const limit = 700000;
  if (Number(request.headers.get('content-length')) > limit)
    throw new AgentAPIError(413, 'REQUEST_TOO_LARGE', '请求超出大小限制。');
  if (!request.body) throw new AgentAPIError(400, 'INVALID_REQUEST', '请求体不能为空。');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AgentAPIError(413, 'REQUEST_TOO_LARGE', '请求超出大小限制。');
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof AgentAPIError) throw error;
    throw new AgentAPIError(400, 'INVALID_REQUEST', '请求必须是有效的 JSON。');
  } finally {
    reader.releaseLock();
  }
}

export async function GET(request: Request, context: Context) {
  const { courseId, sceneId } = await context.params;
  return withEduplusOwner(request, async (ownerId, headers) => {
    const result = await (await getEduplusCourseStore()).getDraft(ownerId, courseId, sceneId);
    return Response.json(result, { headers });
  });
}
export async function PUT(request: Request, context: Context) {
  const { courseId, sceneId } = await context.params;
  return withEduplusOwner(request, async (ownerId, headers) => {
    // Same-origin mutation; cookies alone must not permit cross-site writes.
    const origin = request.headers.get('origin');
    const host = request.headers.get('host') ?? new URL(request.url).host;
    let matchingOrigin = true;
    try {
      matchingOrigin = !origin || new URL(origin).host === host;
    } catch {
      matchingOrigin = false;
    }
    if (request.headers.get('sec-fetch-site') === 'cross-site' || !matchingOrigin)
      throw new AgentAPIError(403, 'ORIGIN_REJECTED', '请从当前站点保存草稿。');
    const body = await readBoundedJSON(request);
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new AgentAPIError(400, 'INVALID_REQUEST', '草稿代码、版本或修订号无效。');
    const result = await (
      await getEduplusCourseStore()
    ).saveDraft(ownerId, courseId, sceneId, parsed.data);
    return Response.json(result, { headers });
  });
}
