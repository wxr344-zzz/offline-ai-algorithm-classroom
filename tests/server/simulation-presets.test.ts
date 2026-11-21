import { describe, expect, it, vi } from 'vitest';
import { presetSimulationDesign } from '@/lib/server/generation/simulation-presets';
import {
  compileFormula,
  normalizeSimulationSpec,
  renderSimulationWidget,
} from '@/lib/server/generation/widget-fallback';
import { planSimulationDesign } from '@/lib/server/generation/steps/widget-reliability';
import { smokeTestWidget } from '@/lib/server/generation/widget-smoke-test';
import type { SceneOutline } from '@/lib/types/generation';

const evaluate = (expr: string, p: Record<string, number>) =>
  (
    new Function('p', `return ${compileFormula(expr, Object.keys(p))};`) as (
      q: Record<string, number>,
    ) => number
  )(p);

describe('photosynthesis preset', () => {
  const spec = presetSimulationDesign('光合作用过程模拟 光合作用的影响因素', 'zh-CN')!;

  it('is a valid design with textbook-shaped curves', () => {
    expect(spec).not.toBeNull();
    expect(normalizeSimulationSpec(spec)).not.toBeNull();
    const [net, gross] = spec.plot!.curves.map((c) => c.expr);
    const at = (x: number, C = 400, T = 25) => ({ C, T, x });
    // Dark: only respiration, net uptake negative; gross zero.
    expect(evaluate(net!, at(0))).toBeLessThan(0);
    expect(evaluate(gross!, at(0))).toBe(0);
    // Positive at the default light, and saturating: the second 1000 adds less than the first.
    const r1 = evaluate(net!, at(1000)) - evaluate(net!, at(0));
    const r2 = evaluate(net!, at(2000)) - evaluate(net!, at(1000));
    expect(evaluate(net!, at(800))).toBeGreaterThan(5);
    expect(r2).toBeLessThan(r1 / 2);
    // More CO₂ raises the plateau; heat lowers photosynthesis below respiration.
    expect(evaluate(net!, at(1500, 1000))).toBeGreaterThan(evaluate(net!, at(1500, 400)));
    expect(evaluate(net!, at(1500, 400, 45))).toBeLessThan(0);
    // The percentage output stays a percentage.
    const enzyme = spec.outputs.find((o) => o.format === 'percent')!;
    for (const T of [0, 25, 45]) {
      const v = evaluate(enzyme.expr, { I: 800, C: 400, T });
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('follows the course language and only matches photosynthesis', () => {
    expect(presetSimulationDesign('Photosynthesis', 'en')!.title).toBe('Photosynthesis Simulator');
    expect(presetSimulationDesign('光合作用', 'zh-TW')!.title).toBe('光合作用模擬器');
    expect(presetSimulationDesign('细胞呼吸', 'zh-CN')).toBeNull();
    expect(presetSimulationDesign('反三角函数', 'zh-CN')).toBeNull();
  });

  it('is used without asking the model', async () => {
    const aiCall = vi.fn();
    const outline = {
      id: 's2',
      type: 'interactive',
      widgetType: 'simulation',
      title: '光合作用过程模拟',
      description: '',
      keyPoints: [],
      widgetOutline: { concept: '光合作用' },
    } as unknown as SceneOutline;
    const design = await planSimulationDesign({
      outline,
      aiCall,
      log: { info: vi.fn(), warn: vi.fn() },
      languageDirective: '简体中文',
    });
    expect(aiCall).not.toHaveBeenCalled();
    expect(design?.title).toBe('光合作用模拟器');
  });

  it('renders a page that runs, draws on open and marks the current light', async () => {
    const html = renderSimulationWidget(spec, 'zh-CN', '光合作用模拟器');
    expect(html).toContain('marker: "I"');
    expect((await smokeTestWidget(html, 'simulation')).errors).toEqual([]);
  }, 60_000);
});

describe('half-translated speech', async () => {
  const { needsChineseSpeech } = await import('@/lib/server/generation/steps/speech-language');
  it('catches an English word fused into Chinese, not formulas or acronyms', () => {
    expect(needsChineseSpeech('现在，让我们通过light合作用模拟器深入了解这个过程。')).toBe(true);
    expect(needsChineseSpeech('we just covered 梯度下降算法简介')).toBe(true);
    expect(needsChineseSpeech('接下来看批量梯度下降 (Batch Gradient Descent)。')).toBe(false);
    expect(needsChineseSpeech('我们用 Python list 存储，再调用 API。')).toBe(false);
    expect(needsChineseSpeech('我们用sin函数和DNA序列来举例。')).toBe(false);
    expect(needsChineseSpeech('二氧化碳的化学式是CO2，单位是ppm。')).toBe(false);
  });
});

describe('gradient descent preset', () => {
  const spec = presetSimulationDesign('请为我讲解梯度下降算法 交互模拟', 'zh-CN')!;
  it('converges, oscillates or diverges with the learning rate, step by step', async () => {
    expect(spec.title).toBe('梯度下降模拟器');
    const normalized = normalizeSimulationSpec(spec)!;
    expect(normalized.plot?.curves.map((c) => c.start ?? null)).toEqual(['x0', '(x0-2)^2', null]);
    const { curvePoints, designShowsChange } =
      await import('@/lib/server/generation/widget-fallback');
    expect(designShowsChange(normalized)).toBe(true);
    const ids = ['eta', 'x0'];
    const xs = (eta: number) =>
      curvePoints(spec.plot!.curves[0]!, ids, { eta, x0: 6 }, 0, 20).map((p) => p[1]);
    expect(Math.abs(xs(0.2).at(-1)! - 2)).toBeLessThan(0.01); // converges
    expect(xs(0.8)[1]).toBeLessThan(2); // overshoots the optimum
    expect(Math.abs(xs(1.05).at(-1)! - 2)).toBeGreaterThan(4); // diverges
    const html = renderSimulationWidget(spec, 'zh-CN', '梯度下降');
    expect((await smokeTestWidget(html, 'simulation')).errors).toEqual([]);
  }, 60_000);
});
