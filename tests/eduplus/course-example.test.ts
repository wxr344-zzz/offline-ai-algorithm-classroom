import { expect, it } from 'vitest';
import { courseExampleInput } from '@/lib/eduplus/course-example';

it('uses the requested sequence, including duplicates and zero, instead of a catalog example', () => {
  expect(courseExampleInput('Explain sorting with [5,0,2,2,-1].', { array: [7, 3, 1] })).toEqual({
    array: [5, 0, 2, 2, -1],
  });
});
it('does not guess which of several arrays or graph fields an example belongs to', () => {
  expect(courseExampleInput('Compare [1,2] and [2,1]', { array: [] })).toBeUndefined();
  expect(courseExampleInput('Use [2,3,4]', { weights: [], values: [] })).toBeUndefined();
  expect(courseExampleInput('Use {"array":[3,1],"target":1}', { array: [], target: 0 })).toEqual({
    array: [3, 1],
    target: 1,
  });
});
