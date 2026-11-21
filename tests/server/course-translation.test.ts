import { describe, expect, it, vi } from 'vitest';
import { translateTexts, cachedTranslation } from '@/lib/server/course-translation';
import { applyTeachingTexts } from '@/lib/eduplus/lab-display';

const EN = 'Teach the entire course in locale en-US.';
const dictionary: Record<string, string> = {
  '计算斐波那契数列第 n 项': 'Compute the n-th Fibonacci number',
  '参数 n_max 不超过 30': 'The parameter n_max is at most 30',
  递归: 'Recursion',
  迭代: 'Iteration',
};
const fake = vi.fn(async (_system: string, prompt: string) =>
  JSON.stringify({
    texts: (JSON.parse(prompt) as string[]).map((t) =>
      t.startsWith('参数 n_max 不超过 ')
        ? t.replace('参数', 'The parameter').replace('不超过', 'is at most')
        : (dictionary[t] ?? 'Translated'),
    ),
  }),
);

describe('translating Lab display text', () => {
  it('repairs untranslated prose labels without retranslating the statement or touching JSON/code', async () => {
    const source = '输入形状 [a,b,长度,代价]，示例：{"长度":3,"data":[1,2]}，代码 `长度`';
    const ask = vi.fn(async (_system: string, prompt: string) => {
      const input = JSON.parse(prompt) as string[];
      if (input.length === 2) {
        expect(input).toEqual(['长度', '代价']);
        return JSON.stringify({ texts: ['length', 'cost'] });
      }
      return JSON.stringify({
        texts: input.map((text) =>
          text
            .replace('输入形状', 'Input shape')
            .replace('示例', 'Example')
            .replace('代码', 'Code'),
        ),
      });
    });
    const result = await translateTexts([source], EN, ask);
    expect(result.get(source)).toBe(
      'Input shape [a,b,length,cost]，Example：{"长度":3,"data":[1,2]}，Code `长度`',
    );
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it('translates descriptive input-shape labels while keeping actual JSON examples byte-for-byte', async () => {
    const source = '输入形状 [a,b,长度,代价]，示例：{"长度":3,"data":[1,2]}';
    const ask = vi.fn(async (system: string, prompt: string) => {
      expect(system).toContain('NOT valid JSON');
      expect(system).toContain('Translate those labels');
      return JSON.stringify({
        texts: (JSON.parse(prompt) as string[]).map((text) =>
          text
            .replace('输入形状', 'Input shape')
            .replace('长度', 'length')
            .replace('代价', 'cost')
            .replace('示例', 'Example'),
        ),
      });
    });
    const result = await translateTexts([source], EN, ask);
    expect(result.get(source)).toBe(
      'Input shape [a,b,length,cost]，Example：{"长度":3,"data":[1,2]}',
    );
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it('retries only the rejected item instead of all valid items in an aligned batch', async () => {
    const sources = ['输入数据', '结果数据', '检查数据'];
    const ask = vi.fn(async (_system: string, prompt: string) => {
      const input = JSON.parse(prompt) as string[];
      if (input.length === 3)
        return JSON.stringify({ texts: ['Input data', '仍然中文', 'Check data'] });
      expect(input).toEqual(['结果数据']);
      return JSON.stringify({ texts: ['Result data'] });
    });
    const result = await translateTexts(sources, EN, ask);
    expect([...result.values()]).toEqual(['Input data', 'Result data', 'Check data']);
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it('accepts translated words adjacent to a protected marker without misclassifying them as identifiers', async () => {
    const source = '示例1：[7,8]';
    const result = await translateTexts([source], EN, async (_s, p) =>
      JSON.stringify({
        texts: (JSON.parse(p) as string[]).map((t) => t.replace('示例', 'Example')),
      }),
    );
    expect(result.get(source)).toBe('Example1：[7,8]');
  });
  it('retries a rejected long statement as aligned paragraphs without editing its JSON data', async () => {
    const source = '先处理数据。\n示例：[5,2]';
    const result = await translateTexts([source], EN, async (_s, p) => {
      const texts = JSON.parse(p) as string[];
      if (texts.length === 1) return 'invalid reply';
      return JSON.stringify({
        texts: texts.map((t) =>
          t.replace('先处理数据。', 'Process the data.').replace('示例：', 'Example: '),
        ),
      });
    });
    expect(result.get(source)).toBe('Process the data.\nExample: [5,2]');
  });
  it('keeps numeric constraints outside the model instead of accepting rewritten values', async () => {
    const source = '最多 8 项';
    const result = await translateTexts([source], EN, async (_s, p) => {
      const [masked] = JSON.parse(p) as string[];
      expect(masked).not.toContain('8');
      return JSON.stringify({ texts: [masked!.replace('最多', 'At most').replace('项', 'items')] });
    });
    expect(result.get(source)).toBe('At most 8 items');
  });
  it('rejoins model-split paragraphs only when there is one source statement', async () => {
    const source = '先读取输入。\n再计算结果。';
    const result = await translateTexts([source], EN, async () =>
      JSON.stringify({ texts: ['Read the input.', 'Then compute the result.'] }),
    );
    expect(result.get(source)).toBe('Read the input.\nThen compute the result.');
  });
  it('translates prose around opaque JSON while preserving every example byte', async () => {
    const source = '输入一：{"name":"a}b","values":[1,2]}；输入二：[3,4]';
    const translate = vi.fn(async (_s: string, p: string) => {
      const [masked] = JSON.parse(p) as string[];
      expect(masked).not.toContain('a}b');
      expect(masked).not.toContain('[1,2]');
      return JSON.stringify({
        texts: [masked!.replace('输入一', 'Input 1').replace('输入二', 'Input 2')],
      });
    });
    const result = await translateTexts([source], EN, translate);
    expect(result.get(source)).toBe('Input 1：{"name":"a}b","values":[1,2]}；Input 2：[3,4]');
  });

  it('refuses a translation that drops or duplicates an opaque example marker', async () => {
    const source = '示例数据：[7,8]';
    const bad = vi.fn(async () => JSON.stringify({ texts: ['Example data: []'] }));
    expect((await translateTexts([source], EN, bad)).get(source)).toBe(source);
  });
  it('translates Chinese text for an English course and leaves other text alone', async () => {
    const map = await translateTexts(
      ['计算斐波那契数列第 n 项', 'def fib(n):', '参数 n_max 不超过 30'],
      EN,
      fake,
    );
    expect(map.get('计算斐波那契数列第 n 项')).toBe('Compute the n-th Fibonacci number');
    expect(map.get('def fib(n):')).toBe('def fib(n):');
    expect(map.get('参数 n_max 不超过 30')).toBe('The parameter n_max is at most 30');
  });

  it('keeps a text whose translation loses a number or identifier', async () => {
    const lossy = vi.fn(async () => JSON.stringify({ texts: ['The parameter is small'] }));
    const map = await translateTexts(['参数 n_max 不超过 30'], EN, lossy);
    expect(map.get('参数 n_max 不超过 30')).toBe('参数 n_max 不超过 30');
  });

  it('keeps the original on a failed reply and does nothing for a Chinese course', async () => {
    const broken = vi.fn(async () => 'not json');
    expect((await translateTexts(['递归'], EN, broken)).get('递归')).toBe('递归');
    const never = vi.fn();
    expect((await translateTexts(['递归'], '请使用简体中文授课', never)).get('递归')).toBe('递归');
    expect(never).not.toHaveBeenCalled();
  });

  it('shares one translation per key', async () => {
    const run = vi.fn(async () => new Map([['a', 'b']]));
    await Promise.all([cachedTranslation('k-test', run), cachedTranslation('k-test', run)]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries incomplete cached translations on the next visit', async () => {
    const run = vi.fn(async () => new Map([['递归', '递归']]));
    await cachedTranslation('incomplete-regression', run);
    await cachedTranslation('incomplete-regression', run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps quiz options as written when translation would merge two of them', () => {
    const teaching = {
      overview: '概述',
      demoExplanation: '演示',
      questions: [
        { question: '哪种方法？', analysis: '分析', options: ['递归', '迭代'], answer: 0 },
      ],
    } as never;
    const merged = applyTeachingTexts(
      teaching,
      new Map([
        ['递归', 'Loop'],
        ['迭代', 'Loop'],
        ['概述', 'Overview'],
      ]),
    );
    expect((merged as { questions: { options: string[] }[] }).questions[0]!.options).toEqual([
      '递归',
      '迭代',
    ]);
    expect((merged as { overview: string }).overview).toBe('Overview');
  });
});
