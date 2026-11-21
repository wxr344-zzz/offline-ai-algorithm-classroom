import { describe, expect, it, vi } from 'vitest';
import type { PPTElement } from '@openmaic/dsl';
import { repairNativeTextClearance } from '@/lib/edit/native-text-clearance';
import {
  appliedFontScale,
  condenseCrowdedSlide,
  READABLE_FACTOR,
} from '@/lib/server/generation/steps/lecture-density';

const long =
  '快速排序选择一个基准元素，把比它小的放在左边、比它大的放在右边，再递归处理两侧子数组。'.repeat(
    3,
  );
const text = (id: string, top: number, html: string) =>
  ({
    id,
    type: 'text',
    left: 60,
    top,
    width: 880,
    height: 60,
    rotate: 0,
    content: html,
  }) as unknown as PPTElement;
const crowded = () => [
  text('title', 30, '<p><span style="font-size:28px">快速排序算法细节</span></p>'),
  ...Array.from({ length: 6 }, (_, i) =>
    text(`p${i}`, 100 + i * 70, `<p><span style="font-size:18px">${long}</span></p>`),
  ),
];

describe('crowded slides are condensed instead of shrunk', () => {
  it('detects the font scale the layout repair applied', () => {
    expect(appliedFontScale(repairNativeTextClearance(crowded()))).toBeLessThan(READABLE_FACTOR);
    expect(appliedFontScale([text('a', 0, '<p>短</p>')])).toBe(1);
  });

  it('condenses body text into key points that fit at a readable size', async () => {
    const aiCall = vi.fn().mockResolvedValue(
      JSON.stringify({
        texts: Array.from({ length: 6 }, (_, i) => [`要点 ${i + 1}：选基准`, '小的放左、大的放右']),
      }),
    );
    const condensed = (await condenseCrowdedSlide(crowded(), '简体中文', aiCall))!;
    expect(condensed[0]).toEqual(crowded()[0]); // the title is untouched
    expect((condensed[1] as { content: string }).content).toContain('• 要点 1：选基准');
    expect((condensed[1] as { content: string }).content).toContain('font-size:18px');
    expect(appliedFontScale(repairNativeTextClearance(condensed))).toBeGreaterThanOrEqual(
      READABLE_FACTOR,
    );
  });

  it('rejects an answer that is not shorter or has the wrong shape', async () => {
    const same = vi.fn().mockResolvedValue(JSON.stringify({ texts: [[long + long]] }));
    expect(await condenseCrowdedSlide(crowded(), '简体中文', same)).toBeNull();
    const junk = vi.fn().mockResolvedValue('not json');
    expect(await condenseCrowdedSlide(crowded(), '简体中文', junk)).toBeNull();
  });
});
