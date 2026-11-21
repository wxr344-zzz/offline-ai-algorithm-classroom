import { describe, expect, it } from 'vitest';
import { ensureLectureDiscussion } from '@/lib/server/generation/lecture-discussion';
import { COURSE_LOCALES } from '@/lib/eduplus/content-language';
import type { SceneOutline } from '@/lib/types/generation';
import type { Action } from '@/lib/types/action';

const outline = (id: string, order: number, type = 'slide') =>
  ({ id, order, type, title: 'Linked lists' }) as SceneOutline;
const pages = [
  outline('intro', 0),
  outline('concept', 1),
  outline('simulator', 2, 'interactive'),
  outline('quiz', 3, 'quiz'),
  outline('summary', 4),
];
const agents = [
  { id: 't', name: 'Teacher', role: 'teacher' },
  { id: 's', name: 'Student', role: 'student' },
] as never;
const promptOf = (actions: Action[]) =>
  actions.find((a): a is Extract<Action, { type: 'discussion' }> => a.type === 'discussion')
    ?.prompt;
const speech = [
  { id: 'line', type: 'speech', text: 'Nodes link to their successors.' },
] as Action[];
describe('native lecture discussion invitation', () => {
  it('offers one invitation after the concept segment, retaining speech and selected roles', () => {
    const perPage = pages.map((page) =>
      ensureLectureDiscussion(speech, page, pages, agents, 'locale en-US'),
    );
    expect(perPage.flat().filter((a) => a.type === 'discussion')).toHaveLength(1);
    expect(perPage[1].at(-1)).toMatchObject({
      type: 'discussion',
      agentId: 's',
      topic: 'Linked lists',
    });
    expect(perPage[1][0]).toBe(speech[0]);
    expect(promptOf(perPage[1])).toContain('Using this page');
  });
  it('preserves authored invitations, teacher-only lessons and quiz behavior', () => {
    const authored = [
      ...speech,
      { id: 'native', type: 'discussion', topic: 'Why?', agentId: 's' },
    ] as Action[];
    expect(ensureLectureDiscussion(authored, pages[1], pages, agents)).toBe(authored);
    expect(
      ensureLectureDiscussion(speech, pages[1], pages, [{ id: 't', role: 'teacher' }] as never),
    ).toBe(speech);
    expect(ensureLectureDiscussion(speech, pages[3], pages, agents)).toBe(speech);
  });
  it.each(['zh-CN', 'zh-TW', 'en-US', ...COURSE_LOCALES])(
    'localizes invitations for %s',
    (locale) => {
      const result = ensureLectureDiscussion(speech, pages[1], pages, agents, `locale ${locale}`);
      expect(promptOf(result)).toBeTruthy();
      if (locale === 'en-US') expect(promptOf(result)).not.toMatch(/[\u4e00-\u9fff]/);
      else if (!locale.startsWith('zh')) expect(promptOf(result)).not.toContain('Using this page');
    },
  );
});
