import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '@/lib/orchestration/registry/types';
import type { StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';

const mock = vi.hoisted(() => ({ calls: [] as string[], streamLLM: vi.fn() }));
vi.mock('@/lib/ai/llm', () => ({ streamLLM: mock.streamLLM }));
vi.mock('@/lib/chat/pi/tools/call-agent', () => ({
  buildCallAgentTool: (options: {
    onAgentDone: (summary: unknown) => void;
    send: (event: unknown) => Promise<void>;
  }) => ({
    name: 'call_agent',
    label: 'Call agent',
    description: 'Call agent',
    parameters: {
      type: 'object',
      properties: { agentId: { type: 'string' }, instruction: { type: 'string' } },
      required: ['agentId', 'instruction'],
    },
    execute: async (_id: string, args: { agentId: string }) => {
      mock.calls.push(args.agentId);
      await options.send({
        type: 'text_delta',
        data: { content: 'A meaningful course contribution.', messageId: args.agentId },
      });
      options.onAgentDone({
        agentId: args.agentId,
        agentName: args.agentId,
        contentPreview: 'A meaningful course contribution.',
        actionCount: 0,
        whiteboardActions: [],
      });
      return { content: [{ type: 'text', text: 'Contribution delivered.' }], details: {} };
    },
  }),
}));
import { runPiDirectorLoop } from '@/lib/chat/pi/director-loop';
const agents = [
  { id: 's', name: 'Student', role: 'student' },
  { id: 't', name: 'Teacher', role: 'teacher' },
].map((a) => ({
  ...a,
  persona: 'Contribute accurately.',
  avatar: '',
  color: '#333',
  allowedActions: [],
  priority: 5,
})) as unknown as AgentConfig[];
async function run(discussion: boolean, question = 'Why preserve a successor pointer?') {
  const events: StatelessEvent[] = [];
  const controller = new AbortController();
  await runPiDirectorLoop({
    body: {
      messages: discussion
        ? []
        : [
            {
              id: 'human',
              role: 'user',
              parts: [{ type: 'text', text: question }],
            },
          ],
      config: {
        agentIds: ['s', 't'],
        sessionType: discussion ? 'discussion' : 'qa',
        ...(discussion ? { discussionTopic: 'Pointer updates', triggerAgentId: 's' } : {}),
      },
      storeState: {
        stage: null,
        scenes: [],
        currentSceneId: null,
        mode: 'playback',
        whiteboardOpen: false,
      },
    } as unknown as StatelessChatRequest,
    agentConfigs: agents,
    send: async (event) => {
      events.push(event);
    },
    languageModel: { provider: 'test', modelId: 'director' } as never,
    thinkingConfig: { mode: 'disabled', enabled: false },
    signal: controller.signal,
    abortSignal: controller.signal,
    maxAgentTurns: 3,
    maxActionsPerAgent: 1,
    enableWhiteboardTools: false,
  });
  return events;
}
describe('accepted discussion with a director that emits no calls', () => {
  beforeEach(() => {
    mock.calls.length = 0;
    mock.streamLLM.mockImplementation(() => ({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: 'END' };
        yield {
          type: 'finish',
          finishReason: 'stop',
          totalUsage: {
            inputTokens: 0,
            outputTokens: 0,
            inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 },
          },
        };
      })(),
      usage: new Promise(() => {}),
    }));
  });
  it('streams the initiating student and the teacher, then finishes with a valid done', async () => {
    const events = await run(true);
    expect(mock.calls).toEqual(['s', 't']);
    expect(events.filter((e) => e.type === 'text_delta')).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: { totalAgents: 2, agentHadContent: true },
    });
  });
  it('returns to the lesson after a visible closing line without cueing another question', async () => {
    const events = await run(false, 'Thanks, I understand. Please return to the lesson.');
    expect(mock.calls).toEqual(['t']);
    expect(events.filter((event) => event.type === 'cue_user')).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: { sessionClosed: true, endReason: 'back_to_lesson' },
    });
  });

  it('retains the previously fixed teacher recovery for a human question', async () => {
    const events = await run(false);
    expect(mock.calls).toEqual(['t']);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: { totalAgents: 1, agentHadContent: true },
    });
  });
});
