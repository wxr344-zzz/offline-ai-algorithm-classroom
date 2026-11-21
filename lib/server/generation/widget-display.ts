import type { GameSpec, SimulationSpec } from './widget-fallback';
import { assertDisplayLanguage, translateTexts, type Translate } from '../course-translation';

/** Translate spec prose only; formulas, ids, answer indices and units never enter the model. */
export async function localizeWidgetSpec<T extends GameSpec | SimulationSpec>(
  spec: T,
  directive: string | undefined,
  translate: Translate,
): Promise<T> {
  if (!directive) return spec;
  const copy = structuredClone(spec);
  const slots: Array<{ object: Record<string, unknown>; key: string }> = [];
  const add = (object: object, keys: string[]) =>
    keys.forEach((key) => {
      if (typeof (object as Record<string, unknown>)[key] === 'string')
        slots.push({ object: object as Record<string, unknown>, key });
    });
  add(copy, ['title', 'intro']);
  if ('rounds' in copy)
    for (const round of copy.rounds) {
      add(round, ['prompt', 'explain']);
      round.options.forEach((_value, index) => add(round.options, [String(index)]));
    }
  else {
    copy.parameters.forEach((parameter) => add(parameter, ['label']));
    copy.outputs.forEach((output) => add(output, ['label']));
    copy.observations.forEach((_value, index) => add(copy.observations, [String(index)]));
    if (copy.plot) {
      add(copy.plot, ['xLabel']);
      copy.plot.curves.forEach((curve) => add(curve, ['label']));
    }
  }
  const texts = slots.map(({ object, key }) => object[key] as string);
  const map = await translateTexts(texts, directive, translate);
  slots.forEach(({ object, key }) => {
    object[key] = map.get(object[key] as string) ?? object[key];
  });
  assertDisplayLanguage(
    slots.map(({ object, key }) => object[key] as string),
    directive,
  );
  return copy;
}
