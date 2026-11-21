import { expect, it, vi } from 'vitest';
import type { PPTElement } from '@openmaic/dsl';
import type { Action } from '@/lib/types/action';
import {
  reviewSlideLesson,
  lessonAlignmentIssues,
} from '@/lib/server/generation/slide-lesson-review';
const elements = [
  {
    id: 'heading',
    type: 'text',
    top: 20,
    left: 30,
    width: 900,
    height: 60,
    content: '<p>Energy changes</p>',
  },
  {
    id: 'body',
    type: 'text',
    top: 120,
    left: 30,
    width: 900,
    height: 250,
    content: '<p>Invented meaningless prose sequence.</p>',
  },
] as PPTElement[];
const actions = [
  { id: 's1', type: 'speech', text: 'This page shows a worked example that is absent.' },
  { id: 'd1', type: 'discussion', topic: 'Energy', agentId: 'student' },
] as Action[];
const context = {
  outline: {
    id: 'o',
    type: 'slide',
    title: 'Energy changes',
    description: 'Explain kinetic energy',
    keyPoints: ['kinetic energy'],
    order: 1,
  },
  language: 'Teach in English.',
} as const;
const repaired = {
  texts: ['Energy changes', 'Kinetic energy depends on mass and speed.'],
  speeches: ['Kinetic energy increases when speed increases at fixed mass.'],
};
it('detects narrated calculations absent from the page even when a critic would approve', () => {
  expect(
    lessonAlignmentIssues(elements, [
      { id: 'math', type: 'speech', text: 'Calculate lim x→0 sin(x)/x.' },
    ] as Action[])[0],
  ).toContain('sin');
  expect(
    lessonAlignmentIssues(
      [...elements, { id: 'f', type: 'latex', latex: '\\lim_{x\\to0}\\sin(x)/x' } as PPTElement],
      [{ id: 'math', type: 'speech', text: 'Calculate lim x→0 sin(x)/x.' }] as Action[],
    ),
  ).toEqual([]);
});
it('leaves an accepted page and narration unchanged', async () => {
  const result = await reviewSlideLesson(
    elements,
    actions,
    context as never,
    async () => '{"ok":true,"issues":[]}',
  );
  expect(result).toEqual({ elements, actions });
  expect(result.elements).toBe(elements);
});
it('derives independent subject facts without exposing the candidate prose', async () => {
  const ask = vi
    .fn()
    .mockResolvedValueOnce('Independent subject facts.')
    .mockResolvedValueOnce('{"ok":true,"issues":[]}');
  await reviewSlideLesson(
    elements,
    actions,
    { ...context, requirement: 'Teach energy' } as never,
    ask,
  );
  expect(ask.mock.calls[0][1]).not.toContain('Invented meaningless');
  expect(ask.mock.calls[1][1]).toContain('Independent subject facts.');
});
it('preserves extra repair sentences under the existing final speech ID', async () => {
  const ask = vi
    .fn()
    .mockResolvedValueOnce('{"ok":false,"issues":["mismatch"]}')
    .mockResolvedValueOnce(
      JSON.stringify({ ...repaired, speeches: ['Explain mass.', 'Then speed.'] }),
    )
    .mockResolvedValueOnce('{"ok":true,"issues":[]}');
  const result = await reviewSlideLesson(elements, actions, context as never, ask);
  expect(result.actions[0]).toMatchObject({ id: 's1', text: 'Explain mass.\nThen speed.' });
  expect(result.actions[1]).toBe(actions[1]);
});
it('packs model paragraphs and removes unused speech slots instead of failing an otherwise valid repair', async () => {
  const ask = vi
    .fn()
    .mockResolvedValueOnce('{"ok":false,"issues":["mismatch"]}')
    .mockResolvedValueOnce(
      JSON.stringify({
        texts: ['Energy changes', 'Mass matters.', 'Speed matters.'],
        speeches: ['Mass and speed determine energy.'],
      }),
    )
    .mockResolvedValueOnce('{"ok":true,"issues":[]}');
  const result = await reviewSlideLesson(
    elements,
    [...actions, { id: 's2', type: 'speech', text: 'Wrong old line' }] as Action[],
    context as never,
    ask,
  );
  const pageText = result.elements
    .filter((e) => e.type === 'text')
    .map((e) => e.content)
    .join('\n');
  expect(pageText).toContain('Mass matters.');
  expect(pageText).toContain('Speed matters.');
  expect(result.actions.map((a) => a.id)).toEqual(['s1', 'd1']);
});
it('repairs page and narration together from the plan, preserving IDs, geometry and discussion', async () => {
  const ask = vi
    .fn()
    .mockResolvedValueOnce('{"ok":false,"issues":["Unreadable body and absent example"]}')
    .mockResolvedValueOnce(JSON.stringify(repaired))
    .mockResolvedValueOnce('{"ok":true,"issues":[]}');
  const result = await reviewSlideLesson(elements, actions, context as never, ask);
  expect(result.elements.map((e) => e.id)).toEqual(['heading', 'body']);
  expect(result.elements[0]!.left).toBeGreaterThanOrEqual(0);
  expect(result.elements[0]!.left + result.elements[0]!.width).toBeLessThanOrEqual(1000);
  expect((result.elements[1] as { content: string }).content).toContain('Kinetic energy');
  expect(result.actions[0]).toMatchObject({ id: 's1', text: repaired.speeches[0] });
  expect(result.actions[1]).toBe(actions[1]);
  // Damaged prose is deliberately not supplied as a template for the repair.
  expect(ask.mock.calls[1][1]).not.toContain('Invented meaningless prose sequence');
  expect(ask.mock.calls[2][1]).toContain(repaired.speeches[0]);
});
it('rejects a repair in the wrong course language', async () => {
  const ask = vi
    .fn()
    .mockResolvedValueOnce('{"ok":false,"issues":["corrupt"]}')
    .mockResolvedValueOnce(JSON.stringify({ ...repaired, speeches: ['这里仍然是中文。'] }));
  await expect(reviewSlideLesson(elements, actions, context as never, ask)).rejects.toThrow(
    'writing system',
  );
});
it('does not let a positive verdict mask untranslated Chinese-course prose', async () => {
  const source = [
    { ...elements[0], content: '<p>课程说明</p>' },
    { ...elements[1], content: '<p>机制与条件。</p>' },
  ] as PPTElement[];
  const ask = vi
    .fn()
    .mockResolvedValueOnce('{"ok":true,"issues":[]}')
    .mockResolvedValueOnce(
      JSON.stringify({
        texts: ['能量变化', '动能取决于质量和速率。'],
        speeches: ['Slide上是 kinetic energy 的条件。'],
      }),
    );
  await expect(
    reviewSlideLesson(
      source,
      actions,
      { ...context, language: '全课程使用简体中文' } as never,
      ask,
    ),
  ).rejects.toThrow('untranslated');
});
it('preserves explicit example inputs rather than silently editing data', async () => {
  const source = [
    elements[0],
    { ...elements[1], content: '<p>Example [5,2,1].</p>' },
  ] as PPTElement[];
  const ask = vi
    .fn()
    .mockResolvedValueOnce('{"ok":false,"issues":["mismatch"]}')
    .mockResolvedValueOnce(JSON.stringify(repaired));
  await expect(reviewSlideLesson(source, actions, context as never, ask)).rejects.toThrow(
    'protected example',
  );
});
it('normalizes model Markdown headings and raw formula delimiters in a repaired page', async () => {
  const ask = vi
    .fn()
    .mockResolvedValueOnce('{"ok":false,"issues":["corrupt"]}')
    .mockResolvedValueOnce(
      JSON.stringify({
        texts: ['Energy changes', '#### Mass and speed\n**Energy** = 1/2 mv²'],
        speeches: ['Energy depends on mass and speed.'],
      }),
    )
    .mockResolvedValueOnce('{"ok":true,"issues":[]}');
  const result = await reviewSlideLesson(elements, actions, context as never, ask);
  const text = result.elements
    .filter((e) => e.type === 'text')
    .map((e) => e.content)
    .join('\n');
  expect(text).toContain('Mass and speed');
  expect(text).not.toContain('####');
  expect(text).not.toContain('**');
});
it('bounds repairs and never accepts a lesson still rejected on review', async () => {
  const ask = vi.fn(async (system: string) =>
    system.startsWith('Reconstruct')
      ? JSON.stringify(repaired)
      : '{"ok":false,"issues":["still incorrect"]}',
  );
  await expect(reviewSlideLesson(elements, actions, context as never, ask)).rejects.toThrow(
    'alignment review',
  );
  expect(ask).toHaveBeenCalledTimes(5);
});
it('rechecks actual canvas capacity after repair even if the critic would approve the wording', async () => {
  const source = [elements[0], { ...elements[1], height: 1000 }] as PPTElement[];
  let repairs = 0;
  const ask = vi.fn(async (system: string) =>
    system.startsWith('Reconstruct')
      ? JSON.stringify(
          ++repairs === 1
            ? {
                texts: [
                  'Energy changes',
                  Array.from({ length: 50 }, (_, i) => `Point ${i}: explanatory detail.`).join(
                    '\n',
                  ),
                ],
                speeches: repaired.speeches,
              }
            : repaired,
        )
      : '{"ok":true,"issues":[]}',
  );
  const result = await reviewSlideLesson(source, actions, context as never, ask);
  expect(repairs).toBe(2);
  expect(result.elements.every((e) => e.top + ('height' in e ? (e.height ?? 0) : 0) <= 554.5)).toBe(
    true,
  );
});

it('does not accept an incorrect quoted claim even when the model also says ok', async () => {
  const ask = vi
    .fn()
    .mockResolvedValueOnce(
      JSON.stringify({
        ok: true,
        issues: [],
        claims: [
          {
            quote: 'Invented meaningless prose sequence.',
            verdict: 'incorrect',
            reason: 'The sentence is not meaningful subject content.',
          },
        ],
      }),
    )
    .mockResolvedValueOnce(JSON.stringify(repaired))
    .mockResolvedValueOnce(
      JSON.stringify({
        ok: true,
        issues: [],
        claims: [
          {
            quote: 'Kinetic energy depends on mass and speed.',
            verdict: 'correct',
            reason: 'These are the dependencies of kinetic energy.',
          },
        ],
      }),
    );
  const result = await reviewSlideLesson(elements, actions, context as never, ask);
  expect(
    result.elements
      .filter((e) => e.type === 'text')
      .map((e) => e.content)
      .join(' '),
  ).toContain('Kinetic energy');
  expect(ask).toHaveBeenCalledTimes(3);
});
it('does not rewrite from a critic quotation that was never present', async () => {
  const ask = vi.fn().mockResolvedValue(
    JSON.stringify({
      ok: true,
      issues: [],
      claims: [
        {
          quote: 'A quotation invented by the reviewer.',
          verdict: 'incorrect',
          reason: 'Unsupported alleged error.',
        },
      ],
    }),
  );
  const result = await reviewSlideLesson(elements, actions, context as never, ask);
  expect(result.elements).toEqual(elements);
  expect(ask).toHaveBeenCalledTimes(1);
});
