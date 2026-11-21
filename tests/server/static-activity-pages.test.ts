import { describe, expect, it } from 'vitest';
import type { SceneOutline } from '@/lib/types/generation';
import {
  announcedActivity,
  withoutStaticActivityPages,
} from '@/lib/server/eduplus-native-generation';

const page = (id: string, title: string, extra: Partial<SceneOutline> = {}): SceneOutline =>
  ({
    id,
    type: 'slide',
    title,
    description: '',
    keyPoints: ['k'],
    order: 0,
    ...extra,
  }) as SceneOutline;

describe('static pages posing as activities', () => {
  it('recognises what a title announces, in either language', () => {
    expect(announcedActivity('Python Code Practice')).toBe('programming');
    expect(announcedActivity('Java code exercise')).toBe('programming');
    expect(announcedActivity('操作游戏')).toBe('game');
    expect(announcedActivity('引导编程')).toBe('programming');
    expect(announcedActivity('Guided Python Lab')).toBe('programming');
    expect(announcedActivity('Guided JavaScript practice')).toBe('programming');
    expect(announcedActivity('Guided coding')).toBe('programming');
    expect(announcedActivity('Independent Python programming')).toBe('programming');
    expect(announcedActivity('随堂检测')).toBe('quiz');
    expect(announcedActivity('Bubble Sort Simulator')).toBe('simulation');
    expect(announcedActivity('Quick quiz')).toBe('quiz');
    expect(announcedActivity('概念讲解')).toBeNull();
    expect(announcedActivity('Photosynthesis overview')).toBeNull();
  });

  it('drops a placeholder slide when the real activity exists', () => {
    const outlines = [
      page('intro', '课程介绍'),
      page('fake-game', '操作游戏'),
      page('fake-lab', '引导编程'),
      page('fake-quiz', '随堂检测'),
      page('game', '互动游戏', { type: 'interactive', widgetType: 'game' }),
      page('lab', 'Guided Lab', {
        type: 'interactive',
        eduplus: { courseId: 'c', phase: 'guided-lab' } as never,
      }),
      page('quiz', '测验', { type: 'quiz' }),
    ];
    expect(withoutStaticActivityPages(outlines, '简体中文').map((o) => o.id)).toEqual([
      'intro',
      'game',
      'lab',
      'quiz',
    ]);
  });

  it('turns a placeholder into the activity it announces when that activity is missing', () => {
    const result = withoutStaticActivityPages(
      [
        page('intro', 'Overview'),
        page('q', 'Quick quiz'),
        page('g', 'Sorting game'),
        page('p', 'Programming practice'),
      ],
      'Teach the entire course in locale en-US',
    );
    expect(result.map((o) => [o.id, o.type, o.widgetType ?? null, o.title])).toEqual([
      ['intro', 'slide', null, 'Overview'],
      ['q', 'quiz', null, 'Quick quiz'],
      ['g', 'interactive', 'game', 'Sorting game'],
      ['p', 'slide', null, 'Key ideas'],
    ]);
  });
});
