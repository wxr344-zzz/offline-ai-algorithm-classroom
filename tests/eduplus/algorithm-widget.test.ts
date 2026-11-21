// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { algorithmWidget } from '@/lib/eduplus/algorithm-widget';
import { simulationReferenceFromPreview } from '@/lib/eduplus/simulation-preview';
import { parseTeaching } from '@/lib/eduplus/classroom-contract';
import { REVIEWED_ALGORITHMS, computeReviewedAlgorithm } from '@/lib/eduplus/reviewed-algorithms';
import courseFixture from '@/contracts/examples/public-lab.json';
import teachingFixture from '@/tests/fixtures/eduplus-teaching.json';
import type { PublicCourse } from '@/lib/types/eduplus.generated';

function mount(topic: string, kind: 'simulation' | 'game' = 'simulation') {
  const teaching = parseTeaching(teachingFixture);
  // Deliberately poisoned, yet schema-valid legacy model trace and explanation.
  teaching.demoExplanation = '幻觉说明：负权 Dijkstra 也总是正确';
  teaching.algorithmTrace!.steps[0].explanation = '幻觉步骤：alpha 小于 beta 时剪枝';
  teaching.algorithmTrace!.outcome = '伪造答案';
  const html = algorithmWidget({ ...courseFixture, topic } as PublicCourse, teaching, kind);
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
  const script = parsed.querySelector('script');
  if (script) new Function(script.textContent!)();
  return html;
}
afterEach(() => document.body.replaceChildren());
describe('trusted algorithm widget boundary', () => {
  it('works when the new teaching protocol returns no model trace at all', () => {
    const teaching = { ...parseTeaching(teachingFixture), algorithmTrace: null };
    const html = algorithmWidget(
      { ...courseFixture, topic: 'KMP 算法' } as PublicCourse,
      teaching,
      'simulation',
    );
    expect(html).toContain('computeReviewedAlgorithm');
    expect(html).not.toContain('暂不提供自动推演');
  });
  it.each(REVIEWED_ALGORITHMS)(
    'runs $name from maintained code and ignores every model trace field',
    (descriptor) => {
      const html = mount(descriptor.name);
      expect(html).not.toMatch(/幻觉说明|幻觉步骤|伪造答案/);
      expect(document.querySelector('#reviewed-input')!.getAttribute('aria-invalid')).toBe('false');
      const expected = computeReviewedAlgorithm(descriptor.id, descriptor.input).outcome;
      const next = document.querySelector<HTMLButtonElement>('#next')!;
      for (let i = 0; !next.disabled && i < 1600; i++) next.click();
      expect(next.disabled).toBe(true);
      expect(document.querySelector('#feedback')!.textContent).toBe(
        '推演结束，结果：' + JSON.stringify(expected),
      );
      if (descriptor.id === 'lcs')
        expect(document.querySelectorAll('#matrix td').length).toBeGreaterThan(0);
      if (['bfs', 'dfs', 'dijkstra', 'kruskal', 'prim', 'floyd'].includes(descriptor.id))
        expect(document.querySelectorAll('#graph-svg circle').length).toBeGreaterThan(0);
    },
  );
  it('does not reuse stale steps after an invalid input, and recovers on valid input', () => {
    mount('二分查找');
    const input = document.querySelector<HTMLTextAreaElement>('#reviewed-input')!;
    input.value = '{"array":[3,1],"target":1}';
    document.querySelector<HTMLButtonElement>('#apply-input')!.click();
    expect(document.querySelector('#feedback')!.textContent).toContain('已停止推演');
    expect(document.querySelector<HTMLButtonElement>('#next')!.disabled).toBe(true);
    expect(document.querySelector('#values')!.textContent).toBe('');
    expect(document.querySelector<HTMLElement>('#trace-panel')!.hidden).toBe(true);
    input.value = '{"array":[1,3],"target":3}';
    document.querySelector<HTMLButtonElement>('#apply-input')!.click();
    expect(document.querySelector<HTMLElement>('#trace-panel')!.hidden).toBe(false);
    const next = document.querySelector<HTMLButtonElement>('#next')!;
    while (!next.disabled) next.click();
    expect(document.querySelector('#feedback')!.textContent).toBe('推演结束，结果：1');
  });
  it('recomputes custom input and resets games using real distinguishable execution steps', () => {
    mount('冒泡排序', 'game');
    const input = document.querySelector<HTMLTextAreaElement>('#reviewed-input')!;
    input.value = '{"array":[2,1]}';
    document.querySelector<HTMLButtonElement>('#apply-input')!.click();
    const remaining = () => [...document.querySelectorAll<HTMLButtonElement>('#cards button')];
    const check = document.querySelector<HTMLButtonElement>('#check')!;
    while (remaining().length) remaining()[0].click();
    check.click();
    expect(document.querySelector('#feedback')!.textContent).toContain('顺序不一致');
    document.querySelector<HTMLButtonElement>('#undo')!.click();
    expect(remaining()).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('#apply-input')!.click();
    while (remaining().length) remaining().at(-1)!.click();
    check.click();
    expect(document.querySelector('#feedback')!.textContent).toContain('挑战完成');
  });
  it.each([
    '未收录的新算法',
    '归并排序与快速排序',
    '二分查找的双向变种',
    'Alpha-Beta 双向变体',
    '</script><img src=x onerror=alert(1)>',
  ])('never falls back to hallucinated steps for %s', (topic) => {
    const html = mount(topic);
    expect(document.body.textContent).not.toContain('暂不提供自动推演');
    expect(simulationReferenceFromPreview(html)).toEqual({ topic, mode: 'simulation' });
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('#next')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(html).not.toContain('幻觉步骤');
  });
  it('uses correct Alpha-Beta steps in the game as well as the simulator', () => {
    const html = mount('Alpha-Beta 算法', 'game');
    expect(html).not.toContain('幻觉步骤');
    expect(document.querySelector('#cards')!.textContent).toContain('满足剪枝条件');
    expect(document.querySelector('#example')!.textContent).toContain('独立计算结果：4');
  });
});
