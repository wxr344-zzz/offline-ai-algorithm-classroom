import { expect, it } from 'vitest';
import { isLegacyPythonLab } from '@/lib/eduplus/legacy-lab';
import type { Scene } from '@/lib/types/stage';

it('playback and migration use the same legacy editor predicate', () => {
  const legacy = {
    type: 'interactive',
    widgetType: 'code',
    html: '<script>loadPyodide()</script>',
  } as Scene['content'];
  expect(isLegacyPythonLab(legacy)).toBe(true);
  expect(
    isLegacyPythonLab({
      ...legacy,
      eduplus: { courseId: 'course', phase: 'guided-lab' },
    } as Scene['content']),
  ).toBe(false);
  expect(isLegacyPythonLab({ ...legacy, simulation: { topic: '算法' } } as Scene['content'])).toBe(
    false,
  );
  expect(isLegacyPythonLab({ ...legacy, widgetType: 'simulation' } as Scene['content'])).toBe(
    false,
  );
  expect(isLegacyPythonLab({ ...legacy, html: '<textarea></textarea>' } as Scene['content'])).toBe(
    false,
  );
});
