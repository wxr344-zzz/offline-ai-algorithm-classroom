import { AgentAPIError } from './eduplus-agent-client';
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') ?? new URL(request.url).host;
  let allowed = true;
  try {
    allowed = !origin || new URL(origin).host === host;
  } catch {
    allowed = false;
  }
  if (!allowed || request.headers.get('sec-fetch-site') === 'cross-site')
    throw new AgentAPIError(403, 'ORIGIN_REJECTED', '请从当前站点提交请求。');
}
export async function readEduplusJSON(request: Request, limit = 20000): Promise<unknown> {
  if (!request.body) throw new AgentAPIError(400, 'INVALID_REQUEST', '请求体不能为空。');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AgentAPIError(413, 'REQUEST_TOO_LARGE', '请求超出大小限制。');
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of chunks) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof AgentAPIError) throw error;
    throw new AgentAPIError(400, 'INVALID_REQUEST', '请求必须是有效的 JSON。');
  } finally {
    reader.releaseLock();
  }
}
