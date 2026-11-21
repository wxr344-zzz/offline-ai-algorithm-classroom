/**
 * Offline Tailwind for generated interactive pages.
 *
 * OpenMAIC's native widget prompts lay pages out with Tailwind utility classes,
 * which upstream loads from a CDN at view time. An offline deployment cannot,
 * so the classes stayed unstyled. Here the installed `tailwindcss` package
 * compiles exactly the classes a page uses into one inline <style>, once, when
 * the page is generated. Pages that use no utilities are returned unchanged
 * (no preflight reset is forced on hand-styled pages). Any failure returns the
 * page unchanged: styling must never break generation.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

type Compiler = { build(candidates: string[]): string };
type CompileFn = (
  css: string,
  options: {
    base: string;
    loadStylesheet: (
      id: string,
      base: string,
    ) => Promise<{ path: string; base: string; content: string }>;
  },
) => Promise<Compiler>;

let compilerPromise: Promise<{ dir: string; compile: CompileFn }> | null = null;

async function tailwind() {
  compilerPromise ??= (async () => {
    const requireFromApp = createRequire(path.join(process.cwd(), 'package.json'));
    const dir = path.dirname(requireFromApp.resolve('tailwindcss/package.json'));
    const { compile } = (await import('tailwindcss')) as unknown as { compile: CompileFn };
    return { dir, compile };
  })().catch((error) => {
    compilerPromise = null;
    throw error;
  });
  return compilerPromise;
}

async function compiler(extraCss: string): Promise<Compiler> {
  const { dir, compile } = await tailwind();
  return compile(`@import 'tailwindcss';\n${extraCss}`, {
    base: dir,
    loadStylesheet: async (id: string, base: string) => {
      const file =
        id === 'tailwindcss'
          ? path.join(dir, 'index.css')
          : id.startsWith('tailwindcss/')
            ? path.join(dir, id.slice('tailwindcss/'.length).replace(/(?<!\.css)$/, '.css'))
            : path.resolve(base, id);
      // Only the package's own stylesheets may be read.
      if (!path.resolve(file).startsWith(path.resolve(dir) + path.sep))
        throw new Error(`stylesheet outside tailwindcss: ${id}`);
      return { path: file, base: path.dirname(file), content: await fs.readFile(file, 'utf8') };
    },
  });
}

const CDN_TAG =
  /<script\b[^>]*\bsrc\s*=\s*["'][^"']*tailwind[^"']*["'][^>]*>\s*<\/script>|<link\b[^>]*\bhref\s*=\s*["'][^"']*tailwind[^"']*["'][^>]*>/gi;
const TAILWIND_STYLE =
  /<style\b[^>]*type\s*=\s*["']text\/tailwindcss["'][^>]*>([\s\S]*?)<\/style>/gi;

/** Candidate class names: class attributes plus quoted strings in scripts (classList.add('…')). */
export function tailwindCandidates(html: string): string[] {
  const out = new Set<string>();
  const add = (value: string) => {
    for (const token of value.split(/\s+/)) {
      const t = token.trim();
      if (t && t.length <= 80 && /^[!-]?[a-z@\[]/.test(t)) out.add(t);
    }
  };
  for (const m of html.matchAll(/\sclass(?:Name)?\s*=\s*(["'])([\s\S]*?)\1/gi)) add(m[2]!);
  for (const script of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi))
    for (const m of script[1]!.matchAll(/(["'`])((?:(?!\1)[^\\\n]){1,300})\1/g))
      if (/(?:^|\s)[a-z][\w-]*-[\w[\]./%-]+/.test(m[2]!)) add(m[2]!);
  return [...out].slice(0, 4000);
}

export async function inlineTailwind(html: string): Promise<string> {
  if (!html || html.includes('data-maic-tailwind')) return html;
  try {
    const extra: string[] = [];
    let page = html.replace(CDN_TAG, '').replace(TAILWIND_STYLE, (_m, css: string) => {
      extra.push(css);
      return '';
    });
    const candidates = tailwindCandidates(page);
    let c: Compiler;
    try {
      c = await compiler(extra.join('\n'));
    } catch {
      // Model-written @apply blocks may be invalid; keep the utilities anyway.
      c = await compiler('');
    }
    const base = c.build([]);
    const css = c.build(candidates);
    if (css.length === base.length && !extra.length) return html;
    const style = `<style data-maic-tailwind>\n${css}\n</style>`;
    // Before the page's own styles so authored CSS still wins on equal specificity.
    const head = /<head\b[^>]*>/i.exec(page);
    if (head) page = page.replace(head[0], `${head[0]}\n${style}`);
    else if (/<html\b[^>]*>/i.test(page))
      page = page.replace(/<html\b[^>]*>/i, (m) => `${m}\n<head>${style}</head>`);
    else page = `${style}\n${page}`;
    return page;
  } catch {
    return html;
  }
}
