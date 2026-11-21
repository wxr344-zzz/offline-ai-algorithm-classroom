import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, openSync, closeSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createConnection } from 'node:net';

/**
 * Fingerprint of the Agent's Python sources on disk, by the same rule as
 * agent_api.code_version (root and exam_simulator *.py, path order, line
 * endings ignored). A managed Agent outlives the app server, so after an
 * update the running one may still serve the old code.
 */
export function agentCodeVersion(root = process.cwd()): string {
  const files = [
    ...readdirSync(root).filter((name: string) => name.endsWith('.py')),
    ...(existsSync(resolve(root, 'exam_simulator'))
      ? readdirSync(resolve(root, 'exam_simulator'))
          .filter((name: string) => name.endsWith('.py'))
          .map((name: string) => `exam_simulator/${name}`)
      : []),
  ].sort();
  const digest = createHash('sha256');
  for (const name of files) {
    digest.update(Buffer.from(`${name}\0`, 'utf8'));
    const bytes = readFileSync(resolve(root, name));
    digest.update(Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1'));
    digest.update(Buffer.from([0]));
  }
  return digest.digest('hex').slice(0, 16);
}

/** The process listening on local port 8001 (an Agent too old to report its pid). */
function listenerPid(): Promise<number | null> {
  return new Promise((done) => {
    const parse = (stdout: string, pattern: RegExp) => {
      for (const line of stdout.split(/\r?\n/)) {
        const match = pattern.exec(line);
        if (match) return Number(match[1]);
      }
      return null;
    };
    if (process.platform === 'win32')
      execFile(
        'netstat',
        ['-ano', '-p', 'TCP'],
        { windowsHide: true },
        (error: Error | null, stdout: string) =>
          done(error ? null : parse(stdout, /127\.0\.0\.1:8001\s+\S+\s+LISTENING\s+(\d+)/i)),
      );
    else
      execFile('lsof', ['-ti', 'tcp:8001', '-sTCP:LISTEN'], (error: Error | null, stdout: string) =>
        done(error ? null : parse(stdout, /^(\d+)$/)),
      );
  });
}

type Dependencies = {
  healthy(): Promise<boolean>;
  launch(): Promise<void>;
  wait(): Promise<void>;
};

/** One bounded startup shared by concurrent requests; a failure may be retried later. */
export class LocalAgentStartup {
  private pending?: Promise<void>;
  constructor(private readonly deps: Dependencies) {}
  async ensure(): Promise<void> {
    if (await this.deps.healthy()) return;
    if (!this.pending) {
      this.pending = (async () => {
        // Another app process may have started it during the first probe.
        if (await this.deps.healthy()) return;
        await this.deps.launch();
        const deadline = Date.now() + 30000;
        for (let attempt = 0; attempt < 120 && Date.now() < deadline; attempt++) {
          if (await this.deps.healthy()) return;
          await this.deps.wait();
        }
        throw new Error('本地 Agent 启动超时，请查看 logs/agent-managed.stderr.log。');
      })().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }
}

export function autoStartLocalAgent(endpoint: URL, env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.EDUPLUS_AGENT_AUTO_START !== '0' &&
    (env.NODE_ENV === 'development' || env.EDUPLUS_AGENT_AUTO_START === '1') &&
    endpoint.origin === 'http://127.0.0.1:8001' &&
    !endpoint.username &&
    !endpoint.password
  );
}

function portOccupied(): Promise<boolean> {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: '127.0.0.1', port: 8001 });
    const done = (occupied: boolean) => {
      socket.destroy();
      resolvePort(occupied);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(true));
  });
}

const globals = globalThis as typeof globalThis & { __eduplusLocalAgent?: LocalAgentStartup };
function startup(): LocalAgentStartup {
  if (globals.__eduplusLocalAgent) return globals.__eduplusLocalAgent;
  let child: ChildProcess | undefined;
  let launchError: Error | undefined;
  // An Agent that answers but runs older code than is on disk: { pid } when it reported one.
  let outdated: { pid: number | null } | null = null;
  globals.__eduplusLocalAgent = new LocalAgentStartup({
    healthy: async () => {
      try {
        const response = await fetch('http://127.0.0.1:8001/health', {
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(1000),
        });
        const body = await response.json();
        if (!(response.ok && body.status === 'ok' && body.service === 'eduplus-agent'))
          return false;
        if (body.codeVersion !== agentCodeVersion()) {
          outdated = { pid: Number.isSafeInteger(body.pid) ? body.pid : null };
          return false;
        }
        outdated = null;
        return true;
      } catch {
        return false;
      }
    },
    launch: async () => {
      if (outdated) {
        // Our own Agent, left running from before an update: replace it.
        const pid = outdated.pid ?? (await listenerPid());
        if (!pid) throw new Error('Agent 服务仍在运行旧版本代码，请手动关闭后重试。');
        console.warn(`[eduplus] Restarting the local Agent (pid ${pid}): its code is outdated.`);
        try {
          process.kill(pid);
        } catch {
          // Already gone.
        }
        for (let i = 0; i < 40 && (await portOccupied()); i++)
          await new Promise((done) => setTimeout(done, 250));
        outdated = null;
        child = undefined;
      }
      if (child && child.exitCode === null && child.signalCode === null && !launchError) return;
      if (await portOccupied())
        throw new Error('8001 端口已被其他或未就绪服务占用，未重复启动 Agent。');
      const root = process.cwd();
      const script = resolve(root, 'scripts/run-eduplus-agent.mjs');
      if (
        !existsSync(script) ||
        !existsSync(
          resolve(
            root,
            '.venv',
            process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
          ),
        )
      )
        throw new Error('本项目缺少 Agent 启动脚本或 Python 虚拟环境。');
      mkdirSync(resolve(root, 'logs'), { recursive: true });
      const out = openSync(resolve(root, 'logs/agent-managed.stdout.log'), 'a');
      const err = openSync(resolve(root, 'logs/agent-managed.stderr.log'), 'a');
      launchError = undefined;
      try {
        // Spawn from the long-lived Next server, not the assistant's temporary shell.
        child = spawn(process.execPath, [script], {
          cwd: root,
          env: process.env,
          windowsHide: true,
          stdio: ['ignore', out, err],
        });
        child.on('error', (error) => {
          launchError = error;
        });
        child.unref();
      } finally {
        closeSync(out);
        closeSync(err);
      }
    },
    wait: async () => {
      if (launchError) throw launchError;
      if (child && (child.exitCode !== null || child.signalCode !== null))
        throw new Error('Agent 启动后退出，请查看 logs/agent-managed.stderr.log。');
      await new Promise((done) => setTimeout(done, 250));
    },
  });
  return globals.__eduplusLocalAgent;
}

export async function ensureLocalAgent(endpoint: URL): Promise<void> {
  if (autoStartLocalAgent(endpoint)) await startup().ensure();
}
