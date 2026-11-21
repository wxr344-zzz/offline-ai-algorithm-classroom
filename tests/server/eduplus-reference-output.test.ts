import { describe, expect, it } from 'vitest';
import { computeReferenceOutput, referenceEntry } from '@/lib/server/eduplus-reference-output';
import { verifyAnswer } from '@/lib/eduplus/answer-verifier';
import type { PublicProblem } from '@/lib/types/eduplus.generated';

// The batch-processing reference of the reported quicksort OJ page.
const REFERENCE = `class Solution:
    def solve(self, stdin: str) -> str:
        import json
        def algorithm_result(data):
            if not isinstance(data.get('array'), list):
                raise ValueError("输入不符合本题有效域")
            return sorted(data['array'])
        payload = json.loads(stdin)
        results = []; keys = []
        for request in payload['requests']:
            value = algorithm_result(request)
            key = json.dumps(value, sort_keys=True, separators=(',', ':'))
            if key not in keys:
                keys.append(key); results.append(value)
        return json.dumps(results, separators=(',', ':'))
`;
const STDIO = { executionMode: 'stdio', publicTestCases: [] } as unknown as PublicProblem;

describe('reference output for a custom Lab run', () => {
  it('finds the reference entry point', () => {
    expect(referenceEntry(REFERENCE)).toEqual({ className: 'Solution', methodName: 'solve' });
    expect(referenceEntry('print(1)')).toBeNull();
  });

  it('computes the reference output in the WASM sandbox and judges the learner output', async () => {
    const stdin =
      '{"requests":[{"array":[7,3,5,3,1,8,2]},{"array":[8,4,6,4,2,9,3]},{"array":[7,3,5,3,1,8,2]}]}';
    const result = await computeReferenceOutput({ code: REFERENCE, key: 'qs' }, { stdin });
    expect(result).toEqual({ expected: '[[1,2,3,3,5,7,8],[2,3,4,4,6,8,9]]' });
    const expected = (result as { expected: string }).expected;
    // The learner's output from the screenshot, with a trailing newline from print().
    expect(
      verifyAnswer(STDIO, { stdin }, '[[1,2,3,3,5,7,8],[2,3,4,4,6,8,9]]\n', expected).passed,
    ).toBe(true);
    expect(verifyAnswer(STDIO, { stdin }, '[[1,2,3,3,5,7,8]]\n', expected).passed).toBe(false);
  }, 60_000);

  it('reports inputs outside the problem domain instead of a verdict', async () => {
    const result = await computeReferenceOutput(
      { code: REFERENCE, key: 'qs' },
      { stdin: '{"requests":[{"values":[1]}]}' },
    );
    expect(result).toMatchObject({ unavailable: 'invalid-input' });
  }, 60_000);
});
