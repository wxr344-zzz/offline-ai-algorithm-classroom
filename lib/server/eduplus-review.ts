import { z } from 'zod';
import { getEduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { AgentAPIError } from './eduplus-agent-client';
import { nativeQuizQuestions, nativeQuizSceneId } from '@/lib/eduplus/classroom-adapter';
import { gradeChoiceQuestions } from '@/lib/quiz/grading';
import type { LearningReview } from '@/lib/types/eduplus-learning';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import type { QuizQuestion } from '@/lib/types/stage';
import { readPersistedChatSessions } from '@/lib/utils/chat-storage';

const answersSchema = z.record(
  z.string(),
  z.union([z.string().max(1000), z.array(z.string().max(1000)).max(10)]),
);
export async function getLearningReview(
  ownerId: string,
  courseId: string,
): Promise<LearningReview> {
  const store = await getEduplusCourseStore();
  const course = await store.get(ownerId, courseId);
  if (!course) throw new AgentAPIError(404, 'COURSE_NOT_FOUND', '课程不存在或无权访问。');
  const [events, drafts, classroom] = await Promise.all([
    store.listPractice(ownerId, courseId),
    Promise.all(
      course.scenes.map(async (scene) => {
        const draft = await store.getDraft(ownerId, courseId, scene.sceneId);
        return {
          sceneId: scene.sceneId,
          sceneType: scene.sceneType,
          revision: draft.revision,
          updatedAt: draft.updatedAt,
        };
      }),
    ),
    store.getClassroom(ownerId, courseId),
  ]);
  let quiz: LearningReview['quiz'] = null;
  let quizStatus: LearningReview['quizStatus'] = classroom ? 'not-submitted' : 'not-created';
  let dialogue: LearningReview['dialogue'] = [];
  if (classroom) {
    const { runtimeStore } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const chats = await readPersistedChatSessions(runtimeStore, classroom.stageId, ownerId);
    dialogue = chats
      .flatMap((chat) =>
        chat.messages
          .filter((message) => message.role === 'user' || message.role === 'assistant')
          .map((message) => ({
            id: `${chat.id}:${message.id}`,
            sender: (
              message.metadata?.senderName ?? (message.role === 'user' ? '学生' : '教师/Agent')
            ).slice(0, 80),
            text: message.parts
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n')
              .slice(0, 4000),
            sceneId: chat.sceneId ?? null,
          })),
      )
      .filter((message) => message.text.trim())
      .slice(-200);
    const questions = nativeQuizQuestions(courseId, classroom.teaching);
    const quizSceneId = classroom.quizSceneId ?? nativeQuizSceneId(courseId);
    const document = await (
      await getOwnerScopedDocumentStore(ownerId)
    ).loadDocument(classroom.stageId);
    const stored = document?.scenes.find((scene) => scene.id === quizSceneId);
    const signature = (items: QuizQuestion[]) =>
      JSON.stringify(
        items.map((q) => [
          q.id,
          q.type,
          q.question,
          q.options?.map((option) => [option.value, option.label]),
          q.answer,
          q.analysis,
          q.points ?? 1,
        ]),
      );
    if (
      !stored ||
      stored.content.type !== 'quiz' ||
      signature(stored.content.questions) !== signature(questions)
    ) {
      // The native editor may alter a quiz. Without a matching versioned snapshot, do not regrade history.
      return { courseId, events, drafts, quiz: null, quizStatus: 'content-changed', dialogue };
    }
    const sessions = (await runtimeStore.listSessions(classroom.stageId, ownerId))
      .filter((session) => session.kind === 'quizAttempt')
      .reverse();
    for (const session of sessions) {
      const records = await runtimeStore.listRecords(session.id, {
        sceneId: quizSceneId,
      });
      const submitted = [...records].reverse().find((record) => {
        const payload = record.payload as Record<string, unknown> | null;
        return payload && (payload.phase === 'submitted' || payload.phase === 'reviewed');
      });
      if (!submitted) continue;
      const payload = submitted.payload as Record<string, unknown>;
      const parsed = answersSchema.safeParse(payload.answers);
      if (!parsed.success) continue;
      // Recompute from recorded answers and the immutable keys; never trust client-supplied scores.
      const results = gradeChoiceQuestions(questions, parsed.data);
      quiz = {
        total: results.length,
        correct: results.filter((item) => item.correct).length,
        submittedAt: submitted.createdAt,
        wrongTopics: results
          .filter((item) => !item.correct)
          .map((item) => questions.find((question) => question.id === item.questionId)!.question),
      };
      quizStatus = 'scored';
      break;
    }
  }
  return { courseId, events, drafts, quiz, quizStatus, dialogue };
}
