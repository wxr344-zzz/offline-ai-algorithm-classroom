// Prepare a local psql bootstrap file using the application's effective configuration.
// Never prints credentials. SQL output is placed in the Git-ignored logs directory.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
process.chdir(root);
const nextRequire = createRequire(require.resolve('next/package.json'));
nextRequire('@next/env').loadEnvConfig(root);

const connection = new URL(process.env.DATABASE_URL || '');
const role = decodeURIComponent(connection.username);
const password = decodeURIComponent(connection.password);
const database = decodeURIComponent(connection.pathname.slice(1));
if (
  !['postgres:', 'postgresql:'].includes(connection.protocol) ||
  !['127.0.0.1', 'localhost'].includes(connection.hostname) ||
  (connection.port && connection.port !== '5432') ||
  role !== 'openmaic' ||
  database !== 'openmaic' ||
  !password
) {
  throw new Error(
    'Expected a local openmaic database/user on port 5432 with a configured password.',
  );
}
// encode the password as UTF-8 bytes: no psql variable expansion or SQL quoting ambiguity.
const passwordHex = Buffer.from(password, 'utf8').toString('hex');
const sql = `-- Run in an authenticated local postgres administrator psql session.
\\set ON_ERROR_STOP on
SELECT current_user = 'postgres' AND current_database() = 'postgres' AS correct_session \\gset
\\if :correct_session
DO $bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openmaic') THEN
    CREATE ROLE openmaic LOGIN;
  END IF;
  EXECUTE format('ALTER ROLE openmaic LOGIN PASSWORD %L', convert_from(decode('${passwordHex}', 'hex'), 'UTF8'));
END
$bootstrap$;
SELECT 'CREATE DATABASE openmaic OWNER openmaic'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'openmaic')
\\gexec
GRANT CONNECT ON DATABASE openmaic TO openmaic;
\\connect openmaic postgres 127.0.0.1 5432
GRANT USAGE, CREATE ON SCHEMA public TO openmaic;
SELECT current_database() AS configured_database;
\\echo OpenMAIC database bootstrap finished. Verify the application connection separately.
\\else
\\echo Refused: open a local psql session as postgres in database postgres first.
\\endif
`;
const output = path.join(root, 'logs', 'configure-openmaic.sql');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, sql, { encoding: 'utf8', mode: 0o600 });
console.log(`Prepared SQL file: ${output}`);
