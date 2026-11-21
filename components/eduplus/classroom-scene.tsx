'use client';
import { useEffect, useState } from 'react';
import type { EduplusSceneReference } from '@/lib/eduplus/classroom-contract';
import type { ClassroomResponse, LearningReview } from '@/lib/types/eduplus-learning';
import { LabBoundary } from './lab-boundary';
import { LabPractice } from './lab-practice';
import { NotebookExport } from './notebook-export';
import { InputVisualization } from './input-visualization';
import { useCourseLanguage } from '@/lib/eduplus/use-course-language';
import { contentLanguageTag } from '@/lib/eduplus/content-language';
import { classroomText } from '@/lib/eduplus/lab-text';

async function read(response: Response, fallback: string) {
  const data = await response.json();
  if (!response.ok)
    throw new Error(`${fallback}${data.error?.code ? ` [${data.error.code}]` : ''}`);
  return data;
}
export function EduplusClassroomScene({ reference }: { reference: EduplusSceneReference }) {
  const language = useCourseLanguage();
  const T = classroomText(language);
  const [data, setData] = useState<ClassroomResponse | null>(null);
  const [review, setReview] = useState<LearningReview | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const base = `/api/eduplus/courses/${encodeURIComponent(reference.courseId)}`;
    Promise.all([
      // The course language decides the Lab's display language (translated server-side).
      fetch(`${base}/classroom?lang=${encodeURIComponent(contentLanguageTag(language))}`, {
        signal: controller.signal,
      }).then((r) => read(r, T.readFailed)),
      reference.phase === 'review'
        ? fetch(`${base}/review`, { signal: controller.signal }).then((r) => read(r, T.readFailed))
        : null,
    ])
      .then(([course, progress]) => {
        if (!controller.signal.aborted) {
          setData(course);
          setReview(progress);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : T.readFailedShort);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- T only changes the wording
  }, [reference.courseId, reference.phase, language]);
  if (error)
    return (
      <div role="alert" className="p-6">
        {error}
      </div>
    );
  if (!data)
    return (
      <div className="p-6" aria-live="polite">
        {T.loading}
      </div>
    );
  const { course, teaching } = data;
  const scene = course.scenes.find((item) => item.sceneType === reference.phase);
  const example = course.scenes[0]?.problem.publicTestCases[selected];
  return (
    <div
      className="h-full overflow-auto bg-background p-6 text-foreground"
      data-native-keyboard
      dir={language === 'ar-SA' ? 'rtl' : undefined}
    >
      <h1 className="mb-5 text-2xl font-semibold">{course.topic}</h1>
      {reference.phase === 'concept' && (
        <section className="space-y-4">
          <p className="whitespace-pre-wrap leading-relaxed">{teaching.overview}</p>
          <h2 className="font-medium">{T.objectives}</h2>
          <ul className="list-inside list-disc">
            {course.lessonPlan.objectives.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          <h2 className="font-medium">{T.knowledge}</h2>
          <ul className="list-inside list-disc">
            {course.lessonPlan.knowledgePoints.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      {reference.phase === 'demo' && (
        <section className="space-y-4">
          <p className="whitespace-pre-wrap leading-relaxed">{teaching.demoExplanation}</p>
          {course.requiresLab && (
            <>
              <div className="flex flex-wrap gap-3">
                {course.scenes[0].problem.publicTestCases.map((item, i) => (
                  <button
                    key={item.caseId}
                    aria-pressed={selected === i}
                    onClick={() => setSelected(i)}
                    className={`rounded-lg border p-3 ${selected === i ? 'bg-muted' : ''}`}
                  >
                    {item.description}
                  </button>
                ))}
              </div>
              {example && (
                <div className="grid gap-4 md:grid-cols-2">
                  <section className="rounded-lg border p-4">
                    <h2>{T.input}</h2>
                    <pre className="mt-2 overflow-auto">
                      {JSON.stringify(example.inputs, null, 2)}
                    </pre>
                  </section>
                  <section className="rounded-lg border p-4">
                    <h2>{T.expectedOutput}</h2>
                    <pre className="mt-2 overflow-auto">
                      {JSON.stringify(example.expected, null, 2)}
                    </pre>
                  </section>
                </div>
              )}
              {example && <InputVisualization key={example.caseId} inputs={example.inputs} />}
              <p className="text-sm text-muted-foreground">{T.demoNote}</p>
            </>
          )}
        </section>
      )}
      {scene && (
        <div className="space-y-5">
          <h2 className="text-xl font-semibold">{scene.problem.title}</h2>
          <p className="whitespace-pre-wrap">
            {scene.sceneType === 'guided-lab'
              ? scene.problem.instructions.replace(/应用场景\s*[：:]\s*/g, '')
              : scene.problem.instructions}
          </p>
          <ul className="list-inside list-disc text-sm">
            {scene.problem.constraints.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          <section className="rounded-lg border p-4">
            <h2 className="font-semibold">
              {scene.problem.executionMode === 'stdio' ? T.stdioSpec : T.entrySpec}
            </h2>
            {scene.problem.executionMode === 'stdio' ? (
              <p className="mt-2 text-sm">{T.stdioRule}</p>
            ) : (
              <p className="mt-2 text-sm">
                {T.entryRule(
                  scene.problem.entryPoint.className,
                  scene.problem.entryPoint.methodName,
                  scene.problem.entryPoint.parameters
                    .map((item) => `${item.name}: ${item.type}`)
                    .join(T.paramJoin),
                  scene.problem.entryPoint.returnType,
                )}
              </p>
            )}
            {scene.sceneType === 'oj-lab' && <p className="mt-2 text-sm">{T.transfer}</p>}
          </section>
          {scene.sceneType === 'guided-lab' && (
            <ol className="space-y-3">
              {scene.teachingSteps.map((step) => (
                <li key={step.stepId} className="rounded-lg border p-3">
                  <h2 className="font-medium">{step.title}</h2>
                  <p>{step.instruction}</p>
                  <p className="text-sm text-muted-foreground">
                    {T.hint}
                    {step.hint}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <LabBoundary>
            <LabPractice scene={scene} />
          </LabBoundary>
          <NotebookExport courseId={course.courseId} sceneType={scene.sceneType} hasLab />
        </div>
      )}
      {reference.phase === 'review' && review && (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{T.conceptQuiz}</h2>
          <p>{review.quiz ? T.quizScore(review.quiz.correct, review.quiz.total) : T.noQuiz}</p>
          {review.quizStatus === 'content-changed' && (
            <p className="text-sm text-muted-foreground">{T.quizChanged}</p>
          )}
          {review.quiz?.wrongTopics.map((item, i) => (
            <p key={i}>
              {T.toReview}
              {item}
            </p>
          ))}
          <h2 className="text-lg font-medium">{T.savedAnswers}</h2>
          {review.drafts.map((draft) => (
            <p key={draft.sceneId}>
              {draft.sceneType === 'guided-lab' ? T.guided : T.independent} ·{' '}
              {draft.revision ? T.revision(draft.revision) : T.notSaved}
            </p>
          ))}
          <h2 className="text-lg font-medium">{T.recentRecords}</h2>
          <p className="text-sm text-muted-foreground">{T.recordNote}</p>
          {!review.events.length && <p>{T.noRecords}</p>}
          {review.events.map((event) => (
            <div key={event.eventId} className="rounded-lg border p-3 text-sm">
              <p>
                {new Date(event.createdAt).toLocaleString()} ·{' '}
                {event.status === 'completed'
                  ? T.passedOf(event.passed, event.total)
                  : event.status === 'stopped'
                    ? T.stopped
                    : T.failed}
              </p>
              {event.message && <p>{event.message}</p>}
            </div>
          ))}
          <a
            className="inline-block rounded-lg border px-4 py-2"
            href={`/api/eduplus/courses/${encodeURIComponent(course.courseId)}/review?format=markdown`}
          >
            {T.downloadReport}
          </a>
          <h2 className="text-lg font-medium">{T.dialogue}</h2>
          <p className="text-sm text-muted-foreground">{T.dialogueNote}</p>
          {!review.dialogue.length && <p>{T.noDialogue}</p>}
          {review.dialogue.map((message) => (
            <div key={message.id} className="rounded-lg border p-3">
              <h3 className="text-sm font-medium">{message.sender}</h3>
              <p className="whitespace-pre-wrap text-sm">{message.text}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
