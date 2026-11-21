export async function resolve(specifier, context, nextResolve) {
  if (/^next\/[a-z-]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.json'))
    return nextLoad(url, {
      ...context,
      importAttributes: { ...context.importAttributes, type: 'json' },
    });
  return nextLoad(url, context);
}
