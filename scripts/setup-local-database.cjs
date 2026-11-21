// Creates only this unpacked main workspace's private database and credentials.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
function argument(name) {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}
function validatePgBin(input) {
  if (!input) throw Error('Pass --pg-bin with the installed PostgreSQL bin directory.');
  const bin = path.resolve(input);
  for (const name of ['initdb.exe', 'pg_ctl.exe', 'postgres.exe']) {
    if (!fs.existsSync(path.join(bin, name))) throw Error('Missing PostgreSQL executable: ' + name);
  }
  return bin;
}
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1500, () => finish(true));
  });
}
async function main() {
  const cluster = path.join(root, 'local-database');
  const envFile = path.join(root, '.env.local');
  const runtimeFile = path.join(root, 'database-runtime.json');
  if (fs.existsSync(cluster) && fs.existsSync(envFile) && fs.existsSync(runtimeFile)) {
    const runtime = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
    validatePgBin(runtime.pgBin);
    console.log('This copy is already prepared; existing credentials and database were preserved.');
    return;
  }
  if (fs.existsSync(cluster) || fs.existsSync(envFile) || fs.existsSync(runtimeFile))
    throw Error(
      'Partial/existing local setup found. Refusing to overwrite it; use a fresh extraction or ask for help.',
    );
  const pgBin = validatePgBin(argument('--pg-bin') || process.env.OPENMAIC_DUAL_PG_BIN);
  const databasePort = Number(argument('--port') || 55436);
  if (!Number.isInteger(databasePort) || databasePort < 1024 || databasePort > 65535)
    throw Error('Invalid private PostgreSQL port.');
  if (process.argv.includes('--check-prerequisites')) {
    console.log('PostgreSQL executables: OK');
    return;
  }
  if (await portInUse(databasePort))
    throw Error(
      'Private database port is occupied. Stop the other dual main workspace before preparing this one.',
    );
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  const password = randomBytes(24).toString('hex');
  const passwordFile = path.join(root, 'logs', 'init-password.private');
  const options = { cwd: root, stdio: 'ignore', windowsHide: true, timeout: 90000 };
  fs.writeFileSync(passwordFile, password + '\n');
  try {
    execFileSync(
      path.join(pgBin, 'initdb.exe'),
      [
        '-D',
        'local-database',
        '-U',
        'openmaic_dual',
        '--pwfile=logs/init-password.private',
        '--auth-host=scram-sha-256',
        '--auth-local=scram-sha-256',
        '--encoding=UTF8',
        '--locale=C',
      ],
      options,
    );
  } finally {
    fs.unlinkSync(passwordFile);
  }
  execFileSync(
    path.join(pgBin, 'pg_ctl.exe'),
    [
      'start',
      '-D',
      'local-database',
      '-l',
      'logs/dual-postgres.log',
      '-o',
      '-h 127.0.0.1 -p ' + databasePort,
      '-w',
    ],
    options,
  );
  const url = new URL(
    'postgresql://openmaic_dual:' + password + '@127.0.0.1:' + databasePort + '/postgres',
  );
  const { Client } = require('pg');
  const db = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10000 });
  await db.connect();
  try {
    await db.query('CREATE DATABASE openmaic_dual_main');
  } finally {
    await db.end();
  }
  url.pathname = '/openmaic_dual_main';
  const settings = {
    DATABASE_URL: url.toString(),
    OWNER_SINGLE_USER: 'true',
    OPENMAIC_SECRET_KEY: randomBytes(32).toString('hex'),
    EDUPLUS_AGENT_SERVICE_TOKEN: randomBytes(32).toString('hex'),
    EDUPLUS_AGENT_BASE_URL: 'http://127.0.0.1:8401',
    EDUPLUS_AGENT_AUTO_START: '0',
    EDUPLUS_OLLAMA_MODEL: 'qwen2.5-coder:7b',
    EDUPLUS_OLLAMA_BASE_URL: 'http://127.0.0.1:11436',
    OPENMAIC_GENERATION_RUN_MAX_CONCURRENT: '1',
    NEXT_TELEMETRY_DISABLED: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  fs.writeFileSync(
    envFile,
    Object.entries(settings)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n',
  );
  fs.writeFileSync(runtimeFile, JSON.stringify({ pgBin, cluster, port: databasePort }, null, 2));
  console.log(
    'Independent dual-model database and fresh local credentials created. Secret values hidden.',
  );
}
module.exports = { validatePgBin, portInUse };
if (require.main === module)
  main().catch((e) => {
    console.error(e.code || e.message);
    process.exitCode = 1;
  });
