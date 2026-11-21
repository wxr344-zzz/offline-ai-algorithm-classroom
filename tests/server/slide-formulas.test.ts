import { expect, it, vi } from 'vitest';
import type { PPTElement } from '@openmaic/dsl';
import { prepareSlideFormulas } from '@/lib/server/generation/slide-formulas';
import { slideEvidence } from '@/lib/server/generation/slide-grounding';

it('repairs JSON-swallowed TeX commands in native formula elements and rebuilds their HTML', async () => {
  const source = [
    {
      id: 'formula',
      type: 'latex',
      latex: 'a + b = c + \text{能量}',
      html: 'stale ext',
      left: 10,
      top: 20,
      width: 400,
      height: 40,
    },
  ] as PPTElement[];
  const translate = vi.fn();
  const result = await prepareSlideFormulas(source, '简体中文', translate);
  expect(result[0]).toMatchObject({
    id: 'formula',
    left: 10,
    width: 400,
    latex: 'a + b = c + \\text{能量}',
  });
  expect(result[0].type === 'latex' && result[0].html).not.toContain('stale ext');
  expect(slideEvidence(result).figures[0]).toMatchObject({ formula: 'a + b = c + \\text{能量}' });
  expect(translate).not.toHaveBeenCalled();
});

it('translates only formula prose while preserving coefficients, variables, subscripts and operators', async () => {
  const source = [
    {
      id: 'formula',
      type: 'latex',
      latex: '6CO_2 + 6H_2O + \\text{能量}',
      html: '',
      left: 10,
      top: 20,
      width: 400,
      height: 40,
    },
  ] as PPTElement[];
  const result = await prepareSlideFormulas(source, 'locale en-US', async () =>
    JSON.stringify({ texts: ['energy'] }),
  );
  expect(result[0]).toMatchObject({ latex: '6CO_2 + 6H_2O + \\text{energy}' });
});
