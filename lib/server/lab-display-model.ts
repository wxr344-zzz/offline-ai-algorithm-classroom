import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import { backgroundWorkspaceId } from '@/lib/server/model-config/runtime';
import type { Translate } from './course-translation';

/** The course's teaching model, as a plain system/prompt call (local, no tools). */
export function teachingModelCall(ownerId: string, signal?: AbortSignal): Translate {
  return async (system, prompt) => {
    if (signal?.aborted) throw signal.reason ?? new Error('Translation cancelled');
    const model = await resolveModel({
      stage: 'scene-actions',
      workspaceId: await backgroundWorkspaceId(ownerId),
    });
    const reply = await callLLM(
      {
        model: model.model,
        temperature: 0,
        abortSignal: signal,
        system,
        prompt,
        maxOutputTokens: model.modelInfo?.outputWindow,
        maxRetries: 0,
      },
      'eduplus-display-language',
      undefined,
      model.thinkingConfig,
      { serverManaged: model.serverManaged },
    );
    return reply.text;
  };
}
