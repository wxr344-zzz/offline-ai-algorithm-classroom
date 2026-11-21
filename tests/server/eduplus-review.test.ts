import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLearningReview } from '@/lib/server/eduplus-review';
import fixture from '@/contracts/examples/public-lab.json';
import teaching from '@/tests/fixtures/eduplus-teaching.json';
import { parseTeaching } from '@/lib/eduplus/classroom-contract';
import {
  buildNativeClassroom,
  nativeQuizQuestions,
  nativeStageId,
} from '@/lib/eduplus/classroom-adapter';
import type { PublicCourse } from '@/lib/types/eduplus.generated';

const deps = vi.hoisted(() => ({
  get: vi.fn(),
  classroom: vi.fn(),
  practice: vi.fn(),
  draft: vi.fn(),
  sessions: vi.fn(),
  records: vi.fn(),
  document: vi.fn(),
  chats: vi.fn(),
}));
vi.mock('@/lib/persistence/eduplus-courses', () => ({
  getEduplusCourseStore: async () => ({
    get: deps.get,
    getClassroom: deps.classroom,
    listPractice: deps.practice,
    getDraft: deps.draft,
  }),
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    runtimeStore: { listSessions: deps.sessions, listRecords: deps.records },
  }),
}));
vi.mock('@/lib/server/agent-runtime/owner-scoped-documents', () => ({
  getOwnerScopedDocumentStore: async () => ({ loadDocument: deps.document }),
}));
vi.mock('@/lib/utils/chat-storage', () => ({ readPersistedChatSessions: deps.chats }));
beforeEach(() => {
  deps.get.mockReset().mockResolvedValue(fixture);
  deps.classroom.mockReset().mockResolvedValue({
    stageId: nativeStageId(fixture.courseId),
    teaching: parseTeaching(teaching),
  });
  deps.practice.mockReset().mockResolvedValue([]);
  deps.draft.mockReset().mockResolvedValue({ revision: 0, updatedAt: null });
  deps.sessions.mockReset().mockResolvedValue([{ id: 'quiz-a', kind: 'quizAttempt' }]);
  deps.records.mockReset().mockResolvedValue([]);
  deps.document
    .mockReset()
    .mockResolvedValue(buildNativeClassroom(fixture as PublicCourse, parseTeaching(teaching)));
  deps.chats.mockReset().mockResolvedValue([]);
});
describe('fact-based learning review', () => {
  it('recomputes quiz scores from answers, ignoring forged result scores', async () => {
    const questions = nativeQuizQuestions(fixture.courseId, parseTeaching(teaching));
    deps.records.mockResolvedValue([
      {
        createdAt: '2026-10-13T00:00:00Z',
        payload: {
          phase: 'reviewed',
          answers: Object.fromEntries(questions.map((q) => [q.id, 'D'])),
          results: questions.map((q) => ({ questionId: q.id, earned: 100, correct: true })),
        },
      },
    ]);
    const review = await getLearningReview('owner-a', fixture.courseId);
    expect(review.quiz).toMatchObject({ total: 3, correct: 0 });
    expect(review.quizStatus).toBe('scored');
    expect(deps.sessions).toHaveBeenCalledWith(nativeStageId(fixture.courseId), 'owner-a');
  });
  it('does not fabricate completion for drafts or a changed native quiz', async () => {
    deps.records.mockResolvedValue([{ payload: { phase: 'draft', answers: {} } }]);
    expect((await getLearningReview('owner-a', fixture.courseId)).quiz).toBeNull();
    deps.document.mockResolvedValue({ scenes: [] });
    const changed = await getLearningReview('owner-a', fixture.courseId);
    expect(changed.quiz).toBeNull();
    expect(changed.quizStatus).toBe('content-changed');
  });
  it('exports visible text only, excluding system messages, reasoning and tools', async () => {
    deps.chats.mockResolvedValue([
      {
        id: 'chat',
        sceneId: 'concept',
        messages: [
          { id: 'system', role: 'system', parts: [{ type: 'text', text: 'SYSTEM_SECRET' }] },
          {
            id: 'visible',
            role: 'assistant',
            metadata: { senderName: 'AI教师' },
            parts: [
              { type: 'text', text: '课堂讲解' },
              { type: 'reasoning', text: 'REASONING_SECRET' },
              { type: 'dynamic-tool', output: 'TOOL_SECRET' },
            ],
          },
        ],
      },
    ]);
    const review = await getLearningReview('owner-a', fixture.courseId);
    expect(review.dialogue).toEqual([
      { id: 'chat:visible', sender: 'AI教师', text: '课堂讲解', sceneId: 'concept' },
    ]);
    expect(JSON.stringify(review)).not.toContain('SECRET');
  });
  it('refuses foreign owners before reading learner runtime', async () => {
    deps.get.mockResolvedValue(null);
    await expect(getLearningReview('other', fixture.courseId)).rejects.toMatchObject({
      status: 404,
    });
    expect(deps.sessions).not.toHaveBeenCalled();
    expect(deps.chats).not.toHaveBeenCalled();
  });
});
