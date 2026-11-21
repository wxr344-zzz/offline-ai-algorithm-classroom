import { describe, expect, it } from 'vitest';
import { readableInlineMath } from '@/lib/edit/inline-math-text';
import { repairNativeTextClearance } from '@/lib/edit/native-text-clearance';
import type { PPTElement } from '@openmaic/dsl';

describe('readable inline formulas on slides', () => {
  it('cleans display delimiters split across paragraphs and function commands before subscripts', () => {
    const result = readableInlineMath(
      '<p>\\[</p><p>\\lim_{x\\to0} \\frac{\\sin x}{x}=1</p><p>\\]</p>',
    );
    expect(result).toContain('lim');
    expect(result).not.toContain('\\[');
    expect(result).not.toContain('\\]');
    expect(result).not.toContain('\\lim');
    expect(result).not.toContain('\\frac');
  });
  it('repairs stripped relation commands only within math delimiters', () => {
    expect(readableInlineMath('<p>对于任意 $n ge 2$，$i le n$。</p>')).toBe(
      '<p>对于任意 n ≥ 2，i ≤ n。</p>',
    );
    expect(readableInlineMath('<p>$a gt b$ and $a lt c$</p>')).toBe('<p>a &gt; b and a &lt; c</p>');
    expect(readableInlineMath('<p>ge is a token; prices $5 and $10</p>')).toBe(
      '<p>ge is a token; prices $5 and $10</p>',
    );
  });
  it('rewrites TeX, including formulas whose backslashes were lost', () => {
    expect(readableInlineMath('<p>例如：计算$sin(30^circ)$</p>')).toBe('<p>例如：计算sin(30°)</p>');
    expect(readableInlineMath('<p>$\\sin^2\\theta + \\cos^2\\theta = 1$</p>')).toBe(
      '<p>sin²θ + cos²θ = 1</p>',
    );
    expect(readableInlineMath('<p>$\\frac{\\sqrt{3}}{2}$，$\\tan 45^\\circ = 1$</p>')).toBe(
      '<p>√3/2，tan 45° = 1</p>',
    );
    expect(readableInlineMath('<p>$P(|X-\\mu| \\geq k\\sigma) \\leq \\frac{1}{k^2}$</p>')).toBe(
      '<p>P(|X-μ| ≥ kσ) ≤ 1/(k²)</p>',
    );
    expect(readableInlineMath('<p>$frac{1}{2}$，$theta$，$a &lt; b$</p>')).toBe(
      '<p>1/2，θ，a &lt; b</p>',
    );
  });

  it('leaves prose, prices and KaTeX markup unchanged', () => {
    for (const html of [
      '<p>价格 $5 and $10 都可以</p>',
      '<p>没有公式</p>',
      '<p><span class="katex">$x^2$</span></p>',
    ])
      expect(readableInlineMath(html)).toBe(html);
  });

  it('is applied to generated slide text before layout', () => {
    const el = {
      id: 't',
      type: 'text',
      left: 100,
      top: 100,
      width: 600,
      height: 40,
      content: '<p><span style="font-size:18px">计算$sin(30^circ)$</span></p>',
    } as PPTElement;
    const [out] = repairNativeTextClearance([el]);
    expect((out as { content: string }).content).toContain('计算sin(30°)');
  });
});

describe('TeX that lost its delimiters or backslashes', () => {
  it('rewrites the reported 反三角函数 slide text', () => {
    expect(readableInlineMath('<p>(y = sin^{-1}(x))，和 (y = \tan^{-1}(x))</p>')).toBe(
      '<p>(y = sin⁻¹(x))，和 (y = tan⁻¹(x))</p>',
    );
    expect(readableInlineMath('<p>正切逆函数：(y = an^{-1}(x))</p>')).toBe(
      '<p>正切逆函数：(y = tan⁻¹(x))</p>',
    );
    expect(readableInlineMath('<p>范围：([-\\frac{\\pi}{2}, \\frac{\\pi}{2}])</p>')).toBe(
      '<p>范围：[-π/2, π/2]</p>',
    );
    expect(readableInlineMath('<p>余弦逆函数的范围：([0, \\pi])</p>')).toBe(
      '<p>余弦逆函数的范围：[0, π]</p>',
    );
  });

  it('leaves bare words and plain parentheses alone', () => {
    const html = '<p>普通文字 pi、in、an apple (x) 不变</p>';
    expect(readableInlineMath(html)).toBe(html);
  });
});

describe('formulas whose backslashes were lost', () => {
  it('rewrites reaction arrows, text groups and subscripts into readable text', () => {
    expect(
      readableInlineMath(
        '<p>• 光驱动转化：CO_2 + H_2mathrm{O} xrightarrow{\\text{光}} 葡萄糖 + O_2</p>',
      ),
    ).toBe('<p>• 光驱动转化：CO₂ + H₂O —光→ 葡萄糖 + O₂</p>');
    expect(
      readableInlineMath('<p>$6CO_2 + 6H_2O \\xrightarrow{光照} C_6H_{12}O_6 + 6O_2$</p>'),
    ).toBe('<p>6CO₂ + 6H₂O —光照→ C₆H₁₂O₆ + 6O₂</p>');
    // Residue of an earlier lossy pass.
    expect(readableInlineMath('<p>CO₂ + H₂mathrmO xrightarrow\\text光 葡萄糖</p>')).toBe(
      '<p>CO₂ + H₂O —光→ 葡萄糖</p>',
    );
    // Prose is left alone.
    expect(readableInlineMath('<p>It takes three times as long in this context.</p>')).toBe(
      '<p>It takes three times as long in this context.</p>',
    );
  });
});
