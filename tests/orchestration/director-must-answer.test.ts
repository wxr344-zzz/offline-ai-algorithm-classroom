import { describe, expect, it } from 'vitest';
import { chooseNextSpeaker } from '@/lib/orchestration/director-prompt';

const agents = [
  { id: 'default-1', name: 'AI教师', role: 'teacher' },
  { id: 'default-7', name: 'Lab agent', role: 'assistant' },
];

describe('a question the learner just asked is answered (reported: "问答已结束" with no reply)', () => {
  it.each([
    ['END', '{"next_agent":"END"}'],
    ['USER', '{"next_agent":"USER"}'],
    ['an unparseable reply', 'I think the teacher should answer.'],
    ['an unknown agent', '{"next_agent":"老师"}'],
  ])('the teacher answers when the director replies %s on the first turn', (_label, reply) => {
    expect(chooseNextSpeaker(reply, agents, true)).toMatchObject({
      kind: 'agent',
      agentId: 'default-1',
    });
  });
  it('a failing director call still gets the question answered', () => {
    expect(chooseNextSpeaker(new Error('reset'), agents, true)).toMatchObject({
      agentId: 'default-1',
    });
  });
  it('accepts an agent named by its display name', () => {
    expect(chooseNextSpeaker('{"next_agent":"Lab agent"}', agents, true)).toEqual({
      kind: 'agent',
      agentId: 'default-7',
    });
  });
  it('after an answer the director may still end the round or hand over to the learner', () => {
    expect(chooseNextSpeaker('{"next_agent":"END"}', agents, false)).toEqual({ kind: 'end' });
    expect(chooseNextSpeaker('{"next_agent":"USER"}', agents, false)).toEqual({ kind: 'user' });
    expect(chooseNextSpeaker('{"next_agent":"default-1"}', agents, false)).toEqual({
      kind: 'agent',
      agentId: 'default-1',
    });
  });
});
