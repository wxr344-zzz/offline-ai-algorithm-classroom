'use client';

import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import type {
  SimulationProfile,
  SimulationReference,
  SimulationTrace,
  TraceEdge,
  TraceValue,
  TraceView,
} from '@/lib/eduplus/simulation-contract';
import styles from './exam-simulator.module.css';
import { useCourseLanguage } from '@/lib/eduplus/use-course-language';
import {
  contentLanguageTag,
  isChineseContent,
  simulatorText,
  type SimulatorText,
} from '@/lib/eduplus/content-language';

// Platform text of the simulator follows the course language, not the UI language.
const TextContext = createContext<SimulatorText>(simulatorText('zh-CN'));

function Value({ value }: { value: TraceValue | undefined }) {
  if (value === null || value === undefined) return <span className={styles.empty}>∅</span>;
  if (Array.isArray(value))
    return (
      <span className={styles.tuple}>
        [{' '}
        {value.map((v, i) => (
          <span key={i}>
            <Value value={v} />
            {i < value.length - 1 ? ', ' : ''}
          </span>
        ))}{' '}
        ]
      </span>
    );
  if (typeof value === 'object')
    return (
      <span className={styles.record}>
        {Object.entries(value).map(([k, v]) => (
          <span key={k}>
            <b>{k}:</b> <Value value={v} />
          </span>
        ))}
      </span>
    );
  return <>{String(value)}</>;
}

function ResultValue({ value }: { value: TraceValue }) {
  if (Array.isArray(value) && value.length > 0 && value.every(Array.isArray))
    return (
      <div className={styles.scroll}>
        <table>
          <tbody>
            {(value as TraceValue[][]).map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>
                    <Value value={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if (value && !Array.isArray(value) && typeof value === 'object')
    return (
      <div className={styles.record}>
        {Object.entries(value).map(([key, child]) => (
          <div key={key}>
            <b>{key}</b>
            <ResultValue value={child} />
          </div>
        ))}
      </div>
    );
  return <Value value={value} />;
}

/** Keep operators like "j--" on one line (a hyphen is otherwise a line-break point). */
function unbroken(text: string): string {
  return text.replace(/--/g, '\u2011\u2011');
}

export function Topology({ view }: { view: Extract<TraceView, { kind: 'tree' | 'graph' }> }) {
  const text = useContext(TextContext);
  const arrowId = useId().replace(/:/g, '');
  const positions = new Map<string, { x: number; y: number }>();
  const nodeHeight = (id: string) =>
    Math.max(50, (view.nodes.find((n) => n.id === id)?.label.split('\n').length ?? 1) * 20 + 10);
  const levelGap = Math.max(50, ...view.nodes.map((n) => nodeHeight(n.id))) + 70;
  let width = 900,
    height = 360;
  if (view.kind === 'graph') {
    view.nodes.forEach((n, i) => {
      const a = (i / Math.max(1, view.nodes.length)) * 2 * Math.PI - Math.PI / 2;
      positions.set(n.id, { x: 450 + 270 * Math.cos(a), y: 190 + 130 * Math.sin(a) });
    });
  } else {
    const children = new Map<string, string[]>(),
      incoming = new Set<string>();
    for (const e of view.edges.filter((e) => e.kind !== 'thread')) {
      children.set(e.source, [...(children.get(e.source) ?? []), e.target]);
      incoming.add(e.target);
    }
    let cursor = 0,
      maxDepth = 0;
    const placed = new Set<string>();
    const walk = (id: string, depth: number): number => {
      if (placed.has(id)) return positions.get(id)?.x ?? 0;
      placed.add(id);
      maxDepth = Math.max(maxDepth, depth);
      const kids = (children.get(id) ?? []).filter((x) => !placed.has(x));
      const xs = kids.map((x) => walk(x, depth + 1));
      const x = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : 80 + cursor++ * 145;
      positions.set(id, { x, y: levelGap / 2 + depth * levelGap });
      return x;
    };
    const roots = view.nodes.filter((n) => !incoming.has(n.id));
    roots.forEach((n) => walk(n.id, 0));
    view.nodes.forEach((n) => {
      if (!placed.has(n.id)) walk(n.id, 0);
    });
    width = Math.max(900, cursor * 145 + 30);
    height = Math.max(200, (maxDepth + 1) * levelGap);
    if (view.edges.some((e) => e.kind === 'thread')) height += 40;
    const xs = [...positions.values()].map((p) => p.x);
    const shift = xs.length ? (width - Math.max(...xs) - Math.min(...xs)) / 2 : 0;
    positions.forEach((p) => {
      p.x += shift;
    });
  }
  const edge = (e: TraceEdge, i: number) => {
    const s = positions.get(e.source),
      dest = positions.get(e.target);
    if (!s || !dest) return null;
    const thread = e.kind === 'thread',
      selected = e.mark === 'selected';
    const dx = dest.x - s.x,
      dy = dest.y - s.y;
    const clipStart = Math.min(
      58 / Math.max(Math.abs(dx), 0.001),
      nodeHeight(e.source) / 2 / Math.max(Math.abs(dy), 0.001),
    );
    const clipEnd = Math.min(
      58 / Math.max(Math.abs(dx), 0.001),
      nodeHeight(e.target) / 2 / Math.max(Math.abs(dy), 0.001),
    );
    const verticalThread = thread && Math.abs(dx) < 40;
    const self = e.source === e.target,
      sign = s.y > height / 2 ? -1 : 1;
    const path = self
      ? `M${s.x + 45},${s.y + sign * 20} C${s.x + 120},${s.y + sign * 100} ${s.x - 120},${s.y + sign * 100} ${s.x - 45},${s.y + sign * 20}`
      : thread
        ? `M${s.x},${s.y + 25} Q${verticalThread ? s.x + 120 : (s.x + dest.x) / 2},${verticalThread ? (s.y + dest.y) / 2 : Math.max(s.y, dest.y) + 85} ${dest.x},${dest.y + 30}`
        : `M${s.x + dx * clipStart},${s.y + dy * clipStart} L${dest.x - dx * clipEnd},${dest.y - dy * clipEnd}`;
    return (
      <g key={i}>
        <path
          d={path}
          fill="none"
          stroke={selected ? '#15803d' : thread ? '#c16913' : '#94a3b8'}
          strokeWidth={selected ? 4 : 2}
          strokeDasharray={thread ? '6 4' : undefined}
          markerEnd={e.directed === false ? undefined : `url(#${arrowId})`}
        />
        <text
          x={self ? s.x : verticalThread ? s.x + 75 : (s.x + dest.x) / 2 + 8}
          y={
            self
              ? s.y + sign * 85
              : thread && !verticalThread
                ? Math.max(s.y, dest.y) + 65
                : (s.y + dy * clipStart + dest.y - dy * clipEnd) / 2 + 5
          }
          fontSize="14"
          fill="#334155"
          stroke="white"
          strokeWidth="4"
          paintOrder="stroke"
        >
          {e.label}
        </text>
      </g>
    );
  };
  return (
    <div className={styles.topology}>
      <svg
        role="img"
        aria-label={view.name}
        viewBox={`0 0 ${width} ${height}`}
        style={{ minWidth: width > 1100 ? width : undefined, width: '100%', minHeight: 240 }}
      >
        <defs>
          <marker id={arrowId} markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8" fill="#64748b" />
          </marker>
        </defs>
        {view.edges.map(edge)}
        {view.nodes.map((n) => {
          const p = positions.get(n.id)!;
          const lines = n.label.split('\n');
          const fill =
            n.mark === 'pruned'
              ? '#fee2e2'
              : n.mark === 'active'
                ? '#ddd6fe'
                : n.mark === 'done'
                  ? '#dcfce7'
                  : n.color === 'red'
                    ? '#fecaca'
                    : n.color === 'black'
                      ? '#334155'
                      : '#fff';
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`}>
              <rect
                x="-58"
                y={-nodeHeight(n.id) / 2}
                rx="10"
                width="116"
                height={Math.max(50, lines.length * 20 + 10)}
                fill={fill}
                stroke={n.mark === 'active' ? '#7c3aed' : '#64748b'}
                strokeWidth="2"
              />
              {lines.map((line, j) => (
                <text
                  key={j}
                  textAnchor="middle"
                  y={5 - (lines.length - 1) * 10 + j * 20}
                  fontSize="14"
                  fill={n.color === 'black' && !n.mark ? 'white' : '#0f172a'}
                >
                  {line}
                </text>
              ))}
              {n.mark === 'pruned' && (
                <text x="0" y="48" textAnchor="middle" fill="#b91c1c">
                  {text.pruned}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function View({ view, previous }: { view: TraceView; previous?: TraceView }) {
  const text = useContext(TextContext);
  return (
    <section className={styles.view}>
      <h3>{view.name}</h3>
      {view.kind === 'sequence' && (
        <>
          <div className={styles.sequence}>
            {view.values.map((v, i) => {
              const pointers = Object.entries(view.pointers)
                .filter(([, p]) => p === i)
                .map(([n]) => n);
              const changed =
                previous?.kind === 'sequence' &&
                JSON.stringify(v) !== JSON.stringify(previous.values[i]);
              return (
                <div className={styles.seqCell} key={i}>
                  <small>{i}</small>
                  <div
                    className={`${styles.cell} ${pointers.length || view.active.includes(i) ? styles.active : ''} ${changed ? styles.changed : ''}`}
                  >
                    <Value value={v} />
                  </div>
                  <span className={styles.pointer}>
                    {pointers.map((n) => (
                      <span key={n}>↑ {n}</span>
                    ))}
                  </span>
                </div>
              );
            })}
            {!view.values.length && <p>{text.emptySequence}</p>}
          </div>
          <div className={styles.boundaries}>
            {Object.entries(view.pointers)
              .filter(([, i]) => i < 0 || i >= view.values.length)
              .map(([n, i]) => (
                <span key={n}>
                  {n}={i}
                  {text.outOfBounds}
                </span>
              ))}
          </div>
        </>
      )}
      {view.kind === 'matrix' && (
        <div className={styles.scroll}>
          <table>
            <thead>
              <tr>
                <th>{text.rowColumn}</th>
                {view.columns.map((v, i) => (
                  <th key={i}>
                    <Value value={v} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.values.map((row, r) => (
                <tr key={r}>
                  <th>
                    <Value value={view.rows[r]} />
                  </th>
                  {row.map((v, c) => {
                    const active = view.active.some((p) => p[0] === r && p[1] === c),
                      dependency = view.dependencies.some((p) => p[0] === r && p[1] === c);
                    const changed =
                      previous?.kind === 'matrix' &&
                      JSON.stringify(v) !== JSON.stringify(previous.values[r]?.[c]);
                    return (
                      <td
                        key={c}
                        className={`${active ? styles.active : dependency ? styles.dependency : ''} ${changed ? styles.changed : ''}`}
                      >
                        <Value value={v} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.kind === 'containers' && (
        <div className={styles.groups}>
          {view.groups.map((g, i) => (
            <div className={styles.group} key={i}>
              <h4>{g.name}</h4>
              <div className={styles.sequence}>
                {g.values.map((v, j) => (
                  <div className={styles.cell} key={j}>
                    <Value value={v} />
                  </div>
                ))}
                {!g.values.length && <span className={styles.empty}>{text.empty}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {view.kind === 'table' && (
        <div className={styles.scroll}>
          <table>
            <thead>
              <tr>
                {view.columns.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r, i) => (
                <tr key={i} className={view.active.includes(i) ? styles.active : ''}>
                  {r.map((v, j) => (
                    <td key={j}>
                      <Value value={v} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(view.kind === 'tree' || view.kind === 'graph') && <Topology view={view} />}
    </section>
  );
}

async function jsonRequest(url: string, init: RequestInit, text: SimulatorText, chinese: boolean) {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const result = await response.json();
  // Service messages are written in Chinese; other course languages get the generic notice.
  if (!response.ok)
    throw new Error(
      (chinese ? result.error?.message : undefined) ??
        `${text.requestFailed}${result.error?.code ? ` (${result.error.code})` : ''}`,
    );
  return result;
}

export function ExamSimulator({ reference }: { reference: SimulationReference }) {
  const language = useCourseLanguage();
  const text = simulatorText(language);
  const chinese = isChineseContent(language);
  const lang = contentLanguageTag(language);
  return (
    <TextContext.Provider value={text}>
      <SimulatorBody reference={reference} text={text} chinese={chinese} lang={lang} />
    </TextContext.Provider>
  );
}

function SimulatorBody({
  reference,
  text,
  chinese,
  lang,
}: {
  reference: SimulationReference;
  text: SimulatorText;
  chinese: boolean;
  lang: string;
}) {
  const [profiles, setProfiles] = useState<SimulationProfile[]>([]),
    [selected, setSelected] = useState('');
  const [topic, setTopic] = useState(reference.topic);
  const [input, setInput] = useState(''),
    [trace, setTrace] = useState<SimulationTrace | null>(null);
  const [step, setStep] = useState(0),
    [playing, setPlaying] = useState(false),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const sequence = useRef(0),
    controller = useRef<AbortController | null>(null);
  const [cards, setCards] = useState<number[]>([]),
    [answer, setAnswer] = useState<number[]>([]),
    [feedback, setFeedback] = useState('');
  const applyTrace = (t: SimulationTrace) => {
    setTrace(t);
    setSelected(t.algorithm);
    setInput(JSON.stringify(t.input, null, 2));
    setStep(0);
    setPlaying(false);
    setAnswer([]);
    setFeedback('');
    setCards(Array.from({ length: Math.min(t.frames.length, 8) }, (_, i) => i).reverse());
  };
  useEffect(() => {
    const ac = new AbortController();
    controller.current?.abort();
    controller.current = ac;
    const epoch = ++sequence.current;
    async function load() {
      setLoading(true);
      setError('');
      setTrace(null);
      setSelected('');
      setTopic(reference.topic);
      try {
        const [c, t] = await Promise.all([
          jsonRequest(
            `/api/eduplus/simulations?lang=${encodeURIComponent(lang)}`,
            { signal: ac.signal },
            text,
            chinese,
          ),
          jsonRequest(
            '/api/eduplus/simulations/trace',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                topic: reference.topic,
                courseId: reference.courseId,
                ...(reference.input ? { input: reference.input } : {}),
                lang,
              }),
              signal: ac.signal,
            },
            text,
            chinese,
          ).catch((e) => ({ initialError: e.message })),
        ]);
        if (sequence.current !== epoch) return;
        setProfiles(c.profiles);
        if ('initialError' in t) {
          setError(t.initialError);
          setInput('{}');
        } else applyTrace(t);
      } catch (e) {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : text.loadFailed);
      } finally {
        if (sequence.current === epoch) setLoading(false);
      }
    }
    void load();
    return () => {
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- text follows lang
  }, [reference.topic, reference.courseId, reference.input, lang]);
  useEffect(() => {
    if (!playing || !trace) return;
    const timer = setInterval(
      () =>
        setStep((s) => {
          if (s >= trace.frames.length - 1) {
            setPlaying(false);
            return s;
          }
          return s + 1;
        }),
      1300,
    );
    return () => clearInterval(timer);
  }, [playing, trace]);
  async function run() {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    const epoch = ++sequence.current;
    setLoading(true);
    setPlaying(false);
    setTrace(null);
    setError('');
    try {
      const data = JSON.parse(input);
      if (!data || Array.isArray(data) || typeof data !== 'object')
        throw new Error(text.inputObject);
      const t = await jsonRequest(
        '/api/eduplus/simulations/trace',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(selected ? { algorithm: selected } : {}),
            topic,
            input: data,
            lang,
            ...(topic === reference.topic && reference.courseId
              ? { courseId: reference.courseId }
              : {}),
          }),
          signal: ac.signal,
        },
        text,
        chinese,
      );
      if (sequence.current === epoch) applyTrace(t);
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : text.runFailed);
    } finally {
      if (sequence.current === epoch) setLoading(false);
    }
  }
  const frame = trace?.frames[step],
    previous = trace?.frames[step - 1];
  const game = reference.mode === 'game';
  return (
    <main className={styles.simulator}>
      <h2>
        {trace?.title ?? profiles.find((p) => p.id === selected)?.title ?? topic}
        {game ? text.gameSuffix : text.demoSuffix}
      </h2>
      <p>{game ? text.gameIntro : text.demoIntro}</p>
      <details className={styles.input}>
        <summary>{text.editInput}</summary>
        <label>
          {text.topic}
          <input
            aria-label={text.topic}
            value={topic}
            disabled={loading}
            onChange={(e) => {
              setTopic(e.target.value);
              setSelected('');
              setTrace(null);
              setError('');
            }}
          />
        </label>
        <label>
          {text.catalog}
          <select
            aria-label={text.catalog}
            value={selected}
            disabled={loading}
            onChange={(e) => {
              setSelected(e.target.value);
              const p = profiles.find((p) => p.id === e.target.value);
              if (p) {
                setInput(JSON.stringify(p.default, null, 2));
                setTopic(p.title);
              }
              setPlaying(false);
              setTrace(null);
              setError('');
            }}
          >
            <option value="">{text.dynamicOption}</option>
            {selected.startsWith('dynamic-') && (
              <option value={selected}>
                {trace?.title ?? topic}
                {text.dynamicTag}
              </option>
            )}
            {Array.from(new Set(profiles.map((p) => p.section))).map((section) => (
              <optgroup key={section} label={section}>
                {profiles
                  .filter((p) => p.section === section)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          {text.input}
          <textarea
            aria-label={text.inputAria}
            disabled={loading}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={8}
            spellCheck={false}
          />
        </label>
        {trace?.inputDescription && <p>{trace.inputDescription}</p>}
        <button disabled={loading || !topic.trim()} onClick={run}>
          {text.apply}
        </button>
      </details>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {loading && <p role="status">{text.loading}</p>}
      {trace?.verification && (
        <p role="status">{text.verified(trace.verification.checkedInputs)}</p>
      )}
      {trace && frame && (
        <>
          {/* The game is played first: showing the step-by-step demonstration
              above it would give the answer away (and read as a second simulator). */}
          {!game && (
            <>
              <div className={styles.controls}>
                <button
                  disabled={!step}
                  onClick={() => {
                    setPlaying(false);
                    setStep((s) => s - 1);
                  }}
                >
                  {text.previous}
                </button>
                <button
                  disabled={step === trace.frames.length - 1}
                  onClick={() => {
                    setPlaying(false);
                    setStep((s) => s + 1);
                  }}
                >
                  {text.next}
                </button>
                <button
                  disabled={step === trace.frames.length - 1}
                  onClick={() => setPlaying(true)}
                >
                  {text.autoplay}
                </button>
                <button onClick={() => setPlaying(false)}>{text.pause}</button>
                <button
                  onClick={() => {
                    setPlaying(false);
                    setStep(0);
                  }}
                >
                  {text.restart}
                </button>
                <span>
                  {step + 1} / {trace.frames.length}
                </span>
              </div>
              <input
                aria-label={text.stepAria}
                className={styles.range}
                type="range"
                min={0}
                max={trace.frames.length - 1}
                value={step}
                onChange={(e) => {
                  setPlaying(false);
                  setStep(Number(e.target.value));
                }}
              />
              <div aria-live="polite" className={styles.explanation}>
                <h3>
                  {step + 1}. {frame.label}
                </h3>
                <p>{frame.explanation}</p>
              </div>
              {frame.views.map((view, i) => (
                <View
                  key={`${view.kind}-${view.name}-${i}`}
                  view={view}
                  previous={previous?.views.find(
                    (v) => v.kind === view.kind && v.name === view.name,
                  )}
                />
              ))}
              {step === trace.frames.length - 1 && (
                <section className={styles.view}>
                  <h3>{text.result}</h3>
                  <ResultValue value={trace.outcome} />
                </section>
              )}
            </>
          )}
          {game && (
            <section className={styles.view}>
              <h3>{text.gameHeading(cards.length)}</h3>
              <p>
                {text.sampleInput}
                {JSON.stringify(trace.input)}
              </p>
              <p>{text.gameHint}</p>
              <div className={styles.cardDeck}>
                {cards
                  .filter((i) => !answer.includes(i))
                  .map((i) => (
                    <button
                      key={i}
                      className={styles.stepCard}
                      onClick={() => setAnswer((a) => [...a, i])}
                    >
                      <strong>{trace.frames[i].label}</strong>
                      <span>{unbroken(trace.frames[i].explanation)}</span>
                    </button>
                  ))}
              </div>
              <h4 className={styles.answerTitle}>{text.answerArea(answer.length, cards.length)}</h4>
              {answer.length ? (
                <ol className={styles.answerList}>
                  {answer.map((i) => (
                    <li key={i}>
                      <strong>{trace.frames[i].label}</strong>
                      <span>{unbroken(trace.frames[i].explanation)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={styles.answerEmpty}>{text.answerEmpty}</p>
              )}
              <div className={`${styles.controls} ${styles.gameControls}`}>
                <button
                  onClick={() =>
                    setFeedback(
                      answer.length === cards.length && answer.every((v, i) => v === i)
                        ? text.pass
                        : text.fail,
                    )
                  }
                >
                  {text.check}
                </button>
                <button
                  onClick={() => {
                    setAnswer((a) => a.slice(0, -1));
                    setFeedback('');
                  }}
                >
                  {text.undo}
                </button>
              </div>
              {feedback && (
                <p
                  className={`${styles.gameFeedback} ${feedback === text.pass ? styles.gamePass : styles.gameFail}`}
                  role="status"
                >
                  {feedback}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
