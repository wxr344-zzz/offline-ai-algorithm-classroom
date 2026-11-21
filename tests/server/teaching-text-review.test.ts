import { expect, it, vi } from 'vitest';
import type { PPTElement } from '@openmaic/dsl';
import { reviewSlideTeaching } from '@/lib/server/generation/teaching-text-review';

const slide = (text: string) =>
  [
    {
      id: 'p',
      type: 'text',
      left: 30,
      top: 30,
      width: 900,
      height: 80,
      rotate: 0,
      content: `<p style="font-size:24px">${text}</p>`,
    },
  ] as PPTElement[];

it('repairs malformed JSON quoting before validating the editorial result', async () => {
  const result = await reviewSlideTeaching(
    slide('A = b.'),
    { title: 'Area' },
    async () => '{changes:[{index:0,text:"A = b × h."}],}',
  );
  expect((result[0] as { content: string }).content).toContain('b × h');
});

it('applies only indexed corrections without requiring the model to copy every unchanged slot', async () => {
  const source = [...slide('Title'), { ...slide('A = b.')[0]!, id: 'formula' }];
  const result = await reviewSlideTeaching(source, { title: 'Area' }, async () =>
    JSON.stringify({ changes: [{ index: 1, text: 'A = b × h.' }] }),
  );
  expect((result[0] as { content: string }).content).toContain('Title');
  expect((result[1] as { content: string }).content).toContain('b × h');
});

it('repairs damaged prose inside native text slots and retains their geometry and style', async () => {
  const source = slide('A = b ".');
  const call = vi.fn(async () => JSON.stringify({ texts: ['A = b × h.'] }));
  const result = await reviewSlideTeaching(source, { title: 'Area', language: 'English' }, call);
  expect(result[0]).toMatchObject({ id: 'p', left: 30, top: 30, width: 900 });
  expect((result[0] as { content: string }).content).toContain('font-size:24px');
  expect((result[0] as { content: string }).content).toContain('b × h');
  expect((source[0] as { content: string }).content).toContain('A = b');
});

it('refuses editorial changes to concrete worked-example input', async () => {
  await expect(
    reviewSlideTeaching(slide('Input [5,2,4,1].'), { title: 'Sort' }, async () =>
      JSON.stringify({ texts: ['Input [5,2,9,1].'] }),
    ),
  ).rejects.toThrow('explicit example');
});

it('rejects an invalid correction rather than publishing executable markup', async () => {
  await expect(
    reviewSlideTeaching(slide('Explanation'), { title: 'Lesson' }, async () =>
      JSON.stringify({ texts: ['<script>alert(1)</script>'] }),
    ),
  ).rejects.toThrow('Invalid teaching review');
});

it('does not reintroduce another writing system after slide language correction', async () => {
  await expect(
    reviewSlideTeaching(
      slide('Stack basics'),
      { title: 'Stack', language: 'locale en-US' },
      async () => JSON.stringify({ texts: ['栈的基本操作'] }),
    ),
  ).rejects.toThrow('writing system');
});
