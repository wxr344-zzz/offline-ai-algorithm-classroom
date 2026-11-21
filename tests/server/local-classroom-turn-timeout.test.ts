import { expect, it } from 'vitest';
import { localClassroomTurnTimeout } from '@/lib/server/local-context-window';
it('allows local queued inference a bounded turn without expanding remote or invalid endpoints', () => {
  expect(localClassroomTurnTimeout('http://127.0.0.1:11436/v1')).toBe(180000);
  expect(localClassroomTurnTimeout('http://localhost:11434/v1')).toBe(180000);
  expect(localClassroomTurnTimeout('https://api.example.com/v1')).toBe(60000);
  expect(localClassroomTurnTimeout(undefined)).toBe(60000);
  expect(localClassroomTurnTimeout('invalid')).toBe(60000);
});
