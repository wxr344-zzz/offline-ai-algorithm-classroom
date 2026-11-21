/**
 * Unit-test environment bootstrap.
 *
 * The suite runs hermetic by default: `.env.local` is NOT loaded.
 *
 * It used to be loaded unconditionally ("so API keys are available"), which made
 * every test see whatever the developer happened to have configured locally.
 * That cannot make a test pass — CI has no `.env.local` at all, so any test that
 * needed it would already be red there — it can only invent failures that exist
 * on one machine and nowhere else.
 *
 * To opt back in — a smoke test that needs a real endpoint, or reproducing
 * something against live credentials — set TEST_LOAD_LOCAL_ENV=1:
 *
 *   TEST_LOAD_LOCAL_ENV=1 npx vitest run <suite>
 *
 * Variables exported in the shell are untouched either way — this only governs
 * whether the file is read.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeEach, vi } from 'vitest';

// The deployment YAML is local configuration just like .env.local. A developer's
// slot locks/credentials must not change route fixtures that supply their own
// model. Keep explicit files and tests that change cwd fully real.
vi.mock('@/lib/server/model-config/openmaic-yml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/model-config/openmaic-yml')>();
  const path = await import('node:path');
  const os = await import('node:os');
  const { randomUUID } = await import('node:crypto');
  const root = path.resolve(__dirname, '..');
  const emptyDirectory = path.join(os.tmpdir(), `openmaic-test-config-${randomUUID()}`);
  return {
    ...actual,
    loadModelConfigFile: (env = process.env, cwd = process.cwd()) =>
      actual.loadModelConfigFile(
        env,
        process.env.TEST_LOAD_LOCAL_ENV !== '1' &&
          !env.OPENMAIC_CONFIG?.trim() &&
          path.resolve(cwd) === root
          ? emptyDirectory
          : cwd,
      ),
  };
});

if (process.env.TEST_LOAD_LOCAL_ENV === '1') {
  const envPath = resolve(__dirname, '..', '.env.local');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local not found, skip
  }
}

// The deployment's model configuration is loaded once per process and kept on
// globalThis (lib/server/model-config/runtime.ts), which vi.resetModules does
// not clear. Each test starts without it, so it is read from that test's env.
beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('openmaic.model-config.deployment')];
});
