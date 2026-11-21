// Reproducible local assets: no CDN calls from the browser, no root lockfile changes.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, cp, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
// Reuse the installed project dependency. These assets need no CDN or separate install.
const localRequire = createRequire(import.meta.url);
const katexDist = resolve(localRequire.resolve('katex/package.json'), '..', 'dist');
const katexTarget = resolve(root, 'public/vendor/eduplus/katex');
await mkdir(katexTarget, { recursive: true });
for (const entry of ['katex.min.js', 'katex.min.css', 'contrib/auto-render.min.js', 'fonts'])
  await cp(resolve(katexDist, entry), resolve(katexTarget, entry), { recursive: true });
console.log('KaTeX: local runtime assets prepared');
// A registry mirror (EDUPLUS_ASSET_REGISTRY, e.g. https://registry.npmmirror.com) is safe:
// every archive is checked against the pinned integrity below.
const registry = (process.env.EDUPLUS_ASSET_REGISTRY || 'https://registry.npmjs.org').replace(
  /\/+$/,
  '',
);
const packages = [
  {
    name: 'monaco-editor',
    version: '0.55.1',
    integrity:
      'sha512-jz4x+TJNFHwHtwuV9vA9rMujcZRb0CEilTEwG2rRSpe/A7Jdkuj8xPKttCgOh+v/lkHy7HsZ64oj+q3xoAFl9A==',
    source: 'min/vs',
    target: 'monaco/vs',
    required: 'loader.js',
  },
  {
    name: 'pyodide',
    version: '0.29.3',
    integrity:
      'sha512-22UBuhOJawj7vKUnS7/F3xK+515LJdjiMAHoCfuS6/PbHiOrSQVnYwDe+2sbVwiOZ3sMMexdXICew6NqOMQGgA==',
    source: '',
    target: 'pyodide',
    required: 'pyodide.asm.wasm',
  },
];
for (const pkg of packages) {
  const target = resolve(root, 'public/vendor/eduplus', pkg.target);
  const marker = resolve(target, '.asset-version');
  try {
    if ((await readFile(marker, 'utf8')) === `${pkg.version}\n`) {
      await stat(resolve(target, pkg.required));
      console.log(`${pkg.name} ${pkg.version}: ready`);
      continue;
    }
  } catch {
    /* Prepare missing assets. */
  }
  const url = `${registry}/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Asset download failed: ${response.status} (${pkg.name})`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (`sha512-${createHash('sha512').update(archive).digest('base64')}` !== pkg.integrity)
    throw new Error(`Integrity mismatch: ${pkg.name}`);
  const staging = resolve(root, 'logs/eduplus-assets', `${pkg.name}-${pkg.version}`);
  await mkdir(staging, { recursive: true });
  const archivePath = resolve(staging, 'package.tgz');
  await writeFile(archivePath, archive);
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', staging], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Asset extraction failed: ${pkg.name}`);
  await mkdir(target, { recursive: true });
  await cp(resolve(staging, 'package', pkg.source), target, { recursive: true });
  await stat(resolve(target, pkg.required));
  await writeFile(marker, `${pkg.version}\n`);
  console.log(`${pkg.name} ${pkg.version}: prepared`);
}
