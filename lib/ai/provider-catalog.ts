// Browser-safe provider metadata; SDK transport is in providers.ts.
import type { ProviderId, ProviderConfig } from '@/lib/types/provider';
export type { ProviderId, ProviderConfig, ModelInfo, ModelConfig } from '@/lib/types/provider';
import { applyModelMetadata } from './model-metadata';

export const MONO_LOGO_PROVIDERS: ReadonlySet<string> = new Set(['openai', 'openrouter', 'ollama']);

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    icon: '/logos/openai.svg',
    models: [
      {
        id: 'gpt-5.6',
        name: 'GPT-5.6 Sol',
        contextWindow: 1050000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'gpt-5.6-terra',
        name: 'GPT-5.6 Terra',
        contextWindow: 1050000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'gpt-5.6-luna',
        name: 'GPT-5.6 Luna',
        contextWindow: 1050000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        contextWindow: 1050000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'gpt-5.4-pro',
        name: 'GPT-5.4 Pro',
        contextWindow: 1050000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        contextWindow: 1050000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'gpt-5.4-mini',
        name: 'GPT-5.4 Mini',
        contextWindow: 400000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'gpt-5.4-nano',
        name: 'GPT-5.4 Nano',
        contextWindow: 400000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
    ],
  },

  azure: {
    id: 'azure',
    name: 'Azure OpenAI',
    type: 'azure',
    baseUrlPlaceholder: 'https://YOUR-RESOURCE.openai.azure.com/openai',
    supportsModelDiscovery: false,
    requiresApiKey: true,
    icon: '/logos/azure.svg',
    // Azure requests use user-defined deployment names rather than model IDs.
    models: [],
  },

  atlascloud: {
    id: 'atlascloud',
    name: 'Atlas Cloud',
    type: 'openai',
    defaultBaseUrl: 'https://api.atlascloud.ai/v1',
    supportsModelDiscovery: true,
    requiresApiKey: true,
    models: [
      {
        id: 'qwen/qwen3.5-flash',
        name: 'Qwen3.5 Flash',
        contextWindow: 1000000,
        outputWindow: 67072,
        capabilities: { streaming: true, tools: false, vision: false },
      },
      {
        id: 'deepseek-ai/deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        contextWindow: 1048576,
        outputWindow: 393216,
        // Live-verified with enabled/disabled thinking payloads and a forced
        // OpenAI-compatible function call against Atlas Cloud.
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
    ],
  },

  anthropic: {
    id: 'anthropic',
    name: 'Claude',
    type: 'anthropic',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    icon: '/logos/claude.svg',
    models: [
      {
        id: 'claude-opus-5',
        name: 'Claude Opus 5',
        contextWindow: 1000000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'claude-sonnet-5',
        name: 'Claude Sonnet 5',
        contextWindow: 1000000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'claude-fable-5',
        name: 'Claude Fable 5',
        contextWindow: 1000000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'claude-opus-4-8',
        name: 'Claude Opus 4.8',
        contextWindow: 1000000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'claude-opus-4-7',
        name: 'Claude Opus 4.7',
        contextWindow: 1000000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        contextWindow: 200000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        contextWindow: 200000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        contextWindow: 200000,
        outputWindow: 64000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        contextWindow: 200000,
        outputWindow: 64000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
    ],
  },

  bedrock: {
    id: 'bedrock',
    name: 'Amazon Bedrock',
    type: 'bedrock',
    requiresApiKey: false,
    icon: '/logos/bedrock.svg',
    models: [
      {
        id: 'us.anthropic.claude-sonnet-5',
        name: 'Claude Sonnet 5 (Bedrock)',
        contextWindow: 1000000,
        outputWindow: 128000,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'us.anthropic.claude-opus-4-8',
        name: 'Claude Opus 4.8 (Bedrock)',
        contextWindow: 1000000,
        outputWindow: 128000,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'us.anthropic.claude-opus-4-7',
        name: 'Claude Opus 4.7 (Bedrock)',
        contextWindow: 1000000,
        outputWindow: 128000,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'us.anthropic.claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6 (Bedrock)',
        contextWindow: 1000000,
        outputWindow: 64000,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'us.amazon.nova-pro-v1:0',
        name: 'Amazon Nova Pro',
        contextWindow: 300000,
        outputWindow: 10000,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'us.amazon.nova-lite-v1:0',
        name: 'Amazon Nova Lite',
        contextWindow: 300000,
        outputWindow: 10000,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'us.amazon.nova-micro-v1:0',
        name: 'Amazon Nova Micro',
        contextWindow: 128000,
        outputWindow: 10000,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      {
        id: 'us.meta.llama3-3-70b-instruct-v1:0',
        name: 'Llama 3.3 70B Instruct (Bedrock)',
        contextWindow: 128000,
        capabilities: { streaming: true, tools: true, vision: false },
      },
    ],
  },

  google: {
    id: 'google',
    name: 'Gemini',
    type: 'google',
    requiresApiKey: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    icon: '/logos/gemini.svg',
    models: [
      {
        id: 'gemini-3.8-flash',
        name: 'Gemini 3.8 Flash',
        contextWindow: 1048576,
        outputWindow: 65536,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'gemini-3.7-flash',
        name: 'Gemini 3.7 Flash',
        contextWindow: 1048576,
        outputWindow: 65536,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'gemini-3.6-flash',
        name: 'Gemini 3.6 Flash',
        contextWindow: 1048576,
        outputWindow: 65536,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'gemini-3.5-flash-lite',
        name: 'Gemini 3.5 Flash-Lite',
        contextWindow: 1048576,
        outputWindow: 65536,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        contextWindow: 1048576,
        outputWindow: 65536,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'gemini-3.1-pro-preview',
        name: 'Gemini 3.1 Pro Preview',
        contextWindow: 1048576,
        outputWindow: 65536,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash Preview',
        contextWindow: 1048576,
        outputWindow: 65536,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        contextWindow: 1048576,
        outputWindow: 65536,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite',
        contextWindow: 1048576,
        outputWindow: 65536,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        contextWindow: 1048576,
        outputWindow: 65536,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
    ],
  },

  glm: {
    id: 'glm',
    name: 'GLM',
    type: 'openai',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    alternateBaseUrls: [
      { label: 'settings.baseUrlRegion.china', url: 'https://open.bigmodel.cn/api/paas/v4' },
      { label: 'settings.baseUrlRegion.international', url: 'https://api.z.ai/api/paas/v4' },
    ],
    requiresApiKey: true,
    icon: '/logos/glm.svg',
    models: [
      // GLM-5.3 Series - Flagship; thinking cannot be disabled, only scaled
      // via reasoning_effort low/high/max (the API rejects "disabled").
      {
        id: 'glm-5.3',
        name: 'GLM-5.3',
        contextWindow: 1000000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: false,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      // GLM-5.3-Flash - Native multimodal (320B MoE, 18B active); thinking is
      // always on with the same low/high/max effort scale as GLM-5.3.
      {
        id: 'glm-5.3-flash',
        name: 'GLM-5.3-Flash',
        contextWindow: 1000000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      // GLM-5.2 Series - Long-horizon coding model
      {
        id: 'glm-5.2',
        name: 'GLM-5.2',
        contextWindow: 1000000,
        outputWindow: 128000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      // GLM-5.1 Series
      {
        id: 'glm-5.1',
        name: 'GLM-5.1',
        contextWindow: 200000,
        outputWindow: 128000,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      {
        id: 'glm-5v-turbo',
        name: 'GLM-5V-Turbo',
        contextWindow: 200000,
        outputWindow: 128000,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      // GLM-5 Series
      {
        id: 'glm-5',
        name: 'GLM-5',
        contextWindow: 200000,
        outputWindow: 128000,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      // GLM-4.7 Series
      {
        id: 'glm-4.7',
        name: 'GLM-4.7',
        contextWindow: 200000,
        outputWindow: 128000,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      {
        id: 'glm-4.7-flashx',
        name: 'GLM-4.7-FlashX',
        contextWindow: 200000,
        outputWindow: 128000,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      {
        id: 'glm-4.7-flash',
        name: 'GLM-4.7-Flash',
        contextWindow: 200000,
        outputWindow: 128000,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      // GLM-4.6 Series - Advanced coding & reasoning
      {
        id: 'glm-4.6',
        name: 'GLM-4.6',
        contextWindow: 200000,
        outputWindow: 128000,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      {
        id: 'glm-4.6v',
        name: 'GLM-4.6V',
        contextWindow: 128000,
        outputWindow: 32000,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'glm-4.6v-flash',
        name: 'GLM-4.6V-Flash',
        contextWindow: 128000,
        outputWindow: 32000,
        capabilities: { streaming: true, tools: true, vision: true },
      },
    ],
  },

  qwen: {
    id: 'qwen',
    name: 'Qwen',
    type: 'openai',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    requiresApiKey: true,
    icon: '/logos/qwen.svg',
    models: [
      {
        id: 'qwen3.7-plus',
        name: 'Qwen3.7 Plus',
        contextWindow: 1000000,
        outputWindow: 64000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'qwen3.7-max',
        name: 'Qwen3.7 Max',
        contextWindow: 1000000,
        outputWindow: 64000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'qwen3.6-max-preview',
        name: 'Qwen3.6 Max Preview',
        contextWindow: 256000,
        outputWindow: 64000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'qwen3.6-plus',
        name: 'Qwen3.6 Plus',
        contextWindow: 1000000,
        outputWindow: 64000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'qwen3.6-plus-2026-04-02',
        name: 'Qwen3.6 Plus (2026-04-02)',
        contextWindow: 1000000,
        outputWindow: 64000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'qwen3.6-flash',
        name: 'Qwen3.6 Flash',
        contextWindow: 1000000,
        outputWindow: 64000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'qwen3.6-flash-2026-04-16',
        name: 'Qwen3.6 Flash (2026-04-16)',
        contextWindow: 1000000,
        outputWindow: 64000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'qwen3.6-35b-a3b',
        name: 'Qwen3.6 35B A3B',
        contextWindow: 262144,
        outputWindow: 64000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'qwen3.5-flash',
        name: 'Qwen3.5 Flash',
        contextWindow: 1000000,
        outputWindow: 65536,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'qwen3.5-plus',
        name: 'Qwen3.5 Plus',
        contextWindow: 1000000,
        outputWindow: 65536,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'qwen3-max',
        name: 'Qwen3 Max',
        contextWindow: 262144,
        outputWindow: 65536,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      {
        id: 'qwen3-vl-plus',
        name: 'Qwen3 VL Plus',
        contextWindow: 262144,
        outputWindow: 32768,
        capabilities: { streaming: true, tools: true, vision: true },
      },
    ],
  },

  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    requiresApiKey: true,
    icon: '/logos/deepseek.svg',
    models: [
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        contextWindow: 1048576,
        outputWindow: 393216,
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        contextWindow: 1048576,
        outputWindow: 393216,
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'deepseek-v4-flash-vision-exp',
        name: 'DeepSeek V4 Flash Vision (Exp)',
        contextWindow: 1048576,
        outputWindow: 393216,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
    ],
  },

  kimi: {
    id: 'kimi',
    name: 'Kimi',
    type: 'openai',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    alternateBaseUrls: [
      { label: 'settings.baseUrlRegion.china', url: 'https://api.moonshot.cn/v1' },
      { label: 'settings.baseUrlRegion.international', url: 'https://api.moonshot.ai/v1' },
    ],
    requiresApiKey: true,
    icon: '/logos/kimi.png',
    models: [
      {
        id: 'kimi-k3',
        name: 'Kimi K3',
        contextWindow: 1048576,
        outputWindow: 131072,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'kimi-k2.7-code',
        name: 'Kimi K2.7 Code',
        contextWindow: 256000,
        outputWindow: 32768,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'kimi-k2.7-code-highspeed',
        name: 'Kimi K2.7 Code HighSpeed',
        contextWindow: 256000,
        outputWindow: 32768,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'kimi-k2.6',
        name: 'Kimi K2.6',
        contextWindow: 256000,
        outputWindow: 8192,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      // K2.5 Series (2026) - 1T MoE, 32B active parameters
      {
        id: 'kimi-k2.5',
        name: 'Kimi K2.5',
        contextWindow: 256000,
        outputWindow: 8192,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'kimi-k2-thinking',
        name: 'Kimi K2 Thinking',
        contextWindow: 256000,
        outputWindow: 8192,
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: true,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
    ],
  },

  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    type: 'anthropic',
    defaultBaseUrl: 'https://api.minimaxi.com/anthropic/v1',
    alternateBaseUrls: [
      { label: 'settings.baseUrlRegion.china', url: 'https://api.minimaxi.com/anthropic/v1' },
      { label: 'settings.baseUrlRegion.international', url: 'https://api.minimax.io/anthropic/v1' },
    ],
    requiresApiKey: true,
    icon: '/logos/minimax.svg',
    models: [
      {
        id: 'MiniMax-M3',
        name: 'MiniMax M3',
        contextWindow: 1000000,
        outputWindow: 32768,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'MiniMax-M2.7',
        name: 'MiniMax M2.7',
        contextWindow: 204800,
        outputWindow: 8192,
        capabilities: { streaming: true, tools: true, vision: false },
      },
    ],
  },

  siliconflow: {
    id: 'siliconflow',
    name: '硅基流动',
    type: 'openai',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    requiresApiKey: true,
    icon: '/logos/siliconflow.svg',
    models: [
      // DeepSeek Series
      {
        id: 'deepseek-ai/DeepSeek-V3.2',
        name: 'DeepSeek-V3.2',
        contextWindow: 128000,
        outputWindow: 8192,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      {
        id: 'deepseek-ai/DeepSeek-R1',
        name: 'DeepSeek-R1',
        contextWindow: 128000,
        outputWindow: 8192,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      {
        id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
        name: 'DeepSeek-R1-Distill-Qwen-7B',
        contextWindow: 128000,
        outputWindow: 8192,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      // Qwen Series
      {
        id: 'Qwen/Qwen3-VL-32B-Instruct',
        name: 'Qwen3-VL-32B-Instruct',
        contextWindow: 256000,
        outputWindow: 32768,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      // Kimi Series
      {
        id: 'Pro/moonshotai/Kimi-K2.5',
        name: 'Kimi-K2.5',
        contextWindow: 256000,
        outputWindow: 96000,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      // GLM Series
      {
        id: 'THUDM/GLM-4.1V-9B-Thinking',
        name: 'GLM-4.1V-9B-Thinking',
        contextWindow: 64000,
        outputWindow: 8192,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'THUDM/GLM-Z1-Rumination-32B-0414',
        name: 'GLM-Z1-Rumination-32B',
        contextWindow: 32000,
        outputWindow: 16384,
        capabilities: { streaming: true, tools: true, vision: false },
      },
    ],
  },

  doubao: {
    id: 'doubao',
    name: '豆包',
    type: 'openai',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    requiresApiKey: true,
    icon: '/logos/doubao.svg',
    models: [
      {
        id: 'doubao-seed-2-1-pro-260628',
        name: 'Doubao Seed 2.1 Pro',
        contextWindow: 256000,
        outputWindow: 32768,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'doubao-seed-2-1-turbo-260628',
        name: 'Doubao Seed 2.1 Turbo',
        contextWindow: 256000,
        outputWindow: 32768,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'doubao-seed-evolving',
        name: 'Doubao Seed Evolving',
        contextWindow: 256000,
        outputWindow: 32768,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'doubao-seed-character-260628',
        name: 'Doubao Seed Character',
        contextWindow: 256000,
        outputWindow: 32768,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'doubao-seed-2-0-pro-260215',
        name: 'Doubao Seed 2.0 Pro',
        contextWindow: 128000,
        outputWindow: 32768,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'doubao-seed-2-0-lite-260215',
        name: 'Doubao Seed 2.0 Lite',
        contextWindow: 128000,
        outputWindow: 32768,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'doubao-seed-2-0-mini-260215',
        name: 'Doubao Seed 2.0 Mini',
        contextWindow: 128000,
        outputWindow: 32768,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'doubao-seed-1-8-251228',
        name: 'Doubao Seed 1.8',
        contextWindow: 128000,
        outputWindow: 32768,
        capabilities: { streaming: true, tools: true, vision: true },
      },
    ],
  },

  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    requiresApiKey: true,
    icon: '/logos/openrouter.svg',
    models: [
      {
        id: 'deepseek/deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        contextWindow: 1048576,
        outputWindow: 131072,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      {
        id: 'deepseek/deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        contextWindow: 1048576,
        outputWindow: 131072,
        capabilities: { streaming: true, tools: true, vision: false },
      },
    ],
  },

  grok: {
    id: 'grok',
    name: 'Grok',
    type: 'openai',
    defaultBaseUrl: 'https://api.x.ai/v1',
    requiresApiKey: true,
    icon: '/logos/grok.svg',
    models: [
      {
        id: 'grok-4.6',
        name: 'Grok 4.6',
        contextWindow: 500000,
        outputWindow: 500000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'grok-4.5',
        name: 'Grok 4.5',
        contextWindow: 500000,
        outputWindow: 500000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: true,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'grok-4.3',
        name: 'Grok 4.3',
        contextWindow: 1000000,
        outputWindow: 30000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: true,
            defaultEnabled: false,
          },
        },
      },
      {
        id: 'grok-build-0.1',
        name: 'Grok Build 0.1',
        contextWindow: 256000,
        outputWindow: 256000,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'grok-4.20-reasoning',
        name: 'Grok 4.20 Reasoning',
        contextWindow: 2000000,
        outputWindow: 131072,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'grok-4.20',
        name: 'Grok 4.20',
        contextWindow: 2000000,
        outputWindow: 131072,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'grok-4.20-multi-agent',
        name: 'Grok 4.20 Multi-Agent',
        contextWindow: 2000000,
        outputWindow: 131072,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'grok-4-1-fast-reasoning',
        name: 'Grok 4.1 Fast Reasoning',
        contextWindow: 2000000,
        outputWindow: 131072,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: false,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'grok-4-1-fast-non-reasoning',
        name: 'Grok 4.1 Fast',
        contextWindow: 2000000,
        outputWindow: 131072,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'grok-code-fast-1',
        name: 'Grok Code Fast',
        contextWindow: 256000,
        outputWindow: 32768,
        capabilities: { streaming: true, tools: true, vision: false },
      },
    ],
  },

  'tencent-hunyuan': {
    id: 'tencent-hunyuan',
    name: 'Tencent Hunyuan',
    type: 'openai',
    defaultBaseUrl: 'https://tokenhub.tencentmaas.com/v1',
    alternateBaseUrls: [
      { label: 'settings.baseUrlRegion.china', url: 'https://tokenhub.tencentmaas.com/v1' },
      {
        label: 'settings.baseUrlRegion.international',
        url: 'https://tokenhub-intl.tencentmaas.com/v1',
      },
    ],
    requiresApiKey: true,
    icon: '/logos/hunyuan.svg',
    models: [
      {
        id: 'hy3-preview',
        name: 'Tencent Hy3 Preview',
        contextWindow: 256000,
        outputWindow: 64000,
        capabilities: { streaming: true, tools: true, vision: false },
      },
    ],
  },

  xiaomi: {
    id: 'xiaomi',
    name: 'Xiaomi MiMo',
    type: 'openai',
    defaultBaseUrl: 'https://api.xiaomimimo.com/v1',
    // Token Plan endpoints use the same OpenAI-compatible path with regional hosts.
    alternateBaseUrls: [
      { label: 'settings.baseUrlRegion.xiaomiPayg', url: 'https://api.xiaomimimo.com/v1' },
      {
        label: 'settings.baseUrlRegion.xiaomiTokenPlanCN',
        url: 'https://token-plan-cn.xiaomimimo.com/v1',
      },
      {
        label: 'settings.baseUrlRegion.xiaomiTokenPlanSGP',
        url: 'https://token-plan-sgp.xiaomimimo.com/v1',
      },
      {
        label: 'settings.baseUrlRegion.xiaomiTokenPlanEU',
        url: 'https://token-plan-ams.xiaomimimo.com/v1',
      },
    ],
    requiresApiKey: true,
    icon: '/logos/xiaomi.svg',
    models: [
      {
        id: 'mimo-v2.6-pro',
        name: 'MiMo V2.6 Pro',
        contextWindow: 1048576,
        outputWindow: 131072,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'mimo-v2.6-flash',
        name: 'MiMo V2.6 Flash',
        contextWindow: 1048576,
        outputWindow: 131072,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'mimo-v2.5-pro',
        name: 'MiMo V2.5 Pro',
        contextWindow: 1048576,
        outputWindow: 131072,
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: true,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'mimo-v2-pro',
        name: 'MiMo V2 Pro',
        contextWindow: 1048576,
        outputWindow: 131072,
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: true,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'mimo-v2.5',
        name: 'MiMo V2.5',
        contextWindow: 1048576,
        outputWindow: 131072,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'mimo-v2-omni',
        name: 'MiMo V2 Omni',
        contextWindow: 262144,
        outputWindow: 131072,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          thinking: {
            toggleable: true,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
      {
        id: 'mimo-v2-flash',
        name: 'MiMo V2 Flash',
        contextWindow: 262144,
        outputWindow: 65536,
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
          thinking: {
            toggleable: true,
            budgetAdjustable: false,
            defaultEnabled: true,
          },
        },
      },
    ],
  },

  tokendance: {
    id: 'tokendance',
    name: 'TokenDance',
    type: 'openai',
    defaultBaseUrl: 'https://tokendance.space/gateway/v1',
    requiresApiKey: true,
    icon: '/logos/tokendance.svg',
    models: [
      {
        id: 'deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash',
        contextWindow: 1000000,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        contextWindow: 1048576,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      {
        id: 'glm-5.3',
        name: 'GLM-5.3',
        contextWindow: 1000000,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      {
        id: 'kimi-k3',
        name: 'Kimi K3',
        contextWindow: 1048576,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'qwen3.8-max',
        name: 'Qwen3.8 Max',
        contextWindow: 1000000,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'seed-2.1-pro',
        name: 'Seed 2.1 Pro',
        contextWindow: 256000,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'minimax-m3',
        name: 'MiniMax M3',
        contextWindow: 1000000,
        capabilities: { streaming: true, tools: true, vision: true },
      },
    ],
  },

  ollama: {
    id: 'ollama',
    name: 'Ollama',
    type: 'openai',
    defaultBaseUrl: 'http://localhost:11434/v1',
    requiresApiKey: false,
    icon: '/logos/ollama.svg',
    models: [
      {
        id: 'llama3.3',
        name: 'Llama 3.3 70B',
        contextWindow: 131072,
        outputWindow: 4096,
        capabilities: { streaming: true, tools: true, vision: false },
      },
      {
        id: 'gemma3',
        name: 'Gemma 3 12B',
        contextWindow: 131072,
        outputWindow: 8192,
        capabilities: { streaming: true, tools: true, vision: true },
      },
      {
        id: 'deepseek-r1',
        name: 'DeepSeek R1',
        contextWindow: 131072,
        outputWindow: 8192,
        capabilities: { streaming: true, tools: false, vision: false },
      },
    ],
  },

  lemonade: {
    id: 'lemonade',
    name: 'Lemonade',
    type: 'openai',
    defaultBaseUrl: 'http://localhost:13305/v1',
    requiresApiKey: false,
    icon: '/logos/lemonade.svg',
    models: [
      {
        id: 'Gemma-4-26B-A4B-it-GGUF',
        name: 'Gemma 4 26B A4B IT GGUF',
        capabilities: { streaming: true, tools: true, vision: false },
      },
    ],
  },
};

applyModelMetadata(PROVIDERS);
