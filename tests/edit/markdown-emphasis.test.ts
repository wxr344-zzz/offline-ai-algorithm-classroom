import { describe, expect, it } from 'vitest';
import type { PPTElement } from '@openmaic/dsl';
import {
  emphasisToHtml,
  slideEmphasisToHtml,
  stripEmphasis,
  uprightCjk,
} from '@/lib/edit/markdown-emphasis';

describe('Markdown emphasis written by the model', () => {
  it('becomes bold on slides and plain words in speech (reported: **初始化参数**)', () => {
    expect(emphasisToHtml('<p>• **初始化参数**：从一个初始点开始</p>')).toBe(
      '<p>• <strong>初始化参数</strong>：从一个初始点开始</p>',
    );
    expect(stripEmphasis('首先，我们将**初始化参数**。')).toBe('首先，我们将初始化参数。');
    expect(stripEmphasis('然后，我们**更新参数**，再看 a*b')).toBe('然后，我们更新参数，再看 a*b');
    expect(emphasisToHtml('<p>残留的 ** 符号</p>')).toBe('<p>残留的  符号</p>');
    const elements = [
      { id: 't', type: 'text', content: '<p>**计算梯度**</p>' },
      { id: 'i', type: 'image', src: '/a.png' },
    ] as unknown as PPTElement[];
    const result = slideEmphasisToHtml(elements);
    expect((result[0] as { content: string }).content).toBe('<p><strong>计算梯度</strong></p>');
    expect(result[1]).toBe(elements[1]);
  });
});

describe('italic Chinese (reported: 在<em>机器学习</em>中)', () => {
  it('is set upright; Latin-only italics stay', () => {
    expect(uprightCjk('<p>在<em>机器学习</em>中，梯度下降<i>用于</i>优化</p>')).toBe(
      '<p>在机器学习中，梯度下降用于优化</p>',
    );
    expect(uprightCjk('<p style="font-style: italic;">深度学习</p>')).toBe(
      '<p style="">深度学习</p>',
    );
    expect(uprightCjk('<p>The <em>learning rate</em> matters</p>')).toBe(
      '<p>The <em>learning rate</em> matters</p>',
    );
  });
});

describe('Markdown headings (reported: "### 递归方法" shown literally on a slide)', () => {
  it('become a bold line on slides and plain words in speech; other # stay', () => {
    expect(emphasisToHtml('<p>中序遍历是…</p><p>### 递归方法</p><p>递归方法是…</p>')).toBe(
      '<p>中序遍历是…</p><p><strong>递归方法</strong></p><p>递归方法是…</p>',
    );
    expect(emphasisToHtml('<p>概述<br>## 迭代方法（使用栈）<br>通过栈</p>')).toBe(
      '<p>概述<br><strong>迭代方法（使用栈）</strong><br>通过栈</p>',
    );
    expect(emphasisToHtml('<p>C# 与 #include 保留</p>')).toBe('<p>C# 与 #include 保留</p>');
    expect(stripEmphasis('### 递归方法\n递归是 C# 风格')).toBe('递归方法\n递归是 C# 风格');
  });
});
