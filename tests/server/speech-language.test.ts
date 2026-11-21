import { expect, it, vi } from 'vitest';
import {
  localizeSpeeches,
  needsChineseSpeech,
} from '@/lib/server/generation/steps/speech-language';

it('detects leaked prose at a Chinese sentence boundary without treating mathematics as English', () => {
  expect(needsChineseSpeech('Slide上列出了本页的条件。')).toBe(true);
  expect(needsChineseSpeech('这里是不定式 indeterminate form 的情况。')).toBe(true);
  expect(needsChineseSpeech('所以，lim(x→0) sin(x)/x = 1。')).toBe(false);
  expect(needsChineseSpeech('BFS使用队列，DNA和RNA是技术名称。')).toBe(false);
});

it('detects English dialogue even with a Chinese topic, allowing technical names', () => {
  expect(needsChineseSpeech("Welcome to today's class! Let's explore 0/1背包问题。")).toBe(true);
  expect(needsChineseSpeech('Dijkstra 算法')).toBe(false);
  expect(needsChineseSpeech('使用 Python 的 dict 和 set 完成任务。')).toBe(false);
});
it('changes only speech text and preserves action identities and other actions', async () => {
  const actions = [
    { type: 'speech', id: 'a', text: 'Welcome to class!' },
    { type: 'spotlight', id: 'b', text: 'Element label' },
  ];
  const translate = vi.fn().mockResolvedValue('{"texts":["欢迎来到课堂！"]}');
  const result = await localizeSpeeches(actions, '简体中文', translate);
  expect(result[0]).toEqual({ ...actions[0], text: '欢迎来到课堂！' });
  expect(result[1]).toBe(actions[1]);
  expect(actions[0].text).toBe('Welcome to class!');
  await expect(localizeSpeeches(actions, '简体中文', async () => '{"texts":[]}')).rejects.toThrow();
  expect(await localizeSpeeches(actions, 'English', translate)).toBe(actions);
});
it('corrects Traditional Chinese and English courses too, each to its own language', async () => {
  const tw = vi.fn().mockResolvedValue('{"texts":["歡迎來到課堂！"]}');
  const twResult = await localizeSpeeches(
    [{ type: 'speech', text: 'Welcome to class!' }],
    '全課程使用繁體中文',
    tw,
  );
  expect(twResult[0]!.text).toBe('歡迎來到課堂！');
  expect(tw.mock.calls[0]![0]).toContain('繁體中文');
  const en = vi.fn().mockResolvedValue('{"texts":["Next, gradient descent."]}');
  const enResult = await localizeSpeeches(
    [{ type: 'speech', text: '接下来我们看梯度下降。' }],
    'Teach the entire course in locale en-US, including titles.',
    en,
  );
  expect(enResult[0]!.text).toBe('Next, gradient descent.');
  // A translation that is still Chinese is rejected.
  await expect(
    localizeSpeeches(
      [{ type: 'speech', text: '接下来我们看梯度下降。' }],
      'Teach in English',
      async () => '{"texts":["接下来"]}',
    ),
  ).rejects.toThrow();
});
it('translates the discussion card too (reported: "Which method, recursive or iterative, …" in a Chinese course)', async () => {
  const actions = [
    { type: 'speech', id: 's', text: '现在我们来看中序遍历。' },
    {
      type: 'discussion',
      id: 'd',
      topic: 'Which method, recursive or iterative, would you prefer for in-order traversal? Why?',
      prompt: '请说说你的理由。',
    },
  ];
  const translate = vi
    .fn()
    .mockResolvedValue('{"texts":["递归和迭代两种方法，你更喜欢哪一种来做中序遍历？为什么？"]}');
  const result = await localizeSpeeches(actions, '全课程使用简体中文', translate);
  expect(JSON.parse(translate.mock.calls[0]![1])).toEqual([actions[1]!.topic]);
  expect(result[0]).toBe(actions[0]);
  expect(result[1]).toEqual({
    ...actions[1],
    topic: '递归和迭代两种方法，你更喜欢哪一种来做中序遍历？为什么？',
  });
});
