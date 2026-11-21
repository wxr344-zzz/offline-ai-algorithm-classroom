// Add a server-only shared credential without printing it or changing existing settings.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const localRequire = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextRequire = createRequire(localRequire.resolve('next/package.json'));
nextRequire('@next/env').loadEnvConfig(root);
const token = process.env.EDUPLUS_AGENT_SERVICE_TOKEN;
if (token) {
  if (token.length < 32)
    throw new Error('EDUPLUS_AGENT_SERVICE_TOKEN must contain at least 32 characters');
  console.log('EduPlus internal service credential is already configured.');
} else {
  const file = path.join(root, '.env.local');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (/^\s*EDUPLUS_AGENT_SERVICE_TOKEN\s*=/m.test(existing)) {
    throw new Error(
      'An empty credential already exists in .env.local; configure it before continuing.',
    );
  }
  fs.appendFileSync(
    file,
    `\n# EduPlus internal server-to-server credential\nEDUPLUS_AGENT_SERVICE_TOKEN=${randomBytes(32).toString('hex')}\n`,
    'utf8',
  );
  console.log('Configured EduPlus internal service credential in .env.local (value hidden).');
}
