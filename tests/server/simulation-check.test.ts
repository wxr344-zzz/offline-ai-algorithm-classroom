import { describe, expect, it } from 'vitest';
import type { SimulationSpec } from '@/lib/server/generation/widget-fallback';
import {
  contradictions,
  designDirections,
  withoutContradictions,
} from '@/lib/server/generation/simulation-check';

// The reported page: an "acceleration" written as G*m2/(m1*r^2).
const spec: SimulationSpec = {
  title: 'Gravitation',
  intro: '',
  parameters: [
    { id: 'm1', label: 'mass 1', min: 1, max: 1000, step: 1, default: 288 },
    { id: 'm2', label: 'mass 2', min: 1, max: 1000, step: 1, default: 388 },
    { id: 'r', label: 'distance', min: 1, max: 100, step: 1, default: 35 },
  ],
  outputs: [
    { label: 'force', expr: '6.674e-11*m1*m2/r^2' },
    { label: 'wrong force', expr: '6.674e-11*m2/(m1*r^2)' },
  ],
  observations: [],
};

describe('simulation design check', () => {
  it('measures how each displayed quantity moves with each input, even at 1e-13 scale', () => {
    const probes = designDirections(spec);
    const find = (q: string, i: string) => probes.find((p) => p.quantity === q && p.input === i)!;
    expect(find('force', 'mass 1').actual).toBe('up');
    expect(find('force', 'distance').actual).toBe('down');
    expect(find('wrong force', 'mass 1').actual).toBe('down');
  });

  it('flags formulas that contradict the reviewer and keeps the rest', () => {
    const probes = designDirections(spec);
    const reply = JSON.stringify({
      answers: probes.map((p) => (p.input === 'distance' ? 'decreases' : 'increases')),
    });
    const found = contradictions(probes, reply)!;
    expect(found.map((f) => `${f.quantity}/${f.input}`)).toEqual(['wrong force/mass 1']);
    const kept = withoutContradictions(spec, found)!;
    expect(kept.outputs.map((o) => o.label)).toEqual(['force']);
  });

  it('does not judge when the reply is unusable or the relation depends on conditions', () => {
    const probes = designDirections(spec);
    expect(contradictions(probes, 'not json')).toBeNull();
    expect(contradictions(probes, JSON.stringify({ answers: probes.map(() => 'depends') }))).toEqual([]);
  });
});

describe('planning re-designs a simulator that contradicts the subject', () => {
  it('feeds the contradiction back and takes the corrected design', async () => {
    const { planSimulationDesign } = await import('@/lib/server/generation/steps/widget-reliability');
    const { vi } = await import('vitest');
    const design = (expr: string) =>
      JSON.stringify({
        title: 'Universal gravitation simulator',
        intro: 'Move the sliders',
        parameters: spec.parameters,
        plot: {
          xLabel: 'distance',
          xMin: 1,
          xMax: 100,
          curves: [{ label: 'force', expr: expr.replace(/\br\b/g, 'x') }],
        },
        outputs: [{ label: 'force', expr }],
        observations: ['force falls with distance'],
      });
    const reviewer = (_s: string, user: string) => {
      const count = (user.match(/^\d+\./gm) ?? []).length;
      const questions = user.split('\n').filter((l) => /^\d+\./.test(l));
      return JSON.stringify({
        answers: questions
          .slice(0, count)
          .map((q) => (/"distance"/.test(q) ? 'decreases' : /"mass/.test(q) ? 'increases' : 'depends')),
      });
    };
    const aiCall = vi
      .fn()
      .mockResolvedValueOnce(design('6.674e-11*m2/(m1*r^2)'))
      .mockImplementationOnce(async (s: string, u: string) => reviewer(s, u))
      .mockResolvedValueOnce(design('6.674e-11*m1*m2/r^2'))
      .mockImplementationOnce(async (s: string, u: string) => reviewer(s, u));
    const result = await planSimulationDesign({
      outline: {
        id: 's',
        type: 'interactive',
        title: 'Universal gravitation simulator',
        description: '',
        keyPoints: [],
        order: 0,
        widgetType: 'simulation',
        widgetOutline: { concept: 'Universal gravitation' },
      },
      aiCall,
      log: { info: () => {}, warn: () => {} },
      languageDirective: 'Teach the entire course in locale en-US',
    });
    expect(aiCall).toHaveBeenCalledTimes(4);
    expect(aiCall.mock.calls[2]![1]).toContain('scientific errors');
    expect(result?.outputs[0]?.expr).toBe('6.674e-11*m1*m2/r^2');
  });
});

describe('a design that teaches little is asked for again', () => {
  it('names a constant slider and a missing readout', async () => {
    const { designShortcomings } = await import('@/lib/server/generation/steps/widget-reliability');
    const thin: SimulationSpec = {
      ...spec,
      parameters: [...spec.parameters, { id: 'G', label: '万有引力常数', min: 1, max: 20, step: 1, default: 14, unit: 'N' }],
      outputs: [],
      observations: [],
    };
    const issues = designShortcomings(thin, 'zh-CN');
    expect(issues.join('')).toContain('万有引力常数');
    expect(issues.length).toBe(3);
    expect(designShortcomings({ ...spec, observations: ['force falls with distance'] }, 'en')).toEqual([]);
  });

  it('retries a thin design and takes the full one', async () => {
    const { planSimulationDesign } = await import('@/lib/server/generation/steps/widget-reliability');
    const { vi } = await import('vitest');
    const plot = { xLabel: 'distance', xMin: 1, xMax: 100, curves: [{ label: 'force', expr: '6.674e-11*m1*m2/x^2' }] };
    const thin = JSON.stringify({
      title: 'Universal gravitation', intro: 'Move', plot, observations: ['force'],
      parameters: [...spec.parameters, { id: 'G', label: 'gravitational constant', min: 1, max: 20, step: 1, default: 14, unit: 'N' }],
      outputs: [],
    });
    const full = JSON.stringify({
      title: 'Universal gravitation', intro: 'Move', plot, parameters: spec.parameters,
      outputs: [{ label: 'force', expr: '6.674e-11*m1*m2/r^2' }],
      observations: ['force falls as distance grows', 'force grows with either mass'],
    });
    const reviewer = (_s: string, user: string) =>
      JSON.stringify({
        answers: user.split('\n').filter((l) => /^\d+\./.test(l)).map((q) => (/"distance"/.test(q) ? 'decreases' : /"mass/.test(q) ? 'increases' : 'depends')),
      });
    const aiCall = vi.fn().mockResolvedValueOnce(thin).mockResolvedValueOnce(full).mockImplementation(async (s: string, u: string) => reviewer(s, u));
    const result = await planSimulationDesign({
      outline: { id: 's', type: 'interactive', title: 'Universal gravitation simulator', description: '', keyPoints: [], order: 0, widgetType: 'simulation', widgetOutline: { concept: 'Universal gravitation' } },
      aiCall,
      log: { info: () => {}, warn: () => {} },
      languageDirective: 'Teach the entire course in locale en-US',
    });
    expect(aiCall.mock.calls[1]![1]).toContain('constant');
    expect(result?.parameters.map((p) => p.id)).toEqual(['m1', 'm2', 'r']);
    expect(result?.outputs).toHaveLength(1);
  });
});
