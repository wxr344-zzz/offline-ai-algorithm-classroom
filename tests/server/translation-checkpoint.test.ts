import { describe, expect, it, vi } from 'vitest';
import { persistentCourseDisplay } from '@/lib/server/persistent-course-display';
import type { EduplusCourseStore } from '@/lib/persistence/eduplus-courses';

describe('Lab display translation checkpoints', () => {
  it('keeps completed batches when a later batch fails, then translates only what remains', async () => {
    let saved = new Map<string, string>();
    const store = {
      getDisplayTexts: vi.fn(async () => new Map(saved)),
      saveDisplayTexts: vi.fn(async (_owner, _course, _language, map) => {
        saved = new Map(map);
      }),
    } as unknown as EduplusCourseStore;
    const texts = Array.from({ length: 17 }, (_, i) => `输入${String.fromCharCode(65 + i)}数据`);
    const failed = texts.at(-1)!;
    const reply = (prompt: string) =>
      JSON.stringify({
        texts: (JSON.parse(prompt) as string[]).map((text) =>
          text.replace('输入', 'Input ').replace('数据', ' data'),
        ),
      });
    const first = vi.fn(async (_system: string, prompt: string) => {
      if (prompt.includes(failed)) throw new Error('model interrupted');
      return reply(prompt);
    });
    await expect(
      persistentCourseDisplay(store, 'owner', 'course', 'en-US', texts, first),
    ).rejects.toThrow();
    expect(saved.size).toBe(16);
    expect(saved.has(failed)).toBe(false);
    const resumed = vi.fn(async (_system: string, prompt: string) => reply(prompt));
    const result = await persistentCourseDisplay(store, 'owner', 'course', 'en-US', texts, resumed);
    expect(resumed).toHaveBeenCalledTimes(1);
    expect(JSON.parse(resumed.mock.calls[0][1])).toEqual([failed]);
    expect(result.size).toBe(17);
    expect(store.saveDisplayTexts).toHaveBeenCalledWith(
      'owner',
      'course',
      'en-US',
      expect.any(Map),
    );
  });
});
