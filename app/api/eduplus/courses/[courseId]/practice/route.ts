import { z } from 'zod';
import { getEduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import { AgentAPIError } from '@/lib/server/eduplus-agent-client';
import { withEduplusOwner } from '@/lib/server/eduplus-route';
import { readEduplusJSON, requireSameOrigin } from '@/lib/server/eduplus-request';

export const runtime = 'nodejs';
const schema = z
  .object({
    eventId: z.string().uuid(),
    sceneId: z.string().min(1).max(128),
    problemVersion: z.number().int().positive().max(2147483647),
    status: z.enum(['completed', 'stopped', 'error']),
    passed: z.number().int().nonnegative().max(1000),
    total: z.number().int().nonnegative().max(1000),
    draftRevision: z.number().int().positive().max(2147483647).nullable(),
    message: z.string().max(1000),
  })
  .strict();
export async function POST(request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  return withEduplusOwner(request, async (ownerId, headers) => {
    requireSameOrigin(request);
    const body = schema.safeParse(await readEduplusJSON(request));
    if (!body.success) throw new AgentAPIError(400, 'INVALID_REQUEST', '练习记录格式无效。');
    await (await getEduplusCourseStore()).recordPractice(ownerId, courseId, body.data);
    return Response.json(
      { recorded: true, source: 'browser-practice', authoritative: false },
      { status: 201, headers },
    );
  });
}
