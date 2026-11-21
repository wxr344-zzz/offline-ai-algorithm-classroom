// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  alphaBetaTrace,
  alphaBetaSimulation,
  type SearchTree,
} from '@/lib/eduplus/alpha-beta-simulation';
import { algorithmWidget } from '@/lib/eduplus/algorithm-widget';
import { parseTeaching } from '@/lib/eduplus/classroom-contract';
import courseFixture from '@/contracts/examples/public-lab.json';
import teachingFixture from '@/tests/fixtures/eduplus-teaching.json';
import type { PublicCourse } from '@/lib/types/eduplus.generated';

function minimax(tree: SearchTree, max: boolean): number {
  if (typeof tree === 'number') return tree;
  const scores = tree.map((child) => minimax(child, !max));
  return max ? Math.max(...scores) : Math.min(...scores);
}
afterEach(() => document.body.replaceChildren());
describe('computed Alpha-Beta simulation', () => {
  it('matches exhaustive minimax across negative, equal, uneven and deeper trees for both players', () => {
    const trees: SearchTree[] = [
      0,
      [
        [3, 5],
        [2, 9],
        [4, 6],
      ],
      [
        [3, 3],
        [3, 99],
      ],
      [
        [-4, -8],
        [-5, -1],
      ],
      [1, [2, [3, 4]], 5],
    ];
    for (let a = -2; a <= 2; a++)
      for (let b = -2; b <= 2; b++)
        trees.push([
          [a, b],
          [b - 1, a + 1],
          [a + b, 0],
        ]);
    for (const tree of trees)
      for (const max of [true, false]) {
        const before = JSON.stringify(tree);
        const trace = alphaBetaTrace(tree, max);
        expect(trace.outcome).toBe(minimax(tree, max));
        expect(JSON.stringify(tree)).toBe(before);
        for (const frame of trace.frames) {
          expect(frame.visited.filter((id) => frame.pruned.includes(id))).toEqual([]);
          if (frame.label === '剪枝') {
            expect(frame.alpha).toBeGreaterThanOrEqual(frame.beta);
            expect(frame.pruned.length).toBeGreaterThan(0);
          }
          if (frame.label === '继续搜索') expect(frame.alpha).toBeLessThan(frame.beta);
        }
      }
  });
  it('rejects boolean leaves instead of inventing a game tree or score conversion', () => {
    expect(() => alphaBetaTrace([false, true, false] as unknown as SearchTree)).toThrow('有限数值');
  });
  it('records the actual cutoff and never evaluates the skipped leaf', () => {
    const trace = alphaBetaTrace([
      [3, 5],
      [2, 9],
      [4, 6],
    ]);
    const cutoff = trace.frames.filter((frame) => frame.label === '剪枝');
    expect(cutoff).toHaveLength(1);
    expect(cutoff[0]).toMatchObject({ alpha: 3, beta: 2, pruned: ['6'] });
    expect(trace.frames.at(-1)!.scores['6']).toBeUndefined();
    expect(trace.outcome).toBe(4);
    const equality = alphaBetaTrace([
      [3, 5],
      [3, 99],
    ]).frames.find((f) => f.label === '剪枝')!;
    expect(equality.alpha).toBe(equality.beta);
    expect(alphaBetaTrace([3, 5, 2]).frames.some((f) => f.label === '剪枝')).toBe(false);
    expect(() => alphaBetaTrace([])).toThrow();
  });
  it('renders the maintained tree, accurate bounds and reversible controls in the actual widget script', () => {
    const html = alphaBetaSimulation('Alpha-Beta 算法');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    document.body.innerHTML = parsed.body.innerHTML;
    new Function(parsed.querySelector('script')!.textContent!)();
    expect(document.querySelector('#bounds')!.textContent).toContain('α = −∞，β = +∞');
    expect(document.querySelector('#example')!.textContent).toContain('Minimax 值：4');
    const next = document.querySelector<HTMLButtonElement>('#next')!;
    while (!next.disabled) {
      next.click();
      if (document.querySelector('#step-title')!.textContent!.endsWith('· 剪枝')) {
        expect(document.querySelector('#explanation')!.textContent).toContain('α=3 ≥ β=2');
        expect(document.querySelector('[data-node="6"]')!.className).toContain('pruned');
        expect(document.querySelector('[data-node="6"]')!.textContent).toContain('未求值');
      }
    }
    expect(document.querySelector('#feedback')!.textContent).toBe('推演结束，结果：4');
    document.querySelector<HTMLButtonElement>('#reset')!.click();
    expect(document.querySelectorAll('.pruned')).toHaveLength(0);
    expect(document.querySelector<HTMLButtonElement>('#back')!.disabled).toBe(true);
  });
  it('replaces only the Alpha-Beta simulator, retaining the existing game', () => {
    const course = { ...courseFixture, topic: 'Alpha-Beta 算法讲解' } as PublicCourse;
    const teaching = parseTeaching(teachingFixture);
    expect(algorithmWidget(course, teaching, 'simulation')).toContain('MAX MIN 博弈树');
    expect(algorithmWidget(course, teaching, 'game')).not.toContain('MAX MIN 博弈树');
    expect(algorithmWidget(course, teaching, 'game')).toContain('将算法步骤按执行顺序排列');
  });
});
