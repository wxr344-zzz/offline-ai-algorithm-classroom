import { expect, it, vi } from 'vitest';
import type { PPTElement, PPTTextElement } from '@openmaic/dsl';
import { localizeLectureElements } from '@/lib/server/generation/steps/lecture-language';

const text = (content: string): PPTTextElement => ({
  type: 'text',
  id: 'body',
  left: 40,
  top: 100,
  width: 800,
  height: 200,
  content,
  defaultFontName: '',
  defaultColor: '#000',
  rotate: 0,
});

it('also translates prose carried by native shapes while preserving their styles', async () => {
  const source = [
    {
      id: 'card',
      type: 'shape',
      text: {
        content: '<p>Compare the values.</p>',
        defaultFontName: 'Arial',
        defaultColor: '#333',
      },
      fill: '#eee',
    },
  ] as unknown as PPTElement[];
  const result = await localizeLectureElements(
    source,
    '全课程使用简体中文',
    async () => '{"texts":["比较这些数值。"]}',
  );
  expect(result[0]).toMatchObject({
    id: 'card',
    fill: '#eee',
    text: { defaultFontName: 'Arial', content: '<p>比较这些数值。</p>' },
  });
});

it('localizes leaked English prose without changing native styles, identities, code or math', async () => {
  const elements: PPTElement[] = [
    text(
      '<p style="color:red">Compare the first 2 elements.</p><pre>print(sorted(data))</pre><span data-math="true">max value</span>',
    ),
  ];
  const translate = vi.fn().mockResolvedValue(JSON.stringify({ texts: ['比较前 2 个元素。'] }));
  const result = await localizeLectureElements(elements, '全课程使用简体中文', translate);
  expect(result[0]).toMatchObject({ id: 'body', left: 40, top: 100, width: 800 });
  expect((result[0] as PPTTextElement).content).toContain('style="color:red"');
  expect((result[0] as PPTTextElement).content).toContain('<pre>print(sorted(data))</pre>');
  expect((result[0] as PPTTextElement).content).toContain('data-math="true">max value');
  expect(translate.mock.calls[0][1]).toBe('["Compare the first 2 elements."]');
  expect((elements[0] as PPTTextElement).content).toContain('Compare');
});

it('rejects a translation that changes worked example numbers', async () => {
  await expect(
    localizeLectureElements(
      [text('Compare the first 2 elements.')],
      '简体中文',
      async () => '{"texts":["比较前 3 个元素。"]}',
    ),
  ).rejects.toThrow('数值');
});

it('preserves signs and scientific exponents in worked examples', async () => {
  await expect(
    localizeLectureElements(
      [text('The value is -2 and the tolerance is 1e-3.')],
      '简体中文',
      async () => '{"texts":["值为 2，误差为 1e-3。"]}',
    ),
  ).rejects.toThrow('数值');
});

it('escapes translated text as text, and leaves Chinese and other requested languages alone', async () => {
  const translate = vi.fn().mockResolvedValue('{"texts":["当 x < 2 时返回。"]}');
  const result = await localizeLectureElements(
    [text('Return when x is below 2.')],
    '简体中文',
    translate,
  );
  expect((result[0] as PPTTextElement).content).toContain('&lt;');
  translate.mockClear();
  const chinese = [text('使用 Python 的 dict 和 set 完成任务。')];
  expect(await localizeLectureElements(chinese, '简体中文', translate)).toBe(chinese);
  const english = [text('Compare the first 2 elements.')];
  expect(await localizeLectureElements(english, 'English', translate)).toBe(english);
  expect(translate).not.toHaveBeenCalled();
});

it('translates an English phrase inside mostly Chinese slide prose, keeping function names', async () => {
  const elements: PPTElement[] = [
    text(
      '<p>这些函数用于求已知比值对应的角度，即 trigonometric ratios 的逆运算。</p><p>反正弦函数 arcsin x 的定义域</p>',
    ),
  ];
  const translate = vi
    .fn()
    .mockResolvedValue(
      JSON.stringify({ texts: ['这些函数用于求已知比值对应的角度，即三角比的逆运算。'] }),
    );
  const result = await localizeLectureElements(elements, '全课程使用简体中文', translate);
  const content = (result[0] as PPTTextElement).content;
  expect(content).toContain('三角比的逆运算');
  expect(content).toContain('arcsin x 的定义域');
  // Only the sentence with the English phrase is sent; function names are allowed.
  expect(JSON.parse(translate.mock.calls[0][1])).toHaveLength(1);
  expect(translate.mock.calls[0][0]).toContain('夹杂的英文词语');
});

it('falls back to one passage at a time when the whole-slide answer is unusable', async () => {
  // Reproduces "梯度下降算法是一种优化算法 used to minimize a function…" next to a clean bullet.
  const elements: PPTElement[] = [
    text(
      '<p>梯度下降算法是一种优化算法 used to minimize a function iteratively.</p><p>批量梯度下降 (Batch Gradient Descent)</p><p>The step size is called learning rate.</p>',
    ),
  ];
  const translate = vi
    .fn()
    .mockResolvedValueOnce('not json')
    .mockResolvedValueOnce(
      JSON.stringify({ texts: ['梯度下降算法是一种通过迭代来最小化函数的优化算法。'] }),
    )
    .mockResolvedValueOnce('still not json');
  const result = await localizeLectureElements(elements, '全课程使用简体中文', translate);
  const content = (result[0] as PPTTextElement).content;
  expect(content).toContain('梯度下降算法是一种通过迭代来最小化函数的优化算法。');
  expect(content).toContain('批量梯度下降 (Batch Gradient Descent)');
  expect(translate).toHaveBeenCalledTimes(3);
});
