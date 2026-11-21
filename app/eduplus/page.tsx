'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { NotebookExport } from '@/components/eduplus/notebook-export';
import { LabPractice } from '@/components/eduplus/lab-practice';
import { LabBoundary } from '@/components/eduplus/lab-boundary';
import { ClassroomLaunch } from '@/components/eduplus/classroom-launch';
import type { PublicCourse } from '@/lib/types/eduplus.generated';

async function readResponse(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `请求失败（${response.status}）`);
  return body;
}

export default function EduplusPage() {
  const [prompt, setPrompt] = useState('Python 列表求和编程实验，空列表返回 0');
  const [course, setCourse] = useState<PublicCourse | null>(null);
  const [courses, setCourses] = useState<PublicCourse[]>([]);
  const [sceneType, setSceneType] = useState<'guided-lab' | 'oj-lab'>('guided-lab');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const unsaved = useRef(false);
  const trackDirty = useCallback((dirty: boolean) => {
    unsaved.current = dirty;
  }, []);
  function mayLeaveLab() {
    return !unsaved.current || window.confirm('实验代码尚未保存，确定离开当前实验？');
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/eduplus/courses', { signal: controller.signal })
      .then(readResponse)
      .then((body) =>
        setCourses((previous) =>
          [
            ...previous,
            ...body.courses.filter(
              (item: PublicCourse) => !previous.some((saved) => saved.courseId === item.courseId),
            ),
          ].slice(0, 50),
        ),
      )
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, []);
  async function load(courseId: string) {
    if (!mayLeaveLab()) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setError('');
    setPending(true);
    try {
      const next = await readResponse(
        await fetch(`/api/eduplus/courses/${encodeURIComponent(courseId)}`, {
          signal: controller.signal,
        }),
      );
      if (!controller.signal.aborted) {
        setCourse(next);
        unsaved.current = false;
        setSceneType('guided-lab');
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '读取失败');
    } finally {
      if (active.current === controller) setPending(false);
    }
  }
  async function generate() {
    if (!mayLeaveLab()) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError('');
    try {
      const next = (await readResponse(
        await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
          signal: controller.signal,
        }),
      )) as PublicCourse;
      if (!controller.signal.aborted) {
        setCourse(next);
        unsaved.current = false;
        setSceneType('guided-lab');
        setCourses((previous) =>
          [next, ...previous.filter((item) => item.courseId !== next.courseId)].slice(0, 50),
        );
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '生成失败');
    } finally {
      if (active.current === controller) setPending(false);
    }
  }
  const scene = course?.scenes.find((item) => item.sceneType === sceneType);
  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6 text-foreground">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">实验资产接口诊断（开发用）</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            日常学习请从首页创建课程。Lab
            会嵌入原生课堂的讲解、模拟器和游戏之后；本页只用于检查实验资产接口。
          </p>
        </div>
        <Link
          href="/"
          className="text-sm underline"
          onClick={(event) => {
            if (!mayLeaveLab()) event.preventDefault();
          }}
        >
          返回 OpenMAIC
        </Link>
      </header>
      <div className="grid gap-8 md:grid-cols-[260px_1fr]">
        <aside>
          <h2 className="mb-3 font-semibold">已保存课程</h2>
          <p className="mb-3 text-xs text-muted-foreground">显示最近 50 门课程</p>
          {courses.length === 0 && (
            <p className="text-sm text-muted-foreground">生成成功后，课程会保存在这里。</p>
          )}
          {courses.map((item) => (
            <button
              key={item.courseId}
              onClick={() => load(item.courseId)}
              className="mb-2 block w-full rounded-lg border p-3 text-left text-sm hover:bg-muted"
            >
              {item.lessonPlan.title}
            </button>
          ))}
        </aside>
        <section>
          <label htmlFor="eduplus-prompt" className="mb-2 block font-medium">
            教学需求
          </label>
          <textarea
            id="eduplus-prompt"
            maxLength={12000}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="min-h-28 w-full rounded-lg border bg-background p-3"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={generate}
              disabled={pending || !prompt.trim()}
              className="rounded-lg bg-primary px-5 py-2 text-white disabled:opacity-50"
            >
              {pending ? '正在处理…' : '生成并保存课程'}
            </button>
            {pending && (
              <button
                onClick={() => {
                  active.current?.abort();
                  setPending(false);
                }}
                className="text-sm underline"
              >
                取消
              </button>
            )}
          </div>
          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-red-300 p-3 text-sm text-red-600"
            >
              {error}
            </p>
          )}
          {course && (
            <article className="mt-8 space-y-5">
              <h2 className="text-xl font-semibold">{course.lessonPlan.title}</h2>
              <ClassroomLaunch
                key={course.courseId}
                courseId={course.courseId}
                mayLeave={mayLeaveLab}
              />
              <section>
                <h3 className="font-medium">教学目标</h3>
                <ul className="list-inside list-disc">
                  {course.lessonPlan.objectives.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="font-medium">知识点</h3>
                <ul className="list-inside list-disc">
                  {course.lessonPlan.knowledgePoints.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </section>
              {course.requiresLab && (
                <div className="flex gap-3">
                  {(['guided-lab', 'oj-lab'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        if (type === sceneType || mayLeaveLab()) {
                          unsaved.current = false;
                          setSceneType(type);
                        }
                      }}
                      aria-pressed={sceneType === type}
                      className={`rounded-lg border px-4 py-2 ${sceneType === type ? 'bg-muted font-semibold' : ''}`}
                    >
                      {type === 'guided-lab' ? '引导实验' : 'OJ 练习'}
                    </button>
                  ))}
                </div>
              )}
              {scene && (
                <>
                  <p className="whitespace-pre-wrap">{scene.problem.instructions}</p>
                  {scene.sceneType === 'guided-lab' && (
                    <section>
                      <h3 className="mb-2 font-medium">分步任务</h3>
                      <ol className="space-y-3">
                        {scene.teachingSteps.map((step, index) => (
                          <li key={step.stepId} className="rounded-lg border p-3">
                            <p className="font-medium">
                              {index + 1}. {step.title}
                            </p>
                            <p className="mt-1 text-sm">{step.instruction}</p>
                            {step.hint && (
                              <p className="mt-1 text-sm text-muted-foreground">
                                提示：{step.hint}
                              </p>
                            )}
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}
                  <LabBoundary key={`${scene.sceneId}:${scene.problem.problemVersion}`}>
                    <LabPractice scene={scene} onDirtyChange={trackDirty} />
                  </LabBoundary>
                  <section>
                    <h3 className="mb-2 font-medium">公开示例</h3>
                    <div className="space-y-2">
                      {scene.problem.publicTestCases.map((test) => (
                        <div key={test.caseId} className="rounded-lg border p-3">
                          <p className="text-sm">{test.description}</p>
                          <pre className="mt-2 overflow-x-auto text-xs">
                            {JSON.stringify(
                              { inputs: test.inputs, expected: test.expected },
                              null,
                              2,
                            )}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
              {!course.requiresLab && (
                <ul>
                  {course.commonMistakes.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              )}
              <NotebookExport
                key={`${course.courseId}:${sceneType}`}
                courseId={course.courseId}
                sceneType={sceneType}
                hasLab={course.requiresLab}
              />
            </article>
          )}
        </section>
      </div>
    </main>
  );
}
