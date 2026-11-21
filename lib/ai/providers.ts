/**
 * Unified AI Provider Configuration
 *
 * Supports multiple AI providers through Vercel AI SDK:
 * - OpenAI (native)
 * - Anthropic Claude (native)
 * - Amazon Bedrock (native)
 * - Google Gemini (native)
 * - MiniMax (Anthropic-compatible, recommended by official)
 * - OpenAI-compatible providers (DeepSeek, Qwen, Kimi, GLM, SiliconFlow, Doubao, Tencent, Xiaomi, Lemonade, etc.)
 *
 * Sources:
 * - https://platform.openai.com/docs/models
 * - https://platform.claude.com/docs/en/about-claude/models/overview
 * - https://ai.google.dev/gemini-api/docs/models
 * - https://api-docs.deepseek.com/quick_start/pricing
 * - https://platform.moonshot.cn/docs/pricing/chat
 * - https://platform.minimaxi.com/docs/guides/text-generation
 * - https://platform.minimaxi.com/docs/api-reference/text-anthropic-api
 * - https://docs.bigmodel.cn/cn/guide/start/model-overview
 * - https://help.aliyun.com/zh/model-studio/models (Qwen/DashScope)
 * - https://siliconflow.cn/models
 * - https://siliconflow.cn/pricing
 * - https://www.volcengine.com/docs/82379/1330310
 * - https://platform.xiaomimimo.com/static/docs/pricing.md
 * - https://platform.xiaomimimo.com/static/docs/tokenplan/quick-access.md
 * - https://mimo.mi.com/static/docs/quick-start/summary/model.md
 * - https://mimo.mi.com/static/docs/api/chat/openai-api.md
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAzure } from '@ai-sdk/azure';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { wrapLanguageModel, extractReasoningMiddleware } from 'ai';
import {
  createReasoningPreservationMiddleware,
  restoreReasoningContentInRequestBody,
  stripReasoningContentInRequestBody,
  wrapJsonResponseWithReasoning,
  wrapResponseWithReasoning,
} from './reasoning-sse';
import type { LanguageModel } from 'ai';
import type {
  ProviderId,
  ProviderConfig,
  ModelInfo,
  ModelConfig,
  ThinkingConfig,
} from '@/lib/types/provider';
import { getCatalogThinkingCapability } from './model-metadata';
import { findModelById } from './model-aliases';
import {
  getDefaultThinkingConfig,
  getThinkingMode,
  pickThinkingBudget,
  pickThinkingEffort,
} from './thinking-config';
import { createLogger } from '@/lib/logger';
import { withAppAttributionInit } from '@/lib/config/app-attribution';
import { normalizeAzureBaseUrl } from './azure';
// NOTE: Do NOT import thinking-context.ts here — it uses node:async_hooks
// which is server-only, and this file is also used on the client via
// settings.ts. The thinking context is read from globalThis instead
// (set by thinking-context.ts at module load time on the server).

const log = createLogger('AIProviders');

// Re-export types for backward compatibility
export type { ProviderId, ProviderConfig, ModelInfo, ModelConfig };

/** Provider IDs whose logos are monochrome-dark and need `dark:invert` in dark mode */
import { PROVIDERS } from './provider-catalog';
export { PROVIDERS, MONO_LOGO_PROVIDERS } from './provider-catalog';

/**
 * Provider registry
 */

/**
 * Get provider config (from built-in or unified config in localStorage)
 */
function getProviderConfig(providerId: ProviderId): ProviderConfig | null {
  // Check built-in providers first
  if (PROVIDERS[providerId]) {
    return PROVIDERS[providerId];
  }

  // Check unified providersConfig in localStorage (browser only)
  if (typeof window !== 'undefined') {
    try {
      const storedConfig = localStorage.getItem('providersConfig');
      if (storedConfig) {
        const config = JSON.parse(storedConfig);
        const providerSettings = config[providerId];
        if (providerSettings) {
          return {
            id: providerId,
            name: providerSettings.name,
            type: providerSettings.type,
            defaultBaseUrl: providerSettings.defaultBaseUrl,
            icon: providerSettings.icon,
            requiresApiKey: providerSettings.requiresApiKey,
            models: providerSettings.models,
          };
        }
      }
    } catch (e) {
      log.error('Failed to load provider config:', e);
    }
  }

  return null;
}

/**
 * Model instance with its configuration info
 */
export interface ModelWithInfo {
  model: LanguageModel;
  modelInfo: ModelInfo | null;
}

/**
 * Whether the transport must keep a response's reasoning and send it back on
 * the next turn. Covers every model on DeepSeek's request adapter (deepseek and
 * the atlascloud deepseek models) plus Kimi K3, which each reject a multi-turn
 * request whose assistant messages drop the field. One predicate for both the
 * request-side gates below and the agent driver's includeReasoning gate, so the
 * two cannot drift apart again.
 */
export function preservesReasoning(providerId: string, modelId: string): boolean {
  if (providerId === 'kimi' && modelId === 'kimi-k3') return true;
  return getCatalogThinkingCapability(providerId, modelId)?.requestAdapter === 'deepseek';
}

/** {@link preservesReasoning} for the AI SDK model instance the driver holds. */
export function preservesReasoningForModel(model: LanguageModel | string): boolean {
  if (typeof model === 'string') return false;
  const provider = (model as { provider?: string }).provider;
  const modelId = (model as { modelId?: string }).modelId;
  if (!provider || !modelId) return false;
  const separator = provider.indexOf('.');
  const providerId = separator > 0 ? provider.slice(0, separator) : provider;
  return providerId in PROVIDERS && preservesReasoning(providerId, modelId);
}

function getCompatThinkingBodyParams(
  providerId: ProviderId,
  modelId: string,
  config: ThinkingConfig,
  options: { hasTools?: boolean } = {},
): { params: Record<string, unknown>; disablesThinking: boolean } | undefined {
  // This model is served through an OpenAI-compatible gateway even when the
  // deployment uses the `openai` provider slot. The gateway's chat template
  // toggle is neither OpenAI's `reasoning_effort` nor DeepSeek's native
  // `thinking` object: it requires this exact vLLM template argument.
  const mode = getThinkingMode(config);
  if (providerId === 'openai' && modelId === 'deepseek-v4-flash-vision-exp') {
    if (mode === undefined) return undefined;
    const gatewayThinkingEnabled = mode === 'enabled';
    return {
      params: { chat_template_kwargs: { thinking: gatewayThinkingEnabled } },
      disablesThinking: !gatewayThinkingEnabled,
    };
  }

  const capability = getCatalogThinkingCapability(providerId, modelId);
  if (!capability || capability.control === 'none') return undefined;

  const budget = pickThinkingBudget(capability, config);

  switch (capability.requestAdapter) {
    case 'openai': {
      const effort = pickThinkingEffort(capability, config);
      // An effort value never disables thinking on this transport.
      return effort ? { params: { reasoning_effort: effort }, disablesThinking: false } : undefined;
    }

    case 'kimi':
    case 'xiaomi':
      if (mode === 'disabled')
        return { params: { thinking: { type: 'disabled' } }, disablesThinking: true };
      if (mode === 'enabled')
        return { params: { thinking: { type: 'enabled' } }, disablesThinking: false };
      return undefined;

    case 'glm': {
      if (capability.control === 'effort') {
        if (mode === 'disabled' || config.effort === 'none') {
          // Forced-thinking models (GLM-5.3/5.3-Flash) reject
          // {type:'disabled'} ("该模型始终思考,不支持关闭思考"); use the
          // lightest effort instead of failing the whole request.
          if (capability.toggleable === false) {
            const lightest = capability.effortValues?.[0];
            return lightest
              ? {
                  params: { thinking: { type: 'enabled' }, reasoning_effort: lightest },
                  disablesThinking: false,
                }
              : undefined;
          }
          return { params: { thinking: { type: 'disabled' } }, disablesThinking: true };
        }

        const effort =
          config.effort && capability.effortValues?.includes(config.effort)
            ? config.effort
            : mode === 'enabled'
              ? capability.defaultEffort
              : undefined;
        const body: Record<string, unknown> = {};
        if (mode === 'enabled' || effort) body.thinking = { type: 'enabled' };
        if (effort) body.reasoning_effort = effort;
        return Object.keys(body).length > 0 ? { params: body, disablesThinking: false } : undefined;
      }
      if (mode === 'disabled')
        return { params: { thinking: { type: 'disabled' } }, disablesThinking: true };
      if (mode === 'enabled')
        return { params: { thinking: { type: 'enabled' } }, disablesThinking: false };
      return undefined;
    }

    case 'deepseek': {
      if (mode === 'disabled' || config.effort === 'none') {
        return { params: { thinking: { type: 'disabled' } }, disablesThinking: true };
      }
      // A tool-carrying request may never set reasoning_effort (the transport
      // rejects function tools combined with it), so the toggle goes alone;
      // every other request keeps the historical effort (explicit value, else
      // the default).
      if (options.hasTools) {
        return { params: { thinking: { type: 'enabled' } }, disablesThinking: false };
      }
      const effort = config.effort === 'max' || config.effort === 'xhigh' ? 'max' : 'high';
      return {
        params: {
          thinking: { type: 'enabled' },
          reasoning_effort: effort,
        },
        disablesThinking: false,
      };
    }

    case 'qwen': {
      if (mode === 'disabled')
        return { params: { enable_thinking: false }, disablesThinking: true };
      const body: Record<string, unknown> = {};
      if (mode === 'enabled') body.enable_thinking = true;
      if (budget !== undefined) body.thinking_budget = budget;
      return Object.keys(body).length > 0 ? { params: body, disablesThinking: false } : undefined;
    }

    case 'siliconflow': {
      const body: Record<string, unknown> = {};
      let disablesThinking = false;
      if (capability.control === 'toggle-budget') {
        if (mode === 'disabled') {
          body.enable_thinking = false;
          disablesThinking = true;
        }
        if (mode === 'enabled') body.enable_thinking = true;
      }
      if (budget !== undefined && budget > 0) body.thinking_budget = budget;
      return Object.keys(body).length > 0 ? { params: body, disablesThinking } : undefined;
    }

    case 'doubao': {
      if (capability.control === 'effort') {
        const effort =
          mode === 'disabled'
            ? 'minimal'
            : config.effort && capability.effortValues?.includes(config.effort)
              ? config.effort
              : mode === 'enabled'
                ? capability.defaultEffort
                : undefined;
        // 'minimal' is the floor below 'disabled': the model still reasons.
        return effort
          ? { params: { reasoning_effort: effort }, disablesThinking: false }
          : undefined;
      }
      if (mode === 'auto')
        return { params: { thinking: { type: 'auto' } }, disablesThinking: false };
      if (mode === 'disabled')
        return { params: { thinking: { type: 'disabled' } }, disablesThinking: true };
      if (mode === 'enabled')
        return { params: { thinking: { type: 'enabled' } }, disablesThinking: false };
      return undefined;
    }

    case 'openrouter': {
      const reasoning: Record<string, unknown> = {};
      if (mode === 'disabled') reasoning.enabled = false;
      if (mode === 'enabled') reasoning.enabled = true;
      if (config.effort) reasoning.effort = config.effort;
      if (budget !== undefined) reasoning.max_tokens = budget;
      if (typeof config.excludeReasoningOutput === 'boolean') {
        reasoning.exclude = config.excludeReasoningOutput;
      }
      return Object.keys(reasoning).length > 0
        ? { params: { reasoning }, disablesThinking: mode === 'disabled' }
        : undefined;
    }

    case 'hunyuan': {
      let reasoningEffort: 'no_think' | 'low' | 'high' | undefined;
      if (mode === 'disabled' || config.effort === 'none') {
        reasoningEffort = 'no_think';
      } else if (config.effort === 'high' || config.effort === 'max' || config.effort === 'xhigh') {
        reasoningEffort = 'high';
      } else if (
        config.effort === 'low' ||
        config.effort === 'medium' ||
        config.effort === 'minimal'
      ) {
        reasoningEffort = 'low';
      } else if (mode === 'enabled') {
        reasoningEffort = capability.defaultEffort === 'high' ? 'high' : 'low';
      }
      return reasoningEffort
        ? {
            params: { chat_template_kwargs: { reasoning_effort: reasoningEffort } },
            disablesThinking: reasoningEffort === 'no_think',
          }
        : undefined;
    }

    case 'lemonade': {
      const chatTemplateKwargs: Record<string, unknown> = {};
      const thinkingEnabled = mode === 'enabled';
      chatTemplateKwargs.enable_thinking = thinkingEnabled;
      if (thinkingEnabled && budget !== undefined) {
        chatTemplateKwargs.thinking_budget = budget;
      }
      return {
        params: { chat_template_kwargs: chatTemplateKwargs },
        disablesThinking: !thinkingEnabled,
      };
    }

    default:
      return undefined;
  }
}

function normalizeMiniMaxAnthropicBaseUrl(
  providerId: ProviderId,
  baseUrl?: string,
): string | undefined {
  if (providerId !== 'minimax' || !baseUrl) {
    return baseUrl;
  }

  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/anthropic/v1')) {
    return trimmed;
  }
  if (trimmed.endsWith('/anthropic')) {
    return `${trimmed}/v1`;
  }
  return `${trimmed}/anthropic/v1`;
}

function resolveBedrockRegion(): string {
  return (
    process.env.BEDROCK_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    'us-east-1'
  );
}

interface BedrockCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

type BedrockCredentialProvider = () => Promise<BedrockCredentials>;

let bedrockCredentialProviderPromise: Promise<BedrockCredentialProvider> | undefined;

function getBedrockCredentialProvider(): Promise<BedrockCredentialProvider> {
  bedrockCredentialProviderPromise ??= import('@aws-sdk/credential-providers').then(
    ({ fromNodeProviderChain }) => fromNodeProviderChain(),
  );
  return bedrockCredentialProviderPromise;
}

function createBedrockCredentialProvider(): BedrockCredentialProvider {
  return async () => {
    const credentialProvider = await getBedrockCredentialProvider();
    const credentials = await credentialProvider();
    return {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
      expiration: credentials.expiration,
    };
  };
}

function shouldUseOpenAIResponsesApi(providerId: ProviderId, modelId: string): boolean {
  if (providerId !== 'openai') return false;

  return (
    /^gpt-5\.\d+-pro(?:-|$)/.test(modelId) ||
    /^gpt-5\.6(?:-|$)/.test(modelId) ||
    /^gpt-5\.5(?:-|$)/.test(modelId) ||
    /^gpt-5\.[3-9]-codex(?:-|$)/.test(modelId)
  );
}

/**
 * A base URL reduced to the endpoint it addresses: origin plus path, with
 * trailing slashes dropped and any query string discarded. `undefined` when it
 * does not parse as a URL.
 */
function endpointKey(baseUrl: string): string | undefined {
  try {
    const url = new URL(baseUrl.trim());
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return undefined;
  }
}

function usesCustomOpenAIBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  const trimmed = baseUrl.trim();
  if (!trimmed) return false;

  const key = endpointKey(trimmed);
  // An unparseable URL counts as custom: the operator pointed this provider
  // somewhere, and that somewhere is not the OpenAI service.
  return key === undefined || key !== 'https://api.openai.com/v1';
}

/**
 * Whether `baseUrl` addresses a provider's own service rather than a relay.
 *
 * `usesCustomOpenAIBaseUrl` recognises OpenAI's origin alone, so every other
 * provider's native endpoint reads as "custom" to it. The distinction decides
 * whether the compat streaming path applies, and that path exists for RELAYS: a
 * relay is what carries an idle timeout to defeat, and a provider's own
 * endpoint is not.
 */
function isProviderNativeBaseUrl(providerId: ProviderId, baseUrl?: string): boolean {
  if (!baseUrl) return false;
  const nativeBaseUrl = PROVIDERS[providerId]?.defaultBaseUrl;
  if (!nativeBaseUrl) return false;
  const key = endpointKey(baseUrl);
  return key !== undefined && key === endpointKey(nativeBaseUrl);
}

function shouldUseOpenAIStreamingChatCompat(providerId: ProviderId, baseUrl?: string): boolean {
  return (
    // Grok behind a relay is the same shape as OpenAI behind one. A long
    // non-streaming generation sends nothing until the model has the whole
    // answer, so the relay's idle timeout cuts the connection (~5 min 504).
    // Streaming upstream keeps bytes flowing; the SSE is buffered back into a
    // normal JSON response for the caller.
    (providerId === 'openai' || providerId === 'grok') &&
    // ...but only for a relay. Grok's own api.x.ai is not one, and it reads as
    // custom to `usesCustomOpenAIBaseUrl`, which knows OpenAI's origin alone.
    !isProviderNativeBaseUrl(providerId, baseUrl) &&
    usesCustomOpenAIBaseUrl(baseUrl) &&
    process.env.OPENAI_COMPAT_USE_STREAMING_CHAT === 'true'
  );
}

function requestUrlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function appendChatDelta(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const record = part as Record<string, unknown>;
      return typeof record.text === 'string' ? record.text : '';
    })
    .join('');
}

function openAIJsonResponseHeaders(response: Response): Headers {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('transfer-encoding');
  return headers;
}

function openAIStreamErrorStatus(error: Record<string, unknown>): number {
  const status =
    typeof error.code === 'number'
      ? error.code
      : typeof error.code === 'string'
        ? Number(error.code)
        : NaN;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

/**
 * Non-streaming LLM completions only receive response headers once the whole
 * completion exists, and thinking models routinely think for more than five
 * minutes on a large prompt (observed: glm-5.2 at reasoning_effort=max on
 * scene generation). undici's default 300 s headers timeout turns that into
 * `Cannot connect to API: Headers Timeout Error` at exactly 300 s, before the
 * model ever answers. LLM-bound fetches attach this dispatcher instead, with
 * a budget that covers the slowest thinking model.
 */
export const LLM_FETCH_TIMEOUT_MS = 15 * 60 * 1000;

let llmDispatcherPromise: Promise<unknown> | undefined;
let warnedLlmDispatcherFailure = false;

function getLlmDispatcher(): Promise<unknown> {
  // `??=` caches whatever promise this produces — including a rejected one.
  // Drop the cache on failure so a single transient undici import (or Agent
  // construction) error can't brick every transportFetch call for the life
  // of the worker; the next call retries instead of reusing the rejection.
  llmDispatcherPromise ??= import(/* webpackIgnore: true */ 'undici')
    .then(
      ({ Agent }) =>
        new Agent({
          headersTimeout: LLM_FETCH_TIMEOUT_MS,
          bodyTimeout: LLM_FETCH_TIMEOUT_MS,
        }),
    )
    .catch((error: unknown) => {
      llmDispatcherPromise = undefined;
      throw error;
    });
  return llmDispatcherPromise;
}

async function fetchCustomOpenAIChat(
  input: RequestInfo | URL,
  init?: RequestInit,
  fetchImpl: typeof fetch = (fetchInput, fetchInit) => globalThis.fetch(fetchInput, fetchInit),
): Promise<Response> {
  const requestUrl = requestUrlString(input);
  if (!requestUrl.includes('/chat/completions') || !init?.body || typeof init.body !== 'string') {
    return fetchImpl(input, init);
  }

  let requestBody: Record<string, unknown>;
  try {
    requestBody = JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return fetchImpl(input, init);
  }

  if (requestBody.stream === true) return fetchImpl(input, init);

  const streamOptions =
    requestBody.stream_options &&
    typeof requestBody.stream_options === 'object' &&
    !Array.isArray(requestBody.stream_options)
      ? (requestBody.stream_options as Record<string, unknown>)
      : {};

  const response = await fetchImpl(input, {
    ...init,
    body: JSON.stringify({
      ...requestBody,
      stream: true,
      stream_options: { ...streamOptions, include_usage: true },
    }),
  });
  if (!response.ok) return response;

  const rawStream = await response.text();
  const streamLines = rawStream.split(/\r?\n/);
  if (!streamLines.some((line) => line.startsWith('data:'))) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.delete('transfer-encoding');
    return new Response(rawStream, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  let id = '';
  let created = 0;
  let model = typeof requestBody.model === 'string' ? requestBody.model : '';
  let content = '';
  let finishReason: unknown = null;
  let usage: unknown;
  const toolCalls = new Map<
    number,
    { id: string; type: string; function: { name: string; arguments: string } }
  >();

  for (const line of streamLines) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;

    try {
      const chunk = JSON.parse(data) as Record<string, unknown>;
      const error =
        chunk.error && typeof chunk.error === 'object' && !Array.isArray(chunk.error)
          ? (chunk.error as Record<string, unknown>)
          : undefined;
      if (error && typeof error.message === 'string') {
        return new Response(JSON.stringify(chunk), {
          status: openAIStreamErrorStatus(error),
          headers: openAIJsonResponseHeaders(response),
        });
      }

      if (typeof chunk.id === 'string') id = chunk.id;
      if (typeof chunk.created === 'number') created = chunk.created;
      if (typeof chunk.model === 'string') model = chunk.model;
      if (chunk.usage) usage = chunk.usage;

      const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
      for (const rawChoice of choices) {
        if (!rawChoice || typeof rawChoice !== 'object') continue;
        const choice = rawChoice as Record<string, unknown>;
        if (typeof choice.index === 'number' && choice.index !== 0) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        if (!choice.delta || typeof choice.delta !== 'object') continue;
        const delta = choice.delta as Record<string, unknown>;
        content += appendChatDelta(delta.content);

        if (!Array.isArray(delta.tool_calls)) continue;
        for (const rawToolCall of delta.tool_calls) {
          if (!rawToolCall || typeof rawToolCall !== 'object') continue;
          const toolCall = rawToolCall as Record<string, unknown>;
          const index = typeof toolCall.index === 'number' ? toolCall.index : 0;
          const current = toolCalls.get(index) || {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
          };
          if (typeof toolCall.id === 'string') current.id = toolCall.id;
          if (typeof toolCall.type === 'string') current.type = toolCall.type;
          if (toolCall.function && typeof toolCall.function === 'object') {
            const fn = toolCall.function as Record<string, unknown>;
            if (typeof fn.name === 'string' && fn.name) current.function.name = fn.name;
            if (typeof fn.arguments === 'string') current.function.arguments += fn.arguments;
          }
          toolCalls.set(index, current);
        }
      }
    } catch {
      // Ignore non-JSON SSE lines and continue collecting valid chunks.
    }
  }

  const message: Record<string, unknown> = { role: 'assistant', content };
  if (toolCalls.size > 0) {
    message.tool_calls = [...toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, toolCall]) => toolCall);
  }

  return new Response(
    JSON.stringify({
      id: id || `chatcmpl_${Date.now()}`,
      object: 'chat.completion',
      created: created || Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message, finish_reason: finishReason }],
      ...(usage ? { usage } : {}),
    }),
    {
      status: response.status,
      statusText: response.statusText,
      headers: openAIJsonResponseHeaders(response),
    },
  );
}

/** A request's headers without an `Authorization` that carries no credential (`Bearer `). */
export function withoutEmptyBearer(init: RequestInit | undefined): RequestInit | undefined {
  if (!init?.headers) return init;
  const headers = new Headers(init.headers);
  let empty = false;
  headers.forEach((value, name) => {
    if (name === 'authorization' && /^bearer\s*$/i.test(value)) empty = true;
  });
  if (!empty) return init;
  headers.delete('authorization');
  return { ...init, headers };
}

/** Returns true if the provider requires an API key (defaults to true for unknown providers). */
export function isProviderKeyRequired(providerId: string): boolean {
  return getProviderConfig(providerId as ProviderId)?.requiresApiKey ?? true;
}

/**
 * Get a configured language model instance with its info
 * Accepts individual parameters for flexibility and security
 */
export function getModel(config: ModelConfig): ModelWithInfo {
  // providerType can come from client for custom providers; fall back to registry.
  let providerType = config.providerType;
  const provider = getProviderConfig(config.providerId);
  const requiresApiKey = config.requiresApiKey ?? provider?.requiresApiKey ?? true;

  if (provider && providerType && providerType !== provider.type) {
    throw new Error(
      `Provider type mismatch for ${config.providerId}: expected ${provider.type}, received ${providerType}.`,
    );
  }

  if (!providerType) {
    if (provider) {
      providerType = provider.type;
    } else {
      throw new Error(`Unknown provider: ${config.providerId}. Please provide providerType.`);
    }
  }

  // Validate API key if required
  if (requiresApiKey && !config.apiKey) {
    throw new Error(`API key required for provider: ${config.providerId}`);
  }

  // Use provided API key, or empty string for providers that don't require one
  const effectiveApiKey = config.apiKey || '';

  // Resolve base URL: explicit > provider default > SDK default
  const effectiveBaseUrl = normalizeMiniMaxAnthropicBaseUrl(
    config.providerId,
    config.baseUrl || provider?.defaultBaseUrl || undefined,
  );

  // The outbound transport. resolveModel installs a redirect-validating fetch
  // here so every hop of a request to a client-supplied base URL is re-checked;
  // without one, requests go through the global fetch exactly as before
  // (resolved at call time, so tests that stub it keep working).
  const baseTransportFetch: typeof fetch =
    config.fetchImpl ?? ((fetchInput, fetchInit) => globalThis.fetch(fetchInput, fetchInit));
  // See LLM_FETCH_TIMEOUT_MS: every outbound LLM request — whatever transport
  // it ends up on — carries the extended-timeout dispatcher.
  const transportFetch: typeof fetch = async (fetchInput, fetchInit) => {
    // App attribution first: gateways that support it (TokenDance) receive
    // X-App-URL on every outbound request; every other provider is untouched.
    fetchInit = withAppAttributionInit(fetchInput, fetchInit);
    // Without a key (a local or self-hosted server) the SDK still sends an
    // empty bearer token: send no Authorization header instead.
    if (!effectiveApiKey) fetchInit = withoutEmptyBearer(fetchInit);
    // A caller-supplied dispatcher (config.fetchImpl may carry one) wins over
    // ours; only inject ours when the request doesn't already carry one.
    if ((fetchInit as (RequestInit & { dispatcher?: unknown }) | undefined)?.dispatcher) {
      return baseTransportFetch(fetchInput, fetchInit);
    }
    let dispatcher: unknown;
    try {
      dispatcher = await getLlmDispatcher();
      warnedLlmDispatcherFailure = false;
    } catch (error) {
      // No dispatcher still beats failing the call outright — the request
      // just rides undici's default 300 s cap, as it did before this seam.
      // Warn once per failure episode so a persistent failure (not just a
      // transient one) stays visible: this mitigation silently disengaging
      // looks exactly like the original 300 s incident.
      if (!warnedLlmDispatcherFailure) {
        warnedLlmDispatcherFailure = true;
        log.warn(
          '[LLM transport] dispatcher unavailable — requests fall back to undici defaults (300 s headers timeout):',
          error,
        );
      }
      return baseTransportFetch(fetchInput, fetchInit);
    }
    return baseTransportFetch(fetchInput, {
      ...fetchInit,
      dispatcher,
    } as RequestInit);
  };

  let model: LanguageModel;

  switch (providerType) {
    case 'azure': {
      const azureOptions: Parameters<typeof createAzure>[0] = {
        apiKey: effectiveApiKey,
        baseURL: normalizeAzureBaseUrl(effectiveBaseUrl),
      };
      azureOptions.fetch = transportFetch;
      const azure = createAzure(azureOptions);
      model = azure(config.modelId);
      break;
    }

    case 'openai': {
      const useStreamingChatCompat = shouldUseOpenAIStreamingChatCompat(
        config.providerId,
        effectiveBaseUrl,
      );
      const openaiOptions: Parameters<typeof createOpenAI>[0] = {
        apiKey: effectiveApiKey,
        baseURL: effectiveBaseUrl,
        name: config.providerId,
      };

      // A custom base URL makes the `openai` slot an OpenAI-compatible gateway,
      // not the native OpenAI service. Give it the same request/response seam
      // as named compatible providers: inject the gateway's thinking control
      // and recover reasoning_content before the SDK schema can discard it.
      const usesOpenAIResponses =
        !useStreamingChatCompat && shouldUseOpenAIResponsesApi(config.providerId, config.modelId);
      const usesCompatTransport =
        config.providerId !== 'openai' ||
        (usesCustomOpenAIBaseUrl(config.baseUrl) && !usesOpenAIResponses);
      const roundTripProvider = preservesReasoning(config.providerId, config.modelId);
      const deepseekAdapter =
        getCatalogThinkingCapability(config.providerId, config.modelId)?.requestAdapter ===
        'deepseek';
      if (usesCompatTransport) {
        const providerId = config.providerId;
        const compatFetch = async (url: RequestInfo | URL, init?: RequestInit) => {
          // Read thinking config from globalThis (set by thinking-context.ts)
          const thinkingCtx = (globalThis as Record<string, unknown>).__thinkingContext as
            | { getStore?: () => unknown }
            | undefined;
          const thinkingFromContext = thinkingCtx?.getStore?.() as ThinkingConfig | undefined;
          // Preserved-reasoning providers get the catalog default injected when
          // no caller supplied one, so the wire always states the thinking mode
          // explicitly instead of relying on the provider's server-side default
          // (which decides whether reasoning_content must round-trip at all).
          const thinking =
            thinkingFromContext ??
            (providerId === 'lemonade' || roundTripProvider
              ? getDefaultThinkingConfig(getCatalogThinkingCapability(providerId, config.modelId))
              : undefined);

          const hasRequestTools =
            !!init?.body &&
            typeof init.body === 'string' &&
            (() => {
              try {
                const tools = JSON.parse(init.body).tools;
                return Array.isArray(tools) && tools.length > 0;
              } catch {
                return false;
              }
            })();

          let thinkingDisabledOnWire = false;
          if (thinking && init?.body && typeof init.body === 'string') {
            const built = getCompatThinkingBodyParams(providerId, config.modelId, thinking, {
              hasTools: hasRequestTools,
            });
            if (built) {
              thinkingDisabledOnWire = built.disablesThinking;
              try {
                const body = JSON.parse(init.body);
                if (providerId === 'lemonade' && 'stream_options' in body) {
                  delete body.stream_options;
                }
                Object.assign(body, built.params);
                init = { ...init, body: JSON.stringify(body) };
              } catch {
                /* leave body as-is */
              }
            }
          }

          if (roundTripProvider && init?.body && typeof init.body === 'string') {
            try {
              const body = JSON.parse(init.body);
              if (thinkingDisabledOnWire) {
                stripReasoningContentInRequestBody(body);
              } else {
                restoreReasoningContentInRequestBody(body);
                if (deepseekAdapter) {
                  for (const message of body.messages ?? []) {
                    if (message?.role === 'assistant' && message.reasoning_content === undefined) {
                      message.reasoning_content = '';
                    }
                  }
                }
              }
              init = { ...init, body: JSON.stringify(body) };
            } catch {
              /* leave body as-is */
            }
          }
          const response = useStreamingChatCompat
            ? await fetchCustomOpenAIChat(url, init, transportFetch)
            : await transportFetch(url, init);

          // Recover reasoning that @ai-sdk/openai's chat schema drops: rewrite
          // streamed `reasoning_content` deltas into an inline <think> block
          // (the model below is wrapped with extractReasoningMiddleware to split
          // it back into first-class reasoning parts). No-op when absent.
          let streaming = false;
          if (init?.body && typeof init.body === 'string') {
            try {
              streaming = JSON.parse(init.body)?.stream === true;
            } catch {
              /* ignore request-body inspection failure */
            }
          }
          const normalizedReasoningResponse = streaming
            ? wrapResponseWithReasoning(response)
            : roundTripProvider
              ? await wrapJsonResponseWithReasoning(response)
              : response;

          if (providerId !== 'lemonade') {
            return normalizedReasoningResponse;
          }

          const contentType = response.headers.get('content-type') || '';
          let isStreamingRequest = false;
          if (init?.body && typeof init.body === 'string') {
            try {
              const requestBody = JSON.parse(init.body);
              isStreamingRequest = requestBody?.stream === true;
            } catch {
              /* ignore request-body inspection failure */
            }
          }

          if (isStreamingRequest) {
            return response;
          }

          try {
            const cloned = response.clone();
            const text = await cloned.text();

            try {
              JSON.parse(text);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              log.warn(
                `[Lemonade] Invalid JSON response from OpenAI-compatible path: status=${response.status}, contentType=${contentType || 'n/a'}, bodyLen=${text.length}, first=${JSON.stringify(text.slice(0, 500))}, last=${JSON.stringify(text.slice(Math.max(0, text.length - 500)))}, parseError=${message}`,
              );
            }
          } catch (error) {
            log.warn('[Lemonade] Failed to inspect JSON response body:', error);
          }

          return response;
        };
        openaiOptions.fetch = compatFetch as typeof globalThis.fetch;
      } else {
        // Native OpenAI / Responses transport: route requests through the
        // shared transport so they carry the extended-timeout dispatcher too.
        openaiOptions.fetch = transportFetch;
      }

      const openai = createOpenAI(openaiOptions);
      model = usesOpenAIResponses ? openai.responses(config.modelId) : openai.chat(config.modelId);
      // OpenAI-compatible providers (e.g. DeepSeek, Qwen), including a custom
      // gateway configured through the `openai` slot, stream reasoning
      // either as a separate `reasoning_content` field (normalized to an inline
      // <think> block by compatFetch) or as native inline <think>.
      // Split it into first-class reasoning parts so the agent stream and UI can
      // show a thinking panel and the answer text stays clean.
      if (usesCompatTransport) {
        const middleware = roundTripProvider
          ? [
              createReasoningPreservationMiddleware(),
              extractReasoningMiddleware({ tagName: 'think' }),
            ]
          : extractReasoningMiddleware({ tagName: 'think' });
        model = wrapLanguageModel({
          model,
          middleware,
        });
      }
      break;
    }

    case 'anthropic': {
      const anthropicOptions: Parameters<typeof createAnthropic>[0] = {
        baseURL: effectiveBaseUrl,
      };
      if (config.providerId === 'minimax' && effectiveApiKey.startsWith('sk-cp-')) {
        anthropicOptions.authToken = effectiveApiKey;
      } else {
        anthropicOptions.apiKey = effectiveApiKey;
      }
      if (config.providerId === 'minimax') {
        anthropicOptions.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
          const capability = getCatalogThinkingCapability(config.providerId, config.modelId);
          const thinkingCtx = (globalThis as Record<string, unknown>).__thinkingContext as
            | { getStore?: () => unknown }
            | undefined;
          const thinking = thinkingCtx?.getStore?.() as ThinkingConfig | undefined;

          if (
            capability?.requestAdapter === 'anthropic' &&
            capability.control !== 'none' &&
            getThinkingMode(thinking) === 'disabled' &&
            init?.body &&
            typeof init.body === 'string'
          ) {
            try {
              const body = JSON.parse(init.body);
              body.thinking = { type: 'disabled' };
              init = { ...init, body: JSON.stringify(body) };
            } catch {
              /* leave body as-is */
            }
          }

          return transportFetch(url, init);
        }) as typeof globalThis.fetch;
      } else {
        anthropicOptions.fetch = transportFetch;
      }

      const anthropic = createAnthropic(anthropicOptions);
      model = anthropic.chat(config.modelId);
      break;
    }

    case 'bedrock': {
      const bedrock = createAmazonBedrock({
        apiKey: effectiveApiKey || undefined,
        region: resolveBedrockRegion(),
        baseURL: effectiveBaseUrl,
        credentialProvider: createBedrockCredentialProvider(),
        fetch: transportFetch,
      });
      model = bedrock(config.modelId);
      break;
    }

    case 'google': {
      const googleOptions: Parameters<typeof createGoogleGenerativeAI>[0] = {
        apiKey: effectiveApiKey,
        baseURL: effectiveBaseUrl,
      };
      if (config.proxy) {
        const proxy = config.proxy;
        let agent: unknown;
        googleOptions.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const { ProxyAgent, fetch: undiciFetch } = (await import(
            /* webpackIgnore: true */ 'undici'
          )) as {
            ProxyAgent: new (options: { uri: string } & Record<string, unknown>) => unknown;
            fetch: (
              input: string | URL | Request,
              init?: Record<string, unknown>,
            ) => Promise<unknown>;
          };
          // Same budget as the direct dispatcher: proxied or not, this is an
          // LLM request whose headers may only arrive after minutes of thinking.
          // (http/https proxies only — undici's Socks5ProxyAgent drops these
          // options, so socks5:// proxies keep undici's default 300 s cap.)
          agent ??= new ProxyAgent({
            uri: proxy,
            headersTimeout: LLM_FETCH_TIMEOUT_MS,
            bodyTimeout: LLM_FETCH_TIMEOUT_MS,
          });
          const response = await undiciFetch(input, {
            ...(init as Record<string, unknown>),
            dispatcher: agent,
          });
          return response as Response;
        }) as typeof fetch;
      } else {
        googleOptions.fetch = transportFetch;
      }
      const google = createGoogleGenerativeAI(googleOptions);
      model = google.chat(config.modelId);
      break;
    }

    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }

  // Look up model info from the provider registry
  const modelInfo = findModelById(config.providerId, provider?.models, config.modelId) ?? null;

  return { model, modelInfo };
}

/**
 * Deprecation notice for bare model ids (no `provider:` prefix). parseModelString
 * keeps defaulting them to `openai` for backward compatibility, but that fallback
 * is deprecated: configs should write `provider:model` explicitly. Emitted only
 * by the boot-time config validation for config-derived sites — never for
 * request-derived strings, which would let clients drive log volume.
 */
export const BARE_MODEL_ID_DEPRECATION_MSG =
  'bare model ids default to openai for backward compatibility; this fallback is deprecated — write provider:model';

/** Bare model ids already surfaced, so the deprecation fires once per unique id. */
const warnedBareModelIds = new Set<string>();

/**
 * Warn once per unique bare model id. `where` names the config site (e.g.
 * `DEFAULT_MODEL`). Callers must pass only
 * config-derived ids (the config surface is finite, so the dedupe set is
 * bounded); request-derived strings must never reach this function.
 */
export function warnBareModelIdDeprecation(bareModelId: string, where?: string): boolean {
  if (warnedBareModelIds.has(bareModelId)) return false;
  warnedBareModelIds.add(bareModelId);
  const context = where ? `${where}: ` : '';
  console.warn(`[config] ${context}${BARE_MODEL_ID_DEPRECATION_MSG} (bare id "${bareModelId}")`);
  return true;
}

/**
 * Parse model string in format "providerId:modelId" or just "modelId" (defaults to OpenAI)
 */
export function parseModelString(modelString: string): {
  providerId: ProviderId;
  modelId: string;
} {
  // Split only on the first colon to handle model IDs that contain colons
  const colonIndex = modelString.indexOf(':');

  if (colonIndex > 0) {
    return {
      providerId: modelString.slice(0, colonIndex) as ProviderId,
      modelId: modelString.slice(colonIndex + 1),
    };
  }

  // Default to OpenAI for backward compatibility (deprecated; boot-time config
  // validation warns for config-derived bare ids). Deliberately no warning
  // here: this path is reachable with request-controlled strings, which must
  // not drive logging or dedupe-set growth.
  return {
    providerId: 'openai',
    modelId: modelString,
  };
}

/**
 * Get all available models grouped by provider
 */
export function getAllModels(): {
  provider: ProviderConfig;
  models: ModelInfo[];
}[] {
  return Object.values(PROVIDERS).map((provider) => ({
    provider,
    models: provider.models,
  }));
}

/**
 * Get provider by ID
 */
export function getProvider(providerId: ProviderId): ProviderConfig | undefined {
  return PROVIDERS[providerId];
}

/**
 * Get model info
 */
export function getModelInfo(providerId: ProviderId, modelId: string): ModelInfo | undefined {
  const provider = PROVIDERS[providerId];
  return findModelById(providerId, provider?.models, modelId);
}
