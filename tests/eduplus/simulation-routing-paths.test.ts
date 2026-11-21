import { describe, expect, it } from 'vitest';
import { resolveSimulationAlgorithm } from '@/lib/eduplus/exam-topic';
import {
  describeSimulatorPage,
  verifiedSimulatorActions,
} from '@/lib/server/generation/simulation-narration';
import { contentLanguage } from '@/lib/eduplus/content-language';

describe('one simulator routing rule for every path', () => {
  it('reaches the maintained executor when the request also describes the lesson form', () => {
    const request =
      'Explain bubble sort with one short numerical example and an interactive simulator. Keep the lesson to two explanation pages and one simulator. No programming lab.';
    expect(
      resolveSimulationAlgorithm([request, 'Bubble Sort', undefined, 'Bubble Sort Simulator']),
    ).toEqual({ algorithm: 'bubble', topic: 'Bubble Sort' });
    expect(
      resolveSimulationAlgorithm([
        '讲解冒泡排序，并安排一个交互模拟器，不要编程实验',
        '冒泡排序交互模拟器',
      ]),
    ).toEqual({
      algorithm: 'bubble',
      topic: '冒泡排序交互模拟器',
    });
  });

  it('keeps the course-level algorithm when the request names it exactly', () => {
    expect(resolveSimulationAlgorithm(['请为我讲解二叉树遍历', '中序遍历模拟器'])?.algorithm).toBe(
      'binary-traversals',
    );
  });

  it('does not absorb comparisons or unmaintained algorithms', () => {
    expect(
      resolveSimulationAlgorithm(['Quick Sort vs Bubble Sort', 'Sorting Algorithms Simulator']),
    ).toBeNull();
    expect(resolveSimulationAlgorithm(['光合作用', 'Photosynthesis simulator'])).toBeNull();
  });
});

describe('simulator narration source', () => {
  it('uses actual game controls without inventing traversal choices or revealing the solution', () => {
    const trace = {
      title: 'Insertion sort',
      input: { array: [5, 2, 4, 1] },
      outcome: [1, 2, 4, 5],
      frames: [],
    } as never;
    const first = verifiedSimulatorActions(trace, 'Teach in English.', 'game');
    const second = verifiedSimulatorActions(trace, 'Teach in English.', 'game');
    const text = first.map((a) => a.text).join('\n');
    expect(text).toContain('Check order');
    expect(text).toContain('Undo');
    expect(text).toContain('[5,2,4,1]');
    expect(text).not.toContain('[1,2,4,5]');
    expect(text).not.toContain('Next');
    expect(new Set([...first, ...second].map((a) => a.id)).size).toBe(first.length + second.length);
  });
  it('narrates later frames conditionally instead of inventing automatic playback', () => {
    const trace = {
      title: 'Insertion sort',
      input: { array: [5, 2, 4, 1] },
      outcome: [1, 2, 4, 5],
      frames: [
        { index: 0, explanation: 'Initial sequence' },
        { index: 1, explanation: 'The key is 2.' },
      ],
    } as never;
    const lines = verifiedSimulatorActions(trace, 'Teach in English.')
      .map((a) => a.text)
      .join('\n');
    expect(lines).toContain('page opens at the initial state');
    expect(lines).toContain('After pressing Next 1 time');
    expect(lines).toContain('The key is 2.');
    expect(lines).toContain('[5,2,4,1]');
    expect(lines).not.toContain('Currently');
  });
  it('lists only the real controls and the verified run, in the course language', () => {
    const html = describeSimulatorPage('Bubble Sort', 'simulation', 'en', {
      title: 'Bubble sort',
      input: { array: [3, 1, 2] },
      frames: [
        {
          index: 0,
          label: 'Initial sequence',
          explanation: 'All indices start at 0.',
          views: [],
          state: {},
        },
        {
          index: 1,
          label: 'Compare adjacent items',
          explanation: '3 > 1: True.',
          views: [],
          state: {},
        },
      ],
      outcome: [1, 2, 3],
    });
    for (const control of ['Previous', 'Next', 'Auto play', 'Pause', 'Restart'])
      expect(html).toContain(`<button>${control}</button>`);
    expect(html).toContain('This run has 2 steps');
    expect(html).toContain('3 &gt; 1: True.');
    expect(html).not.toMatch(/[一-鿿]/);
    expect(describeSimulatorPage('冒泡排序', 'game', 'zh-CN')).toContain(
      '<button>检查顺序</button>',
    );
  });

  it('takes the course language from the stage, not the UI', () => {
    expect(
      contentLanguage('Teach the entire course in locale en-US, including titles.', 'zh-CN'),
    ).toBe('en');
    expect(contentLanguage('全课程使用简体中文：标题……', 'en-US')).toBe('zh-CN');
    expect(contentLanguage(undefined, 'zh-TW')).toBe('zh-TW');
  });
});
