import { expect, it, vi } from 'vitest';
import { cachedDisplayTranslation } from '@/lib/server/lab-display-translation';

it('retries only failed display text instead of retranslating a whole course', async () => {
  const texts = ['已成功的部分', '待修复的部分'];
  const first = vi.fn(async (_s: string, p: string) => {
    const items = JSON.parse(p) as string[];
    if (items.length > 1 || items[0] === texts[1]) throw new Error('Temporary translation failure');
    return JSON.stringify({ texts: ['Successful part'] });
  });
  const initial = await cachedDisplayTranslation(
    'partial-retry-regression',
    texts,
    'English',
    first,
  );
  expect(initial.get(texts[0]!)).toBe('Successful part');
  expect(initial.get(texts[1]!)).toBe(texts[1]);
  const retry = vi.fn(async (_s: string, p: string) => {
    expect(JSON.parse(p)).toEqual([texts[1]]);
    return JSON.stringify({ texts: ['Repaired part'] });
  });
  const final = await cachedDisplayTranslation('partial-retry-regression', texts, 'English', retry);
  expect(final.get(texts[0]!)).toBe('Successful part');
  expect(final.get(texts[1]!)).toBe('Repaired part');
  expect(retry).toHaveBeenCalledTimes(1);
});
