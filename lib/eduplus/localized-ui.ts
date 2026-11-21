import dictionaries from './ui-translations.generated.json';

/** Static bundled dictionaries: controls never need a model/network request. */
export function localizedUi<T extends object>(base: T, language: string): T {
  const dictionary = (dictionaries as Record<string, Record<string, string>>)[language];
  if (!dictionary) return base;
  const render = (text: string, args: unknown[] = []) =>
    (dictionary[text] ?? text).replace(/__ARG_(\d+)__/g, (_match, index: string) =>
      String(args[Number(index)] ?? ''),
    );
  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => [
      key,
      typeof value === 'function'
        ? (...args: unknown[]) =>
            render(value(...args.map((_arg, index) => `__ARG_${index}__`)), args)
        : typeof value === 'string'
          ? render(value)
          : value,
    ]),
  ) as T;
}
