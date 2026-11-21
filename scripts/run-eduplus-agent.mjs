// Load exactly the same environment precedence as Next.js, then spawn Python.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const localRequire = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextRequire = createRequire(localRequire.resolve('next/package.json'));
nextRequire('@next/env').loadEnvConfig(root);
// The Python Agent uses the same local model as the web app: the llm slot and
// the provider address of openmaic.yml, unless set explicitly.
function configuredModel() {
  const file = path.join(root, 'openmaic.yml');
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  const slot = /^\s*llm:\s*['"]?([^\s'"#]+)/m.exec(text)?.[1];
  const base = /^\s*baseUrl:\s*['"]?(http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)/m.exec(
    text,
  )?.[1];
  // "local:qwen2.5-coder:7b" is provider "local" (declared under providers:) + model.
  const provider = slot?.split(':')[0];
  const declared =
    provider &&
    new RegExp(`^\\s+${provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`, 'm').test(text);
  return { model: slot && declared ? slot.slice(provider.length + 1) : slot, base };
}
const configured = configuredModel();
if (!process.env.EDUPLUS_OLLAMA_MODEL && configured.model)
  process.env.EDUPLUS_OLLAMA_MODEL = configured.model;
if (!process.env.EDUPLUS_OLLAMA_BASE_URL && configured.base)
  process.env.EDUPLUS_OLLAMA_BASE_URL = configured.base;
const port = Number(process.argv[2] || '8001');
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
if (
  !process.env.EDUPLUS_AGENT_SERVICE_TOKEN ||
  process.env.EDUPLUS_AGENT_SERVICE_TOKEN.length < 32
) {
  throw new Error('Run node scripts/prepare-eduplus-env.mjs before starting the Agent service.');
}
const python = path.join(
  root,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const child = spawn(
  python,
  [
    '-m',
    'uvicorn',
    'agent_api:app',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--workers',
    '1',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  },
);
child.on('error', () => {
  console.error('Could not start Python Agent service.');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
