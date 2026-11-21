import { expect, it } from 'vitest';
import {
  slideEvidence,
  removeUnsupportedVisualClaims,
} from '@/lib/server/generation/slide-grounding';
import type { PPTElement } from '@openmaic/dsl';
import type { Action } from '@/lib/types/action';
const elements = [
  { id: 'body', type: 'text', content: '<p>Light reactions and carbon fixation.</p>' },
] as PPTElement[];
it('uses actual rendered text, not the outline, as narration evidence', () => {
  expect(slideEvidence(elements)).toEqual({
    text: 'Light reactions and carbon fixation.',
    figures: [],
  });
});
it('removes unsupported roadmap claims while retaining real explanation', () => {
  const actions = [
    { id: 'a', type: 'speech', text: '请大家看屏幕，路线图展示了整个体系。光反应产生 ATP。' },
    {
      id: 'b',
      type: 'speech',
      text: 'Look at the flowchart on this slide. Light reactions capture energy.',
    },
  ] as Action[];
  const result = removeUnsupportedVisualClaims(actions, elements);
  expect(result.map((a) => (a.type === 'speech' ? a.text : ''))).toEqual([
    '光反应产生 ATP。',
    'Light reactions capture energy.',
  ]);
});
it('keeps diagram narration when the actual page has a figure', () => {
  const actions = [{ id: 'a', type: 'speech', text: 'Look at the flowchart.' }] as Action[];
  expect(
    removeUnsupportedVisualClaims(actions, [
      ...elements,
      { id: 'image', type: 'image' } as PPTElement,
    ]),
  ).toEqual(actions);
});
it('removes a current-example announcement absent from an introduction without removing the explanation', () => {
  const actions = [
    { id: 'a', type: 'speech', text: '通过求导简化计算。现在我们来看一个例子。' },
  ] as Action[];
  expect(removeUnsupportedVisualClaims(actions, elements)).toEqual([
    { id: 'a', type: 'speech', text: '通过求导简化计算。' },
  ]);
  const withExample = [
    { id: 'e', type: 'text', content: '<p>例题：求极限 sin(x)/x。</p>' },
  ] as PPTElement[];
  expect(removeUnsupportedVisualClaims(actions, withExample)).toEqual(actions);
});
