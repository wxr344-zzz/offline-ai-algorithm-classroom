import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentCodeVersion,
  autoStartLocalAgent,
  LocalAgentStartup,
} from '@/lib/server/eduplus-local-agent';

describe('local Agent lifecycle', () => {
  it('fingerprints the Agent sources like the Agent itself, ignoring line endings', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-version-'));
    mkdirSync(join(root, 'exam_simulator'));
    writeFileSync(join(root, 'agent_api.py'), 'a = 1\r\n');
    writeFileSync(join(root, 'exam_simulator', 'graphs.py'), 'b = 2\n');
    writeFileSync(join(root, 'notes.txt'), 'ignored');
    const before = agentCodeVersion(root);
    // The same value tests/test_agent_api.py expects from agent_api.code_version.
    expect(before).toBe('3a011a614280b433');
    writeFileSync(join(root, 'agent_api.py'), 'a = 1\n');
    expect(agentCodeVersion(root)).toBe(before);
    writeFileSync(join(root, 'exam_simulator', 'graphs.py'), 'b = 3\n');
    expect(agentCodeVersion(root)).not.toBe(before);
  });
  it('only manages the fixed local development endpoint or explicit opt-in', () => {
    const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;
    expect(autoStartLocalAgent(new URL('http://127.0.0.1:8001/internal/v1/generate'), env)).toBe(
      true,
    );
    for (const url of [
      'http://example.com:8001',
      'http://127.0.0.1:9001',
      'https://127.0.0.1:8001',
      'http://u:p@127.0.0.1:8001',
    ])
      expect(autoStartLocalAgent(new URL(url), env)).toBe(false);
    expect(autoStartLocalAgent(new URL('http://127.0.0.1:8001'), { NODE_ENV: 'production' })).toBe(
      false,
    );
    expect(
      autoStartLocalAgent(new URL('http://127.0.0.1:8001'), {
        ...env,
        EDUPLUS_AGENT_AUTO_START: '0',
      }),
    ).toBe(false);
  });
  it('reuses healthy services, shares concurrent startup and recovers after a later exit', async () => {
    let healthy = true;
    const launch = vi.fn(async () => {
      healthy = true;
    });
    const service = new LocalAgentStartup({
      healthy: async () => healthy,
      launch,
      wait: async () => {},
    });
    await service.ensure();
    expect(launch).not.toHaveBeenCalled();
    healthy = false;
    await Promise.all([service.ensure(), service.ensure(), service.ensure()]);
    expect(launch).toHaveBeenCalledTimes(1);
    healthy = false;
    await service.ensure();
    expect(launch).toHaveBeenCalledTimes(2);
  });
  it('bounds a failed startup and allows a later retry instead of caching failure', async () => {
    let healthy = false;
    const launch = vi.fn(async () => {});
    const wait = vi.fn(async () => {});
    const service = new LocalAgentStartup({ healthy: async () => healthy, launch, wait });
    await expect(service.ensure()).rejects.toThrow('启动超时');
    expect(wait).toHaveBeenCalledTimes(120);
    launch.mockImplementation(async () => {
      healthy = true;
    });
    await service.ensure();
    expect(launch).toHaveBeenCalledTimes(2);
  });
});
