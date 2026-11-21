import { describe, expect, it, vi } from 'vitest';
import { parseNumCtx, resolveLocalContextWindow } from '@/lib/server/local-context-window';

describe('local context window', () => {
  it('reads num_ctx from Ollama model parameters', () => {
    expect(parseNumCtx('temperature 0.2\nnum_ctx                        16384')).toBe(16384);
    expect(parseNumCtx('temperature 0.2')).toBeUndefined();
  });

  it('uses the model window for local models and Ollama default when none is set', async () => {
    const shown = vi.fn(async () => new Response(JSON.stringify({ parameters: 'num_ctx 16384' })));
    expect(await resolveLocalContextWindow('http://127.0.0.1:11436/v1', 'm-a', shown)).toBe(16384);
    const bare = vi.fn(async () => new Response(JSON.stringify({ parameters: 'stop "<|im_end|>"' })));
    expect(await resolveLocalContextWindow('http://127.0.0.1:11436/v1', 'm-b', bare)).toBe(4096);
  });

  it('never probes remote hosts', async () => {
    const remote = vi.fn();
    expect(await resolveLocalContextWindow('https://api.example.com/v1', 'm', remote)).toBeUndefined();
    expect(remote).not.toHaveBeenCalled();
  });
});
