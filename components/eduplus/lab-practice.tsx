'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BrowserPracticeRunner,
  makeDebugProblem,
  formatStdioOutput,
} from '@/lib/eduplus/practice-runner';
import type { LabScene, PracticeResult, StudentDraft } from '@/lib/types/eduplus-practice';
import { PythonEditor } from './python-editor';
import { publicAssertions } from '@/lib/eduplus/public-assertions';
import { verifyAnswer } from '@/lib/eduplus/answer-verifier';
import type { JsonValue } from '@/lib/types/eduplus.generated';
import { useCourseLanguage } from '@/lib/eduplus/use-course-language';
import { labText } from '@/lib/eduplus/lab-text';

/** The verdict of a custom run against the reference solution's output on the same input. */
type CustomVerdict =
  | { state: 'checking' }
  | { state: 'correct' }
  | { state: 'wrong'; expected: string }
  | { state: 'unavailable'; message: string };

const shown = (value: JsonValue) => (typeof value === 'string' ? value : JSON.stringify(value));
import type { PracticeEventInput } from '@/lib/types/eduplus-learning';

// Ephemeral buffers survive native scene switches. Restore only AFTER an authorized server read.
// They are not durable browser storage, and never replace a newer server revision silently.
const buffers = new Map<string, { code: string; baseline: StudentDraft }>();

async function readDraft(response: Response, L: ReturnType<typeof labText>): Promise<StudentDraft> {
  const data = await response.json();
  if (!response.ok)
    throw new Error(`${L.draftRequestFailed}${data.error?.code ? ` [${data.error.code}]` : ''}`);
  if (typeof data.code !== 'string' || !Number.isSafeInteger(data.revision) || data.revision < 0)
    throw new Error(L.draftInvalid);
  return data;
}
export function LabPractice({
  scene,
  onDirtyChange,
}: {
  scene: LabScene;
  onDirtyChange?(dirty: boolean): void;
}) {
  const stdio = scene.problem.executionMode === 'stdio';
  const L = labText(useCourseLanguage());
  const [code, setCode] = useState(scene.interactiveCode);
  const [draft, setDraft] = useState<StudentDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'running'>('idle');
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [suiteResult, setSuiteResult] = useState<PracticeResult | null>(null);
  const [runKind, setRunKind] = useState<'tests' | 'debug'>('tests');
  const [debugInput, setDebugInput] = useState(() =>
    stdio
      ? String(scene.problem.publicTestCases[0]?.inputs.stdin ?? '')
      : JSON.stringify(scene.problem.publicTestCases[0]?.inputs ?? {}, null, 2),
  );
  const [runError, setRunError] = useState('');
  const [verdict, setVerdict] = useState<CustomVerdict | null>(null);
  const [debugError, setDebugError] = useState('');
  const [recordError, setRecordError] = useState('');
  const runner = useRef<BrowserPracticeRunner | null>(null);
  const activeFetch = useRef<AbortController | null>(null);
  const execution = useRef(0);
  const mounted = useRef(false);
  const url = `/api/eduplus/courses/${encodeURIComponent(scene.courseId)}/drafts/${encodeURIComponent(scene.sceneId)}`;
  const dirty = code !== (draft?.code ?? scene.interactiveCode);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!draft) return;
    if (code !== draft.code) buffers.set(url, { code, baseline: draft });
    else buffers.delete(url);
  }, [code, draft, url]);
  const load = useCallback(
    async (restoreBuffer = false) => {
      activeFetch.current?.abort();
      const controller = new AbortController();
      activeFetch.current = controller;
      setLoading(true);
      setDraftError('');
      try {
        const next = await readDraft(await fetch(url, { signal: controller.signal }), L);
        if (controller.signal.aborted) return;
        if (next.sceneId !== scene.sceneId || next.problemVersion !== scene.problem.problemVersion)
          throw new Error(L.draftMismatch);
        if (next.revision === 0) next.code = scene.interactiveCode;
        const buffer = restoreBuffer ? buffers.get(url) : undefined;
        if (buffer && buffer.code !== next.code) {
          setDraft(buffer.baseline);
          setCode(buffer.code);
          if (buffer.baseline.revision !== next.revision) setDraftError(L.draftConflict);
        } else {
          setDraft(next);
          setCode(next.code);
        }
        setResult(null);
        setSuiteResult(null);
        setRunError('');
        setDebugError('');
      } catch (error) {
        if (!controller.signal.aborted)
          setDraftError(error instanceof Error ? error.message : L.draftReadFailed);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- L only changes the wording
    [url, scene.sceneId, scene.problem.problemVersion],
  );
  useEffect(() => {
    mounted.current = true;
    runner.current = new BrowserPracticeRunner();
    const executions = execution;
    let disposed = false;
    void Promise.resolve().then(() => {
      if (!disposed) return load(true);
    });
    return () => {
      disposed = true;
      mounted.current = false;
      executions.current++;
      activeFetch.current?.abort();
      runner.current?.cancel();
    };
  }, [load]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function save() {
    if (!draft || saving || loading) return;
    const snapshot = code;
    const controller = new AbortController();
    activeFetch.current = controller;
    setSaving(true);
    setDraftError('');
    try {
      const next = await readDraft(
        await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            code: snapshot,
            revision: draft.revision,
            problemVersion: draft.problemVersion,
          }),
        }),
        L,
      );
      if (!controller.signal.aborted) setDraft(next); // Do not replace code typed during an in-flight save.
    } catch (error) {
      if (!controller.signal.aborted)
        setDraftError(error instanceof Error ? error.message : L.saveFailed);
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }
  /** Compare a custom run's output with the reference output for the same input. */
  async function judgeCustom(problem: typeof scene.problem, actual: JsonValue, id: number) {
    const inputs = problem.publicTestCases[0]?.inputs as Record<string, JsonValue> | undefined;
    if (!inputs) return;
    setVerdict({ state: 'checking' });
    try {
      const response = await fetch(
        `/api/eduplus/courses/${encodeURIComponent(scene.courseId)}/reference-output`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sceneId: scene.sceneId,
            problemVersion: scene.problem.problemVersion,
            inputs,
          }),
          signal: AbortSignal.timeout(60000),
        },
      );
      const data = await response.json();
      if (!mounted.current || execution.current !== id) return;
      if (!response.ok)
        throw new Error(`${L.referenceFailed}${data.error?.code ? ` [${data.error.code}]` : ''}`);
      if ('unavailable' in data) {
        setVerdict({ state: 'unavailable', message: L.verdictUnavailable });
        return;
      }
      const check = verifyAnswer(scene.problem, inputs, actual, data.expected as JsonValue);
      setVerdict(
        check.passed
          ? { state: 'correct' }
          : { state: 'wrong', expected: shown(data.expected as JsonValue) },
      );
    } catch (error) {
      if (mounted.current && execution.current === id)
        setVerdict({
          state: 'unavailable',
          message: error instanceof Error ? error.message : L.verdictUnavailable,
        });
    }
  }
  // The same correctness verdict for a custom run in both Labs (guided and independent).
  const verdictBox = result && !result.cases[0]?.error && verdict && (
    <div
      role="status"
      className={
        verdict.state === 'correct'
          ? 'rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-700'
          : verdict.state === 'wrong'
            ? 'rounded-lg border border-red-300 bg-red-50 p-3 text-red-700'
            : 'rounded-lg border p-3 text-muted-foreground'
      }
    >
      {verdict.state === 'checking' && L.checking}
      {verdict.state === 'correct' && L.correct}
      {verdict.state === 'wrong' && (
        <>
          <p className="font-semibold">{L.wrong}</p>
          <p className="mt-1 text-sm">{L.referenceOutput}</p>
          <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-sm">
            {verdict.expected}
          </pre>
        </>
      )}
      {verdict.state === 'unavailable' && verdict.message}
    </div>
  );
  function stop() {
    execution.current++;
    runner.current?.cancel();
    setStatus('idle');
  }
  async function run(kind: 'tests' | 'debug' = 'tests') {
    let problem = scene.problem;
    try {
      if (kind === 'debug') problem = makeDebugProblem(scene.problem, debugInput, undefined, true);
    } catch (error) {
      setDebugError(error instanceof Error ? error.message : L.customInvalid);
      return;
    }
    setRunKind(kind);
    const id = ++execution.current;
    const eventId = crypto.randomUUID();
    const revision = draft && draft.revision > 0 && draft.code === code ? draft.revision : null;
    const record = (status: PracticeEventInput['status'], passed = 0, total = 0, message = '') => {
      const input: PracticeEventInput = {
        eventId,
        sceneId: scene.sceneId,
        problemVersion: scene.problem.problemVersion,
        status,
        passed,
        total,
        message: message.slice(0, 1000),
        draftRevision: revision,
      };
      void fetch(`/api/eduplus/courses/${encodeURIComponent(scene.courseId)}/practice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        keepalive: true,
        signal: AbortSignal.timeout(15000),
      })
        .then(async (response) => {
          if (!response.ok) {
            const body = await response.json();
            throw new Error(`${L.recordFailed}${body.error?.code ? ` [${body.error.code}]` : ''}`);
          }
        })
        .catch((error) => {
          if (mounted.current)
            setRecordError(error instanceof Error ? error.message : L.recordFailed);
        });
    };
    if (kind === 'tests') {
      setRecordError('');
      setSuiteResult(null);
      setRunError('');
    } else {
      setResult(null);
      setDebugError('');
      setVerdict(null);
    }
    try {
      const onStatus = (nextStatus: 'loading' | 'running') => {
        if (mounted.current && execution.current === id) setStatus(nextStatus);
      };
      const next = await runner.current!.run(code, problem, onStatus, kind === 'tests');
      if (!mounted.current || execution.current !== id) return;
      if (kind === 'tests') {
        setSuiteResult(next);
        record('completed', next.cases.filter((item) => item.passed).length, next.cases.length);
      } else {
        setResult(next);
        const item = next.cases[0];
        if (item && !item.error) void judgeCustom(problem, item.actual as JsonValue, id);
      }
    } catch (error) {
      const stopped = error instanceof DOMException && error.name === 'AbortError';
      if (kind === 'tests')
        record(
          stopped ? 'stopped' : 'error',
          0,
          0,
          stopped ? L.runStopped : error instanceof Error ? error.message : L.runFailed,
        );
      if (
        mounted.current &&
        execution.current === id &&
        !(error instanceof DOMException && error.name === 'AbortError')
      )
        (kind === 'debug' ? setDebugError : setRunError)(
          error instanceof Error ? error.message : L.runFailedSentence,
        );
    } finally {
      if (mounted.current && execution.current === id) setStatus('idle');
    }
  }
  return (
    <section className="space-y-3 rounded-xl border p-4" data-native-keyboard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex flex-wrap items-center gap-2 font-medium">
          {L.workspace}
          {/* The sandbox runs Python only; say so instead of surprising a C++/Java learner. */}
          <span
            className="rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground"
            title={L.pythonOnlyTitle}
          >
            {L.pythonOnly}
          </span>
        </h3>
        <span aria-live="polite" className="text-xs text-muted-foreground">
          {loading
            ? L.draftLoading
            : saving
              ? L.saving
              : !draft
                ? L.draftNotLoaded
                : dirty
                  ? L.unsaved
                  : draft.revision
                    ? L.saved(draft.revision)
                    : L.template}
        </span>
      </div>
      {suiteResult && (
        <p role="status" className="font-semibold">
          {L.passedOf(
            suiteResult.cases.filter((item) => item.passed).length,
            suiteResult.cases.length,
          )}
        </p>
      )}
      <PythonEditor
        value={code}
        onChange={(next) => {
          setCode(next);
          setResult(null);
          setVerdict(null);
          setSuiteResult(null);
          setRunError('');
          setDebugError('');
        }}
        disabled={loading || status !== 'idle'}
      />
      {stdio && (
        <section className="space-y-3 rounded-lg border p-4" aria-label={L.stdioArea}>
          <h4 className="font-semibold">{L.stdioTitle}</h4>
          <p className="text-sm text-muted-foreground">{L.stdioHint}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              {L.input}
              <textarea
                aria-label={L.stdin}
                className="min-h-36 w-full rounded border bg-background p-3 font-mono text-sm"
                value={debugInput}
                maxLength={12000}
                disabled={status !== 'idle'}
                onChange={(event) => {
                  setDebugInput(event.target.value);
                  setResult(null);
                  setDebugError('');
                  setVerdict(null);
                }}
              />
            </label>
            <label className="space-y-2">
              {L.output}
              <textarea
                aria-label={L.stdout}
                readOnly
                className="min-h-36 w-full rounded border bg-muted p-3 font-mono text-sm"
                value={formatStdioOutput(scene.problem, debugInput, result, debugError, true)}
              />
            </label>
          </div>
          <button
            className="rounded-lg bg-primary px-4 py-2 text-white disabled:opacity-50"
            disabled={loading || status !== 'idle'}
            onClick={() => void run('debug')}
          >
            {L.runCode}
          </button>
          {result?.cases[0]?.error && (
            <p role="status" className="text-red-600">
              {result.cases[0]?.verdict}
            </p>
          )}
          {verdictBox}
        </section>
      )}
      <section
        className="rounded-lg border p-4"
        aria-label={stdio ? L.publicStdio : L.publicAssert}
      >
        <h4 className="font-semibold">
          {stdio ? L.publicStdio : L.publicAssert}
          {L.items(scene.problem.publicTestCases.length)}
        </h4>
        <p className="my-2 text-xs text-muted-foreground">{L.assertHint}</p>
        {scene.problem.publicTestCases.map((test, index) => (
          <div key={test.caseId} className="my-3 rounded bg-muted p-3 text-sm">
            <p>{test.description}</p>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap">
              {stdio
                ? L.sample(String(test.inputs.stdin), String(test.expected))
                : publicAssertions(scene.problem)[index]}
            </pre>
            {stdio && (
              <button
                className="mt-2 underline"
                onClick={() => {
                  setDebugInput(String(test.inputs.stdin));
                  setResult(null);
                  setDebugError('');
                }}
              >
                {L.useSample}
              </button>
            )}
          </div>
        ))}
      </section>
      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-lg bg-primary px-4 py-2 text-white disabled:opacity-50"
          disabled={loading || status !== 'idle'}
          onClick={() => void run()}
        >
          {L.runPublic}
        </button>
        {status !== 'idle' && (
          <button className="rounded-lg border px-4 py-2" onClick={stop}>
            {L.stop}
          </button>
        )}
        <button
          className="rounded-lg border px-4 py-2 disabled:opacity-50"
          disabled={!draft || saving || loading || !dirty}
          onClick={save}
        >
          {L.saveDraft}
        </button>
        <button
          className="text-sm underline"
          disabled={saving || loading || status !== 'idle'}
          onClick={() => {
            if (dirty && !window.confirm(L.reloadConfirm)) return;
            void load();
          }}
        >
          {L.reload}
        </button>
        <button
          className="text-sm underline"
          disabled={loading || status !== 'idle'}
          onClick={() => {
            if (code !== scene.interactiveCode && !window.confirm(L.resetConfirm)) return;
            setCode(scene.interactiveCode);
            setResult(null);
            setSuiteResult(null);
            setRunError('');
            setDebugError('');
          }}
        >
          {L.reset}
        </button>
        <button
          className="text-sm underline"
          onClick={() => {
            stop();
            setResult(null);
            setSuiteResult(null);
            setRunError('');
            setDebugError('');
          }}
        >
          {L.clear}
        </button>
      </div>
      {draftError && (
        <p role="alert" className="text-sm text-red-600">
          {draftError} {L.editKept}
        </p>
      )}
      <p aria-live="polite" className="text-sm">
        {status === 'loading'
          ? L.initPython
          : status === 'running'
            ? runKind === 'debug'
              ? L.runningCustom
              : L.runningPublic
            : ''}
      </p>
      {runError && (
        <p role="alert" className="text-sm text-red-600">
          {runError}
        </p>
      )}
      {recordError && (
        <p role="alert" className="text-sm text-red-600">
          {recordError} {L.recordKept}
        </p>
      )}
      {!stdio && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">{L.customDebug}</summary>
          <p className="my-2 text-xs text-muted-foreground">{L.customHint}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              {L.input}
              <textarea
                aria-label={L.customInput}
                className="min-h-20 w-full rounded border bg-background p-2 font-mono text-sm"
                value={debugInput}
                maxLength={12000}
                disabled={status !== 'idle'}
                onChange={(event) => {
                  setDebugInput(event.target.value);
                  setResult(null);
                  setDebugError('');
                  setVerdict(null);
                }}
              />
            </label>
            <label className="space-y-2">
              {L.output}
              <textarea
                aria-label={L.customOutput}
                readOnly
                className="min-h-20 w-full rounded border bg-muted p-2 font-mono text-sm"
                value={
                  debugError ||
                  result?.cases[0]?.error ||
                  (result
                    ? JSON.stringify(result.cases[0]?.actual) +
                      (result.output ? `\n${result.output}` : '')
                    : '')
                }
              />
            </label>
          </div>
          <button
            className="mt-2 rounded border px-4 py-2 disabled:opacity-50"
            disabled={loading || status !== 'idle'}
            onClick={() => void run('debug')}
          >
            {L.runCustom}
          </button>
          {result?.cases[0]?.error && (
            <p role="status" className="mt-2 text-red-600">
              {result.cases[0]?.verdict}
            </p>
          )}
          <div className="mt-2">{verdictBox}</div>
        </details>
      )}
      {suiteResult && (
        <div className="space-y-2" aria-label={L.publicResults} aria-live="polite">
          <p className="font-medium">
            {L.passedOf(
              suiteResult.cases.filter((item) => item.passed).length,
              suiteResult.cases.length,
            )}
          </p>
          {suiteResult.cases.map((item, index) => (
            <div key={item.caseId} className="rounded-lg bg-muted p-3 text-sm">
              <p className={item.passed ? 'text-green-600' : 'text-red-600'}>
                {item.passed ? L.pass : L.fail} · {item.verdict} ·{' '}
                {scene.problem.publicTestCases[index].description}
              </p>
              {item.error ? (
                <pre className="whitespace-pre-wrap">{item.error}</pre>
              ) : (
                <pre className="overflow-auto whitespace-pre-wrap">
                  {L.actual}
                  {stdio && typeof item.actual === 'string'
                    ? item.actual
                    : JSON.stringify(item.actual)}
                </pre>
              )}
              {!item.passed && (
                <pre className="overflow-auto whitespace-pre-wrap">
                  {L.expected}
                  {typeof scene.problem.publicTestCases[index].expected === 'string'
                    ? scene.problem.publicTestCases[index].expected
                    : JSON.stringify(scene.problem.publicTestCases[index].expected)}
                </pre>
              )}
            </div>
          ))}
          {suiteResult.output && (
            <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs">
              {suiteResult.output}
            </pre>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{L.footer}</p>
    </section>
  );
}
