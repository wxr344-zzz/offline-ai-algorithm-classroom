import { z } from 'zod';
import { getEduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import { AgentAPIError } from '@/lib/server/eduplus-agent-client';
import { withEduplusOwner } from '@/lib/server/eduplus-route';
import { readEduplusJSON, requireSameOrigin } from '@/lib/server/eduplus-request';
import { computeReferenceOutput } from '@/lib/server/eduplus-reference-output';
import type { JsonValue } from '@/lib/types/eduplus.generated';

export const runtime = 'nodejs';

const schema = z
  .object({
    sceneId: z.string().min(1).max(128),
    problemVersion: z.number().int().positive().max(2147483647),
    inputs: z.record(z.string().max(64), z.unknown()),
  })
  .strict();

/**
 * The reference output for the learner's own input on a Lab page. Owner-scoped;
 * the reference solution runs in the WASM sandbox and only its output is sent.
 */
export async function POST(request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  return withEduplusOwner(request, async (ownerId, headers) => {
    requireSameOrigin(request);
    // Up to 12000 characters of standard input, which may be multi-byte.
    const body = schema.safeParse(await readEduplusJSON(request, 60000));
    if (!body.success || JSON.stringify(body.data.inputs).length > 20000)
      throw new AgentAPIError(400, 'INVALID_REQUEST', '自定义输入格式无效。');
    const reference = await (
      await getEduplusCourseStore()
    ).referenceForScene(ownerId, courseId, body.data.sceneId);
    if (!reference) throw new AgentAPIError(404, 'SCENE_NOT_FOUND', '实验页面不存在或无权访问。');
    if (reference.problem.problemVersion !== body.data.problemVersion)
      throw new AgentAPIError(409, 'PROBLEM_VERSION_MISMATCH', '题目已更新，请刷新页面后再试。');
    // Same parameter names as the problem's entry point (stdio problems take stdin).
    const names =
      reference.problem.executionMode === 'stdio'
        ? ['stdin']
        : reference.problem.entryPoint.parameters.map((p) => p.name);
    const keys = Object.keys(body.data.inputs);
    if (keys.length !== names.length || keys.some((k) => !names.includes(k)))
      throw new AgentAPIError(400, 'INVALID_REQUEST', `输入参数必须为：${names.join('、')}。`);
    const result = await computeReferenceOutput(
      { code: reference.code, key: `${courseId}:${body.data.sceneId}:${body.data.problemVersion}` },
      body.data.inputs as Record<string, JsonValue>,
      request.signal,
    );
    return Response.json(result, { headers });
  });
}
