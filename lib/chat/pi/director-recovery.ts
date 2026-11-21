import type { AgentConfig } from '@/lib/orchestration/registry/types';
import type { AgentTurnSummary } from '@/lib/orchestration/types';
import type { StatelessChatRequest } from '@/lib/types/chat';

/** Standalone navigation only: mixed requests remain unanswered questions. */
export function explicitLessonReturn(messages: StatelessChatRequest['messages']): boolean {
  const latest = [...messages].reverse().find((message) => message.role === 'user');
  const text =
    latest?.parts
      ?.filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(' ') ?? '';
  const sentences = text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[.!。！,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const command =
    /^(?:(?:please|请|請)\s*)?(?:(?:return|go back)\s+to\s+(?:the\s+)?(?:lesson|class|course)|(?:resume|continue)\s+(?:the\s+)?(?:lesson|class|course)|(?:回到|返回|继续|繼續)(?:课堂|課堂|课程|課程|上课|上課)|retour(?:ner)? au cours|reprendre le cours|zurück zum unterricht|(?:volver|regresar) a la clase|retomar a aula|возобновить урок|quay lại bài học|授業に戻る|수업으로 돌아가기|العودة إلى الدرس)$/u;
  const acknowledgment =
    /^(?:thanks|thank you|i understand|understood|okay|ok|谢谢|謝謝|好的|好|明白了|我懂了|merci|danke|gracias|obrigad[oa]|спасибо|cảm ơn|ありがとう|감사합니다|شكرًا)$/u;
  return (
    sentences.some((sentence) => command.test(sentence)) &&
    sentences.every((sentence) => command.test(sentence) || acknowledgment.test(sentence))
  );
}

/** Only the opening of an explicitly accepted agent-led discussion. Human Q&A
 * and later follow-ups retain the existing teacher-first recovery behavior. */
export function openingDiscussionSpeaker(
  body: Pick<StatelessChatRequest, 'config' | 'messages'>,
  agents: readonly AgentConfig[],
  responses: readonly AgentTurnSummary[],
): AgentConfig | undefined {
  if (
    body.config.sessionType !== 'discussion' ||
    !body.config.discussionTopic ||
    body.messages.some((message) => message.role === 'user')
  )
    return undefined;
  const starter =
    agents.find((agent) => agent.id === body.config.triggerAgentId) ??
    agents.find((agent) => agent.role === 'student');
  const visible = new Set(
    responses
      .filter((response) => response.contentPreview.trim())
      .map((response) => response.agentId),
  );
  const starterFailures = responses.filter(
    (response) => response.agentId === starter?.id && !response.contentPreview.trim(),
  ).length;
  if (starter && !visible.has(starter.id) && starterFailures < 2) return starter;
  const teacher =
    agents.find((agent) => agent.role === 'teacher') ??
    agents.find((agent) => agent.role === 'assistant');
  return starter && teacher && !visible.has(teacher.id) ? teacher : undefined;
}

/**
 * Small local models sometimes answer the director prompt with plain text, or
 * write the tool call as JSON text instead of a structured call. Recover the
 * intended call_agent target from such text when it names an available agent.
 */
export function parseTextualAgentCall(
  text: string,
  agentIds: readonly string[],
): { agentId: string; instruction?: string } | undefined {
  if (!text) return undefined;
  const candidates = text.match(/\{[\s\S]*?\}(?:\s*\})?/g) ?? [];
  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const args = (parsed.arguments ?? parsed.parameters ?? parsed) as Record<string, unknown>;
      const id = typeof args?.agentId === 'string' ? args.agentId : undefined;
      if (id && agentIds.includes(id)) {
        return {
          agentId: id,
          instruction: typeof args.instruction === 'string' ? args.instruction : undefined,
        };
      }
    } catch {
      // not JSON; keep scanning
    }
  }
  const named = text.match(/call_agent[^\n]*?["'“]?([\w-]+)["'”]?/);
  if (named && agentIds.includes(named[1])) return { agentId: named[1] };
  return undefined;
}

/**
 * Order in which agents answer when the director produced no classroom turn:
 * the teacher first, then a teaching assistant, then anyone else.
 */
export function recoveryAgentOrder(
  agents: readonly AgentConfig[],
  preferredId?: string,
): AgentConfig[] {
  const rank = (agent: AgentConfig) =>
    agent.id === preferredId
      ? 0
      : agent.role === 'teacher'
        ? 1
        : agent.role === 'assistant'
          ? 2
          : 3;
  return [...agents].sort((a, b) => rank(a) - rank(b) || (b.priority ?? 0) - (a.priority ?? 0));
}
