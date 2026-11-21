import { z } from 'zod';
import { withEduplusOwner } from '@/lib/server/eduplus-route';
import { requestSimulation } from '@/lib/server/exam-simulator';
import { AgentAPIError } from '@/lib/server/eduplus-agent-client';
import { getEduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import { localizeTraceDisplay } from '@/lib/server/trace-display';
import { teachingModelCall } from '@/lib/server/lab-display-model';
import type { SimulationTrace } from '@/lib/eduplus/simulation-contract';
export const runtime = 'nodejs';
const schema = z
  .object({
    algorithm: z.string().max(100).optional(),
    topic: z.string().max(2000).optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    courseId: z.string().min(1).max(100).optional(),
    /** Language of the teaching text (labels, explanations); never changes the execution. */
    lang: z
      .string()
      .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
      .max(20)
      .optional(),
  })
  .strict();
export function POST(request: Request) {
  return withEduplusOwner(request, async (owner, headers) => {
    const text = await request.text();
    if (text.length > 24000) throw new AgentAPIError(413, 'INPUT_TOO_LARGE', '教学输入超过24KB。');
    let body;
    try {
      body = schema.parse(JSON.parse(text));
    } catch {
      throw new AgentAPIError(400, 'INVALID_INPUT', '请输入合法的算法编号与 JSON 输入对象。');
    }
    const { courseId, ...parameters } = body;
    let proof: unknown;
    if (courseId) {
      const course = await (await getEduplusCourseStore()).getPrivateForTeacher(owner, courseId);
      if (!course) throw new AgentAPIError(404, 'COURSE_NOT_FOUND', '课程不存在或无权访问。');
      if (parameters.topic?.trim() !== course.topic.trim())
        throw new AgentAPIError(400, 'TOPIC_MISMATCH', '算法主题与当前课程不匹配。');
      const saved = course.problem?.pytest_source
        .split('\n')
        .find((line) => line.startsWith('# executable-contract-verification: '));
      if (saved) {
        try {
          const parsed = JSON.parse(saved.slice('# executable-contract-verification: '.length));
          if (parsed.kind === 'independent-execution') proof = parsed;
        } catch {
          throw new AgentAPIError(
            502,
            'INVALID_EXECUTION_PROOF',
            '课程执行契约损坏，不能重新猜测实现。',
          );
        }
      }
    }
    const trace = await requestSimulation(
      { ...parameters, ...(proof ? { proof } : {}), scope: owner },
      request.signal,
    );
    if (!trace || typeof trace !== 'object' || !('frames' in trace) || !Array.isArray(trace.frames))
      throw new AgentAPIError(502, 'INVALID_SIMULATION_TRACE', 'Invalid execution trace');
    return Response.json(
      await localizeTraceDisplay(
        trace as SimulationTrace,
        parameters.lang,
        owner,
        teachingModelCall(owner, request.signal),
      ),
      {
        headers,
      },
    );
  });
}
