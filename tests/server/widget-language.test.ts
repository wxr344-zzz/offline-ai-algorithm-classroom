import { describe, expect, it, vi } from 'vitest';
import { localizeWidgetHtml } from '@/lib/server/generation/steps/widget-language';

const EN = 'Teach the entire course in locale en-US, including titles.';
const page = `<!DOCTYPE html><html lang="en-US"><head><style>.x{}</style></head><body>
<div class="controls"><button id="runButton">启动</button><button id="pauseButton" disabled>暂停</button><button id="resetButton">重新开始</button></div>
<input placeholder="输入数组" /><p>Array size 5</p>
<script>
function togglePause(){ isPaused=!isPaused; pauseButton.textContent = isPaused ? '继续' : '暂停'; }
const n = 5;
</script></body></html>`;

describe('model-written page controls follow the course language', () => {
  it('translates captions, attributes and the captions the script switches to', async () => {
    const dictionary: Record<string, string> = {
      启动: 'Start',
      暂停: 'Pause',
      重新开始: 'Restart',
      继续: 'Resume',
      输入数组: 'Enter an array',
    };
    const translate = vi.fn(async (_system: string, prompt: string) => {
      const input = JSON.parse(prompt) as string[];
      return JSON.stringify({ texts: input.map((t) => dictionary[t] ?? t) });
    });
    const html = await localizeWidgetHtml(page, EN, translate);
    expect(html).not.toMatch(/[一-鿿]/);
    expect(html).toContain('<button id="runButton">Start</button>');
    expect(html).toContain("isPaused ? 'Resume' : 'Pause'");
    expect(html).toContain('placeholder="Enter an array"');
    expect(html).toContain('const n = 5;');
  });

  it('also corrects mixed prose in Chinese courses and leaves already-English pages untouched', async () => {
    const mixed = '<p>Array size 5</p>';
    const chinese = await localizeWidgetHtml(mixed, '全课程使用简体中文', async (_s, prompt) =>
      JSON.stringify({
        texts: (JSON.parse(prompt) as string[]).map((text) =>
          text.replace('Array size', '数组长度'),
        ),
      }),
    );
    expect(chinese).toContain('数组长度 5');
    const translate = vi.fn();
    const english = '<button>Start</button>';
    expect(await localizeWidgetHtml(english, EN, translate)).toBe(english);
    expect(translate).not.toHaveBeenCalled();
  });
});
