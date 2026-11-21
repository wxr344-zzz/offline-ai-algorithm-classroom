import { AgentAPIError } from './eduplus-agent-client';
import { ensureLocalAgent } from './eduplus-local-agent';

/** Source generation stays in the authenticated service; only WASM executes generated code. */
export async function requestSimulation(
  body?: unknown,
  signal?: AbortSignal,
  /** Catalog listing only: language of the algorithm titles. */
  lang?: string,
): Promise<unknown> {
  const token = process.env.EDUPLUS_AGENT_SERVICE_TOKEN;
  if (!token || token.length < 32)
    throw new AgentAPIError(500, 'AGENT_CONFIG_ERROR', '内部服务凭据尚未配置。');
  const endpoint = new URL(
    body === undefined ? '/internal/v1/simulations' : '/internal/v1/simulations/trace',
    process.env.EDUPLUS_AGENT_BASE_URL ?? 'http://127.0.0.1:8001',
  );
  if (body === undefined && lang) endpoint.searchParams.set('lang', lang);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
    throw new AgentAPIError(500, 'AGENT_CONFIG_ERROR', '内部服务地址无效。');
  try {
    await ensureLocalAgent(endpoint);
    const res = await fetch(endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(body === undefined ? 30000 : 310000)])
        : AbortSignal.timeout(body === undefined ? 30000 : 310000),
    });
    const result = await res.json();
    if (!res.ok)
      throw new AgentAPIError(
        res.status,
        result.error?.code ?? 'SIMULATION_ERROR',
        result.error?.message ?? '推演请求未通过校验。',
      );
    return result;
  } catch (e) {
    if (e instanceof AgentAPIError) throw e;
    throw new AgentAPIError(503, 'SIMULATION_UNAVAILABLE', '确定性推演服务暂不可用，请重试。');
  }
}
