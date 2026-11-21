import { describe, expect, it } from 'vitest';
import {
  parseTextualAgentCall,
  recoveryAgentOrder,
  openingDiscussionSpeaker,
  explicitLessonReturn,
} from '@/lib/chat/pi/director-recovery';
import type { AgentConfig } from '@/lib/orchestration/registry/types';

const agent = (id: string, role: string, priority = 5) =>
  ({ id, role, priority, name: id }) as unknown as AgentConfig;

describe('director recovery', () => {
  it('honors return requests but keeps mixed or unanswered questions open', () => {
    const messages = (text: string) => [{ role: 'user', parts: [{ type: 'text', text }] }] as never;
    for (const text of [
      'Thanks, I understand. Please return to the lesson.',
      '谢谢，回到课堂。',
      'reprendre le cours',
    ])
      expect(explicitLessonReturn(messages(text))).toBe(true);
    for (const text of [
      'Before we return to the lesson, explain the pointer.',
      'Please return to the lesson. Why did we lose the link?',
      '明白了，再解释一下逆置。',
    ])
      expect(explicitLessonReturn(messages(text))).toBe(false);
  });
  it('opens accepted discussions with the selected initiator and a teacher handoff only', () => {
    const agents = [agent('s1', 'student'), agent('t1', 'teacher')];
    const body = {
      config: {
        agentIds: ['s1', 't1'],
        sessionType: 'discussion',
        discussionTopic: 'Pointer updates',
        triggerAgentId: 's1',
      },
      messages: [],
    } as Parameters<typeof openingDiscussionSpeaker>[0];
    const said = (agentId: string, contentPreview = 'A genuine question about the current topic') =>
      ({ agentId, contentPreview }) as never;
    expect(openingDiscussionSpeaker(body, agents, [])?.id).toBe('s1');
    expect(openingDiscussionSpeaker(body, agents, [said('s1')])?.id).toBe('t1');
    expect(openingDiscussionSpeaker(body, agents, [said('s1', ''), said('s1', '')])?.id).toBe('t1');
    expect(openingDiscussionSpeaker(body, agents, [said('s1'), said('t1')])).toBeUndefined();
    expect(
      openingDiscussionSpeaker({ ...body, messages: [{ role: 'user' }] } as never, agents, []),
    ).toBeUndefined();
    expect(
      openingDiscussionSpeaker(
        { config: { sessionType: 'qa' }, messages: [] } as never,
        agents,
        [],
      ),
    ).toBeUndefined();
  });
  it('recovers a tool call the model wrote as JSON text', () => {
    const text =
      'I will ask the teacher. {"name":"call_agent","arguments":{"agentId":"t1","instruction":"Explain it"}}';
    expect(parseTextualAgentCall(text, ['t1', 's1'])).toEqual({
      agentId: 't1',
      instruction: 'Explain it',
    });
    expect(parseTextualAgentCall('{"agentId":"ghost"}', ['t1'])).toBeUndefined();
    expect(parseTextualAgentCall('plain answer without any call', ['t1'])).toBeUndefined();
  });

  it('asks the teacher first, then an assistant, unless the director named someone', () => {
    const agents = [agent('s1', 'student', 9), agent('a1', 'assistant'), agent('t1', 'teacher')];
    expect(recoveryAgentOrder(agents).map((a) => a.id)).toEqual(['t1', 'a1', 's1']);
    expect(recoveryAgentOrder(agents, 'a1').map((a) => a.id)).toEqual(['a1', 't1', 's1']);
  });
});
