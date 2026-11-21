import { describe, expect, it } from 'vitest';
import { applyNativeTheme } from '@/lib/server/generation/widget-theme';
import { inlineTailwind } from '@/lib/server/generation/widget-tailwind';
import { smokeTestWidget } from '@/lib/server/generation/widget-smoke-test';
import {
  normalizeSimulationSpec,
  renderGameWidget,
  normalizeGameSpec,
  renderSimulationWidget,
} from '@/lib/server/generation/widget-fallback';

const page = (body: string, head = '') =>
  `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

// The reported 幂函数 game, as the local model wrote it: almost no CSS.
const POWER_GAME = page(
  `<div id="game"><h1>幂函数游戏</h1><input type="number" id="x-input" value="1"><button onclick="startGame()">开始</button>
<button id="calc-btn" onclick="calc()">计算 x^3</button><div id="score">得分: 0</div><div id="message">开始游戏！</div></div>
<script>let score=0;function startGame(){document.getElementById('message').textContent='开始';}
function calc(){score+=1;document.getElementById('score').textContent='得分: '+score;}</script>`,
  '<style>body{background:#f0f0f0}</style>',
);

describe('native-style default theme for model-written pages', () => {
  it('adds one layered stylesheet before the page styles, idempotently', () => {
    const out = applyNativeTheme(POWER_GAME);
    expect(out.match(/data-maic-theme/g)).toHaveLength(1);
    expect(out.indexOf('data-maic-theme')).toBeLessThan(out.indexOf('body{background:#f0f0f0}'));
    expect(out).toContain('@layer theme, base, maic-theme, components, utilities;');
    expect(applyNativeTheme(out)).toBe(out);
  });

  it('orders itself after Tailwind preflight and before Tailwind utilities', async () => {
    const tailwind = await inlineTailwind(page('<button class="bg-red-500">x</button>'));
    const out = applyNativeTheme(tailwind);
    // The layer order statement comes before Tailwind's own, so it decides the order.
    expect(out.indexOf('maic-theme, components')).toBeLessThan(out.indexOf('data-maic-tailwind'));
  });

  it('never changes geometry that game logic reads', () => {
    const css = applyNativeTheme(POWER_GAME);
    expect(css).not.toMatch(/\*\s*,\s*\*::before[^{]*\{\s*box-sizing/);
    expect(css).not.toMatch(/:where\(canvas\)\s*\{[^}]*(max-width|margin|border:|width:|height:)/);
    expect(css).not.toMatch(/:where\(body\)\s*\{[^}]*(padding|margin)/);
  });

  it('leaves platform-owned pages alone', () => {
    const sim = renderSimulationWidget(
      normalizeSimulationSpec({
        parameters: [{ id: 'k', label: 'k', min: 1, max: 5 }],
        outputs: [{ label: 'y', expr: 'k^2' }],
      })!,
      'zh-CN',
      't',
    );
    const game = renderGameWidget(
      normalizeGameSpec({
        rounds: [
          { prompt: 'a', options: ['1', '2'], answer: 0 },
          { prompt: 'b', options: ['1', '2'], answer: 1 },
        ],
      })!,
      'zh-CN',
      't',
    );
    expect(applyNativeTheme(sim)).toBe(sim);
    expect(applyNativeTheme(game)).toBe(game);
  });

  it('does not change how the page runs', async () => {
    const before = await smokeTestWidget(POWER_GAME, 'game');
    const after = await smokeTestWidget(applyNativeTheme(POWER_GAME), 'game');
    expect(after).toEqual(before);
    expect(after.errors).toEqual([]);
  }, 30_000);
});
