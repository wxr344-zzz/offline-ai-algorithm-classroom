import { describe, expect, it } from 'vitest';
import course from '@/contracts/examples/public-lab.json';
import teaching from '@/tests/fixtures/eduplus-teaching.json';
import { buildNativeClassroom, nativeQuizSceneId } from '@/lib/eduplus/classroom-adapter';
import { parseTeaching } from '@/lib/eduplus/classroom-contract';
import { validateAppScene, validateAppStage } from '@/lib/document-store/validators';
import type { PublicCourse } from '@/lib/types/eduplus.generated';

describe('native classroom adapter', () => {
  it('builds six stable native scenes accepted by the actual write validators', () => {
    const built = buildNativeClassroom(course as PublicCourse, parseTeaching(teaching), 1000);
    expect(built.scenes).toHaveLength(6);
    expect(validateAppStage(built.stage).valid).toBe(true);
    for (const scene of built.scenes)
      expect(validateAppScene(scene)).toMatchObject({ valid: true });
    expect(built.scenes[4].id).toBe(nativeQuizSceneId(course.courseId));
    expect(built.scenes[4].type).toBe('quiz');
    expect(built.scenes[2].actions?.at(-1)?.type).toBe('discussion');
    expect(built.outline.generationComplete).toBe(true);
    expect(
      buildNativeClassroom(course as PublicCourse, parseTeaching(teaching), 2000).scenes.map(
        (scene) => scene.id,
      ),
    ).toEqual(built.scenes.map((scene) => scene.id));
    expect(JSON.stringify(built)).not.toMatch(
      /referenceSolution|reference_solution|hiddenTestCases|hidden_test_cases/,
    );
  });
  it('omits programming pages for theory courses', () => {
    const theory: PublicCourse = { ...(course as PublicCourse), requiresLab: false, scenes: [] };
    expect(
      buildNativeClassroom(theory, parseTeaching(teaching)).scenes.map((scene) => scene.title),
    ).toEqual(['概念引入', '公开示例观察', '随堂检测', '学习复盘与导出']);
  });
  it('rejects malformed references and duplicate option text', () => {
    const built = buildNativeClassroom(course as PublicCourse, parseTeaching(teaching));
    const invalid = {
      ...built.scenes[0],
      content: { ...built.scenes[0].content, eduplus: { courseId: '../other', phase: 'evil' } },
    };
    expect(validateAppScene(invalid).valid).toBe(false);
    const bad = structuredClone(teaching);
    bad.questions[0].options[1] = bad.questions[0].options[0];
    expect(() => parseTeaching(bad)).toThrow();
  });
});
