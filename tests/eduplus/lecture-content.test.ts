import { describe, expect, it } from 'vitest';
import type { PPTTextElement } from '@openmaic/dsl';
import {
  cleanLectureElements,
  cleanLectureText,
  lectureKeyPoints,
  repairLectureSlide,
} from '@/lib/eduplus/lecture-content';

describe('learner-facing PPT content', () => {
  it('separates catalog categories and generation instructions from knowledge', () => {
    expect(lectureKeyPoints(['自命题 / 动态规划', '408／排序', '完全背包'])).toEqual([
      '动态规划',
      '排序',
      '完全背包',
    ]);
    expect(cleanLectureText('本页讲容量正序更新。\n原始教学需求（仅供生成）：请求内容')).toBe(
      '本页讲容量正序更新。',
    );
  });
  it('replaces leaked metadata with lesson facts while keeping native styles and IDs', () => {
    const text = {
      id: 'body',
      type: 'text',
      left: 60,
      top: 140,
      width: 880,
      height: 150,
      content:
        '<p><strong style="font-size:20px">教教学主题：完全背包。知识点：自命题 / 动态规划。</strong></p>',
    } as PPTTextElement;
    const fixed = cleanLectureElements([text], ['每类物品可重复选择。']);
    expect(fixed[0]).toMatchObject({ id: text.id, left: 60, top: 140, width: 880 });
    expect((fixed[0] as PPTTextElement).content).toContain('每类物品可重复选择。');
    expect((fixed[0] as PPTTextElement).content).toContain('font-size:20px');
    expect((fixed[0] as PPTTextElement).content).not.toMatch(/自命题|教教学|教学主题/);
    expect(cleanLectureElements(fixed, ['每类物品可重复选择。'])).toBe(fixed);
    const healthy = [{ ...text, content: '<p>dp[i][c]表示容量不超过c时的最优值。</p>' }];
    expect(cleanLectureElements(healthy, [])).toBe(healthy);
  });
  it('replaces contaminated example fragments with defined subject matter in native text slots', () => {
    const base = { type: 'text', left: 60, width: 880, height: 90 };
    const title = {
      ...base,
      id: 'title',
      top: 40,
      content: '<p>完全背包的基本公式</p>',
    } as PPTTextElement;
    const prompt = {
      ...base,
      id: 'prompt',
      top: 140,
      content: '<p>教教学主题：完全背包。知识点：自命题 / 动态规划。</p>',
    } as PPTTextElement;
    const fragment = {
      ...base,
      id: 'fragment',
      top: 250,
      content: '<p>选择=dp[2][1]+5=5；不选=6</p>',
    } as PPTTextElement;
    const facts = ['dp[i][c]表示前i类物品在容量c内的最大价值', '选取时从本行dp[i][c-w_i]转移'];
    const fixed = repairLectureSlide([title, prompt, fragment], '完全背包的基本公式', facts);
    expect(fixed.map((e) => e.id)).toEqual(['title', 'prompt', 'fragment']);
    expect(fixed[0]).toBe(title);
    expect(JSON.stringify(fixed)).not.toMatch(/自命题|教教学|选择=dp/);
    expect(JSON.stringify(fixed)).toContain('dp[i][c-w_i]');
    expect(repairLectureSlide(fixed, '完全背包的基本公式', facts)).toBe(fixed);
  });
});
