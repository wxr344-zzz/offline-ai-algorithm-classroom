import type { SimulationTrace, TraceView } from '@/lib/eduplus/simulation-contract';
import {
  cachedTranslation,
  translationKey,
  translateTexts,
  assertDisplayLanguage,
  type Translate,
} from './course-translation';

/** A display layer AFTER execution. No input, outcome, pointer, node value,
 * matrix cell, state, identifier or verification proof may be translated. */
export async function localizeTraceDisplay(
  trace: SimulationTrace,
  locale: string | undefined,
  owner: string,
  translate: Translate,
): Promise<SimulationTrace> {
  if (!locale || /^zh-CN(?:-|$)/i.test(locale)) return trace;
  const directive = `Teach the entire course in locale ${locale}.`;
  const viewTexts = (view: TraceView) => [
    view.name,
    ...(view.kind === 'containers' ? view.groups.map((group) => group.name) : []),
    ...(view.kind === 'table' ? view.columns : []),
  ];
  const texts = [
    trace.title,
    ...(trace.inputDescription ? [trace.inputDescription] : []),
    ...trace.frames.flatMap((frame) => [
      frame.label,
      frame.explanation,
      ...frame.views.flatMap(viewTexts),
    ]),
  ];
  const map = await cachedTranslation(translationKey([owner, locale, ...texts]), () =>
    translateTexts(texts, directive, translate),
  );
  const pick = (text: string) => map.get(text) ?? text;
  assertDisplayLanguage(texts.map(pick), directive);
  const viewCopy = (view: TraceView): TraceView =>
    ({
      ...view,
      name: pick(view.name),
      ...(view.kind === 'containers'
        ? { groups: view.groups.map((group) => ({ ...group, name: pick(group.name) })) }
        : {}),
      ...(view.kind === 'table' ? { columns: view.columns.map(pick) } : {}),
    }) as TraceView;
  return {
    ...trace,
    title: pick(trace.title),
    ...(trace.inputDescription ? { inputDescription: pick(trace.inputDescription) } : {}),
    frames: trace.frames.map((frame) => ({
      ...frame,
      label: pick(frame.label),
      explanation: pick(frame.explanation),
      views: frame.views.map(viewCopy),
    })),
  };
}
