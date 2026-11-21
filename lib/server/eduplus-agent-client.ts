import { z } from 'zod';
import { Agent } from 'undici';
import { createHash } from 'node:crypto';
import { ensureLocalAgent } from './eduplus-local-agent';

import requestSchema from '@/contracts/eduplus-request.schema.json';
import responseSchema from '@/contracts/eduplus-public.schema.json';
import internalSchema from '@/contracts/eduplus-internal.schema.json';
import type { GeneratedCourse, FinalOutput } from '@/lib/server/eduplus-internal.generated';
import type { GenerateRequest, PublicCourse } from '@/lib/types/eduplus.generated';
import { parseTeaching } from '@/lib/eduplus/classroom-contract';
import type { ClassroomTeaching } from '@/lib/types/eduplus-teaching.generated';

// Agent generation can legitimately exceed undici's default header timeout.
// The explicit AbortSignal below owns the finite total request budget instead.
const generationDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
function generationRequest(init: RequestInit): RequestInit {
  return { ...init, dispatcher: generationDispatcher } as RequestInit;
}

// 直接消费 Python 生成的 Schema，避免两端手写契约发生漂移。
// JSON import 将 type 字段推断为 string；实际内容来自受回归检查的生成产物。
type JSONSchema = Parameters<typeof z.fromJSONSchema>[0];
const requestValidator = z.fromJSONSchema(requestSchema as unknown as JSONSchema);
const responseValidator = z.fromJSONSchema(responseSchema as unknown as JSONSchema);
const internalValidator = z.fromJSONSchema(internalSchema as unknown as JSONSchema);

export function parseGeneratedCourse(value: unknown): GeneratedCourse {
  const parsed = internalValidator.safeParse(value);
  if (!parsed.success)
    throw new AgentAPIError(502, 'INVALID_AGENT_RESPONSE', 'Agent 私有资产契约无效。');
  const generated = parsed.data as GeneratedCourse;
  const publicCourse = parsePublicCourse(generated.publicCourse);
  if (
    generated.privateOutput.course_id !== publicCourse.courseId ||
    generated.privateOutput.requires_lab !== publicCourse.requiresLab
  ) {
    throw new AgentAPIError(502, 'INVALID_AGENT_RESPONSE', 'Agent 公开与私有课程身份不一致。');
  }
  return generated;
}

export class AgentAPIError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly upstreamRequestId?: string,
  ) {
    super(message);
    this.name = 'AgentAPIError';
  }
}

export function parseGenerateRequest(value: unknown): GenerateRequest {
  const parsed = requestValidator.safeParse(value);
  if (!parsed.success) {
    throw new AgentAPIError(
      400,
      'INVALID_REQUEST',
      'prompt 必须是非空字符串，且不超过 12000 字符。',
    );
  }
  return { prompt: (parsed.data as GenerateRequest).prompt.trim() };
}

export function parsePublicCourse(value: unknown): PublicCourse {
  const parsed = responseValidator.safeParse(value);
  if (!parsed.success) {
    throw new AgentAPIError(502, 'INVALID_AGENT_RESPONSE', 'Agent 返回的数据不符合实验课程契约。');
  }
  const course = parsed.data as PublicCourse;
  const [guided, oj] = course.scenes;
  if (
    (!course.requiresLab && course.scenes.length !== 0) ||
    (course.requiresLab &&
      (course.scenes.length !== 2 ||
        guided.sceneType !== 'guided-lab' ||
        oj.sceneType !== 'oj-lab' ||
        guided.sceneId === oj.sceneId ||
        guided.courseId !== course.courseId ||
        oj.courseId !== course.courseId))
  ) {
    throw new AgentAPIError(502, 'INVALID_AGENT_RESPONSE', 'Agent 返回的双页题目身份不一致。');
  }
  return course;
}

async function requestGeneration(
  prompt: string,
  clientSignal?: AbortSignal,
  internal = false,
  cacheNamespace?: string,
): Promise<unknown> {
  let endpoint: URL;
  const timeout = Number(process.env.EDUPLUS_AGENT_HTTP_TIMEOUT_MS ?? '630000');
  try {
    endpoint = new URL(
      internal ? '/internal/v1/generate' : '/v1/generate',
      process.env.EDUPLUS_AGENT_BASE_URL ?? 'http://127.0.0.1:8001',
    );
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password
    ) {
      throw new Error('Invalid Agent URL');
    }
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 3600000) {
      throw new Error('Invalid timeout');
    }
  } catch {
    throw new AgentAPIError(500, 'AGENT_CONFIG_ERROR', 'Agent 服务地址或超时配置无效。');
  }

  const token = process.env.EDUPLUS_AGENT_SERVICE_TOKEN;
  if (internal && (!token || token.length < 32)) {
    throw new AgentAPIError(500, 'AGENT_CONFIG_ERROR', '内部服务凭据尚未配置。');
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  clientSignal?.addEventListener('abort', cancel, { once: true });
  if (clientSignal?.aborted) cancel();
  const timer = setTimeout(cancel, timeout);
  try {
    await ensureLocalAgent(endpoint);
    const response = await fetch(
      endpoint,
      generationRequest({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(internal ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt, ...(internal && cacheNamespace ? { cache_namespace: cacheNamespace } : {}) }),
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      }),
    );
    if (!response.ok) {
      const status = [400, 429, 500, 502, 503, 504].includes(response.status)
        ? response.status
        : 502;
      let code = 'AGENT_UPSTREAM_ERROR';
      let message = 'Agent 服务生成失败，请稍后重试。';
      // 只转发约定的错误；不将未知上游响应或堆栈回传给前端。
      const errors: Record<string, string> = {
        INVALID_REQUEST: '生成请求格式无效。',
        AGENT_BUSY: '本地模型正在生成其他课程，请稍后重试。',
        MODEL_NOT_FOUND: '本地模型尚未安装，请先拉取模型。',
        OLLAMA_UNAVAILABLE: '无法连接本地 Ollama，请确认服务已启动。',
        OLLAMA_REPETITION: '本地模型输出重复，自动调整生成策略后仍未完成，请重试。',
        OLLAMA_GENERATION_ERROR: '本地 Ollama 生成服务暂时异常，请稍后重试。',
        AGENT_TIMEOUT: '课程生成超时，请稍后重试。',
        GENERATION_FAILED:
          '本次实验数据经自动修复后仍未通过校验，可重试生成；无需修改正常的教学需求。',
        ALGORITHM_CONTRACT_FAILED:
          '算法实现尚未通过独立执行校验，可恢复当前生成步骤；无需修改正常的教学需求。',
        REFERENCE_EXECUTION_FAILED:
          '实验参考实现未通过沙箱执行断言，未发布无效题目；可恢复当前生成步骤。',
        INTERNAL_ERROR: 'Agent 服务执行失败，请通过请求 ID 查看服务端日志。',
      };
      try {
        const body: unknown = await response.json();
        const parsed = z.object({ error: z.object({ code: z.string() }) }).safeParse(body);
        if (parsed.success && Object.hasOwn(errors, parsed.data.error.code)) {
          code = parsed.data.error.code;
          message = errors[code];
        }
      } catch {
        // 非 JSON 上游错误仍使用受控信息。
      }
      throw new AgentAPIError(
        status,
        code,
        message,
        response.headers.get('X-Request-ID') ?? undefined,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AgentAPIError(502, 'INVALID_AGENT_RESPONSE', 'Agent 返回了无效的 JSON。');
    }
    return body;
  } catch (error) {
    if (clientSignal?.aborted) {
      throw new AgentAPIError(499, 'REQUEST_CANCELLED', '生成请求已取消。');
    }
    if (controller.signal.aborted) {
      throw new AgentAPIError(504, 'AGENT_TIMEOUT', 'Agent 服务请求超时，请稍后重试。');
    }
    if (error instanceof AgentAPIError) throw error;
    throw new AgentAPIError(
      503,
      'AGENT_UNAVAILABLE',
      '无法连接 Agent 服务，请确认 Python 服务已启动。',
    );
  } finally {
    clearTimeout(timer);
    clientSignal?.removeEventListener('abort', cancel);
  }
}

export async function callAgentCore(prompt: string, signal?: AbortSignal): Promise<PublicCourse> {
  return parsePublicCourse(await requestGeneration(prompt, signal));
}
export async function callTeachingCore(
  course: PublicCourse,
  signal?: AbortSignal,
): Promise<ClassroomTeaching> {
  const token = process.env.EDUPLUS_AGENT_SERVICE_TOKEN;
  if (!token || token.length < 32)
    throw new AgentAPIError(500, 'AGENT_CONFIG_ERROR', '内部服务凭据尚未配置。');
  try {
    const endpoint = new URL(
      '/internal/v1/teaching',
      process.env.EDUPLUS_AGENT_BASE_URL ?? 'http://127.0.0.1:8001',
    );
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
      throw new AgentAPIError(500, 'AGENT_CONFIG_ERROR', '内部服务地址无效。');
    await ensureLocalAgent(endpoint);
    const response = await fetch(
      endpoint,
      generationRequest({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(parsePublicCourse(course)),
        cache: 'no-store',
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(630000)])
          : AbortSignal.timeout(630000),
      }),
    );
    if (!response.ok)
      throw new AgentAPIError(
        [429, 503, 504].includes(response.status) ? response.status : 502,
        response.status === 429 ? 'AGENT_BUSY' : 'TEACHING_FAILED',
        '课堂补充内容生成失败，请检查本地模型后重试。',
      );
    try {
      return parseTeaching(await response.json());
    } catch {
      throw new AgentAPIError(502, 'INVALID_AGENT_RESPONSE', '课堂补充内容未通过校验。');
    }
  } catch (error) {
    if (error instanceof AgentAPIError) throw error;
    if (signal?.aborted) throw new AgentAPIError(499, 'REQUEST_CANCELLED', '请求已取消。');
    throw new AgentAPIError(503, 'AGENT_UNAVAILABLE', '无法连接课堂内容生成服务。');
  }
}
export async function callAgentForStorage(
  prompt: string,
  signal?: AbortSignal,
  ownerId?: string,
): Promise<GeneratedCourse> {
  const namespace = ownerId ? `owner:${createHash('sha256').update(ownerId).digest('hex')}` : undefined;
  return parseGeneratedCourse(await requestGeneration(prompt, signal, true, namespace));
}
export async function downloadStudentNotebook(
  course: PublicCourse,
  sceneType: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const token = process.env.EDUPLUS_AGENT_SERVICE_TOKEN;
  if (!token || token.length < 32)
    throw new AgentAPIError(500, 'AGENT_CONFIG_ERROR', '内部服务凭据尚未配置。');
  const endpoint = new URL(
    '/internal/v1/notebook',
    process.env.EDUPLUS_AGENT_BASE_URL ?? 'http://127.0.0.1:8001',
  );
  endpoint.searchParams.set('scene_type', sceneType);
  try {
    await ensureLocalAgent(endpoint);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(parsePublicCourse(course)),
      cache: 'no-store',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new AgentAPIError(502, 'EXPORT_FAILED', 'Notebook 导出失败。');
    const result = await response.arrayBuffer();
    const notebook = JSON.parse(new TextDecoder().decode(result));
    if (notebook.nbformat !== 4 || !Array.isArray(notebook.cells))
      throw new Error('Invalid notebook');
    return result;
  } catch (error) {
    if (error instanceof AgentAPIError) throw error;
    throw new AgentAPIError(503, 'EXPORT_UNAVAILABLE', 'Notebook 导出服务不可用。');
  }
}

export async function downloadTeacherNotebook(
  value: FinalOutput,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const token = process.env.EDUPLUS_AGENT_SERVICE_TOKEN;
  if (!token || token.length < 32)
    throw new AgentAPIError(500, 'AGENT_CONFIG_ERROR', '内部服务凭据尚未配置。');
  try {
    const endpoint = new URL(
      '/internal/v1/teacher-notebook',
      process.env.EDUPLUS_AGENT_BASE_URL ?? 'http://127.0.0.1:8001',
    );
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
      throw new AgentAPIError(500, 'AGENT_CONFIG_ERROR', '内部服务地址无效。');
    await ensureLocalAgent(endpoint);
    const response = await fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(value),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    });
    if (!response.ok) throw new AgentAPIError(502, 'EXPORT_FAILED', '教师 Notebook 导出失败。');
    const bytes = await response.arrayBuffer();
    const document = JSON.parse(new TextDecoder().decode(bytes));
    if (document.nbformat !== 4 || document.metadata?.eduplus?.audience !== 'teacher')
      throw new Error('Invalid teacher notebook');
    return bytes;
  } catch (error) {
    if (error instanceof AgentAPIError) throw error;
    throw new AgentAPIError(503, 'EXPORT_UNAVAILABLE', '教师导出服务不可用。');
  }
}
