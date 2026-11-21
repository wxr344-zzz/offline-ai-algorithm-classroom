import { describe, it, expect } from 'vitest';
import { buildAppScene } from '@/lib/generation/app-scene-builder';
import {
  simulationPreview,
  simulationReferenceFromPreview,
} from '@/lib/eduplus/simulation-preview';
import { migrateInteractiveContent } from '@/lib/edit/slide-schema';
import { validateAppScene } from '@/lib/document-store/validators';
import type { GeneratedInteractiveContent, SceneOutline } from '@/lib/types/generation';
import type { InteractiveContent } from '@/lib/types/stage';

const outline: SceneOutline = {
  id: 'sim',
  type: 'interactive',
  title: '01背包交互模拟器',
  description: '',
  keyPoints: [],
  order: 4,
  widgetType: 'simulation',
};
describe('app scene assembly preserves deterministic simulator references', () => {
  it('retains the reference through the real package builder and JSON persistence boundary', () => {
    const content: GeneratedInteractiveContent = {
      html: simulationPreview('01背包算法'),
      widgetType: 'simulation',
      simulation: { topic: '01背包算法', mode: 'simulation' },
    };
    const built = buildAppScene(outline, content, [], 'stage-test')!;
    expect(built.content).toHaveProperty('simulation', content.simulation);
    const saved = JSON.parse(JSON.stringify(built));
    expect(validateAppScene(saved).valid).toBe(true);
    expect(saved.content.simulation).toEqual(content.simulation);
  });
  it('recovers already-written inert previews, including escaped topic names', () => {
    const html = simulationPreview('0/1 背包 & <示例>');
    expect(simulationReferenceFromPreview(html, 'game')).toEqual({
      topic: '0/1 背包 & <示例>',
      mode: 'game',
    });
    const legacy: InteractiveContent = { type: 'interactive', html, widgetType: 'simulation' };
    const fixed = migrateInteractiveContent(legacy);
    expect(fixed.simulation?.topic).toBe('0/1 背包 & <示例>');
    expect(migrateInteractiveContent(fixed)).toBe(fixed);
    expect(legacy.simulation).toBeUndefined();
  });
  it('does not turn arbitrary model HTML into an algorithm executable', () => {
    expect(
      simulationReferenceFromPreview('<h1>01背包：算法推演</h1><p>普通 HTML</p>'),
    ).toBeUndefined();
  });
  it('upgrades our old blocked preview to the dynamic native player as data only', () => {
    const html =
      '<p>此主题尚未匹配到唯一的可信算法执行器，暂不提供自动推演。</p>' +
      '<p>已阻止播放大模型编写的未经验证的中间状态。</p>' +
      "<script>document.getElementById('title').textContent=\"跳跃查找算法\"+'：算法推演';</script>";
    expect(simulationReferenceFromPreview(html)).toEqual({
      topic: '跳跃查找算法',
      mode: 'simulation',
    });
    const fixed = migrateInteractiveContent({
      type: 'interactive',
      html,
      widgetType: 'simulation',
    });
    expect(fixed.simulation?.topic).toBe('跳跃查找算法');
  });
});
