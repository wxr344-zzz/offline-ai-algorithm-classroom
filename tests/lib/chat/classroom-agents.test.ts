import { expect, it } from 'vitest';
import { classroomAgentIds } from '@/lib/chat/classroom-agents';
it('retains the saved classroom cast regardless of newer homepage choices', () => {
  const saved = ['default-1', 'default-4', 'default-7'];
  expect(classroomAgentIds({ agentIds: saved }, ['default-1', 'default-2'])).toEqual(saved);
  expect(classroomAgentIds({ agentIds: saved }, [])).toEqual(saved);
});
it('supports legacy classrooms without a cast and does not mutate or duplicate roles', () => {
  const saved = ['default-1', 'default-4', 'default-4'];
  expect(classroomAgentIds({ agentIds: saved })).toEqual(['default-1', 'default-4']);
  expect(saved).toHaveLength(3);
  expect(classroomAgentIds(null, ['default-2'])).toEqual(['default-2']);
  expect(classroomAgentIds({})).toEqual(['default-1']);
});
