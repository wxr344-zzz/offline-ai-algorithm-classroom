import { describe, expect, it } from 'vitest';
import { courseLanguage } from '@/lib/eduplus/course-language';
import { pythonLiteral, publicAssertions } from '@/lib/eduplus/public-assertions';
import { stabilizeTextSlide } from '@/lib/eduplus/slide-layout';
import fixture from '@/contracts/examples/public-lab.json';
import { twoSumSlide } from '@/lib/eduplus/two-sum-slide';
import { isTwoSumTopic, twoSumWidget } from '@/lib/eduplus/two-sum-widget';

describe('course quality boundaries', () => {
  it('recognizes the user alias while excluding explicit scalar addition', () => {
    expect(isTwoSumTopic('请讲解两数加和算法')).toBe(true);
    expect(isTwoSumTopic('Two Sum')).toBe(true);
    expect(isTwoSumTopic('两个整数相加 a+b 标量')).toBe(false);
  });
  it('maintains a complete native slide and the platform observation root for both widgets', () => {
    const slide = twoSumSlide();
    expect(slide.elements).toHaveLength(5);
    expect(JSON.stringify(slide)).toContain('不是数值');
    for (const item of slide.elements) {
      if (item.type !== 'text') throw new Error('Expected text');
      expect(item.top + item.height).toBeLessThan(562.5);
      expect(item.left + item.width).toBeLessThanOrEqual(1000);
    }
    for (const kind of ['game', 'simulation'] as const) {
      const html = twoSumWidget(kind);
      expect(html).toContain('<main id=experiment>');
      expect(html).not.toMatch(/<script[^>]+src=/i);
    }
  });
  it('uses selected Chinese even when the requirement contains English algorithm names', () => {
    expect(courseLanguage('zh-CN', 'Two Sum')).toContain('简体中文');
    expect(courseLanguage(undefined, '两数之和')).toContain('简体中文');
    expect(courseLanguage('en-US', '两数之和')).toContain('en-US');
    expect(courseLanguage('zh-TW', '两数之和')).toContain('繁體中文');
    expect(courseLanguage('zh-Hant-HK')).not.toContain('简体中文');
  });
  it('renders strict public assertions without leaking hidden assessment assets', () => {
    expect(pythonLiteral({ truth: true, none: null, nested: [false, 'None true'] })).toBe(
      '{"truth": True, "none": None, "nested": [False, "None true"]}',
    );
    const assertions = publicAssertions(
      fixture.scenes[0].problem as Parameters<typeof publicAssertions>[0],
    );
    expect(assertions).toHaveLength(fixture.scenes[0].problem.publicTestCases.length);
    expect(assertions[0]).toContain('assert ');
    expect(assertions[0]).not.toContain('候选');
    expect(assertions.join('\n')).not.toContain('hidden');
  });
  it('reflows overflowing and overlapping text into the native slide canvas without dropping text', () => {
    const block = {
      id: 't',
      type: 'text' as const,
      left: -500,
      top: 900,
      width: 6000,
      height: 900,
      rotate: 0,
      defaultFontName: 'Arial',
      defaultColor: '#333333',
      content: '<p style="font-size:120px">逐步检查补数</p>',
    };
    const original = {
      elements: [
        block,
        { ...block, id: 'b', content: '<p>先查找，再记录，避免复用同一下标。</p>' },
      ],
    };
    const result = stabilizeTextSlide(original);
    if (result.elements[0].type !== 'text' || result.elements[1].type !== 'text')
      throw new Error('Expected native text blocks');
    expect(result.elements[0].top + result.elements[0].height).toBeLessThan(result.elements[1].top);
    expect(result.elements[1].top + result.elements[1].height).toBeLessThan(562.5);
    expect(JSON.stringify(result)).toContain('避免复用同一下标');
    expect(original.elements[0].left).toBe(-500);
    expect(JSON.stringify(result)).not.toContain('120px');
  });
});
