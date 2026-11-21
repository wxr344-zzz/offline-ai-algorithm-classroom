import type { PublicCourse } from '@/lib/types/eduplus.generated';
import type { ClassroomTeaching } from '@/lib/types/eduplus-teaching.generated';

// Only whole-line comments in simple generated templates. Never rewrite code,
// string literals, multiline strings or a learner's saved draft.
function templateComments(code: string): string[] {
  if (/'''|"""/.test(code)) return [];
  return [...code.matchAll(/^[\t ]*#([^\r\n]*)/gm)]
    .map((match) => match[1]!.trim())
    .filter(Boolean);
}
function translatedTemplate(code: string, map: ReadonlyMap<string, string>): string {
  if (/'''|"""/.test(code)) return code;
  return code.replace(/^([\t ]*#)([^\r\n]*)/gm, (original, prefix: string, comment: string) => {
    const translated = map.get(comment.trim());
    return translated ? `${prefix} ${translated}` : original;
  });
}

/**
 * The learner-visible text of a Lab course and its teaching (statements,
 * constraints, sample descriptions, guided steps, plan, overview, quiz). Code,
 * test inputs, expected outputs, ids and versions are not text and never change.
 */
export function labDisplayTexts(
  course: PublicCourse,
  teaching?: ClassroomTeaching | null,
): string[] {
  const texts: string[] = [
    course.topic,
    course.lessonPlan.title,
    ...course.lessonPlan.objectives,
    ...course.lessonPlan.knowledgePoints,
    ...course.commonMistakes,
  ];
  for (const scene of course.scenes) {
    texts.push(...templateComments(scene.interactiveCode));
    texts.push(scene.problem.title, scene.problem.instructions, ...scene.problem.constraints);
    for (const test of scene.problem.publicTestCases) texts.push(test.description);
    if ('teachingSteps' in scene)
      for (const step of scene.teachingSteps) texts.push(step.title, step.instruction, step.hint);
  }
  if (teaching) texts.push(...teachingTexts(teaching));
  return texts.filter((t) => typeof t === 'string' && t.trim());
}

export function teachingTexts(teaching: ClassroomTeaching): string[] {
  return [
    teaching.overview,
    teaching.demoExplanation,
    ...teaching.questions.flatMap((q) => [q.question, q.analysis, ...q.options]),
  ];
}

const pick = (map: ReadonlyMap<string, string>, text: string) => map.get(text) ?? text;

export function applyTeachingTexts(
  teaching: ClassroomTeaching,
  map: ReadonlyMap<string, string>,
): ClassroomTeaching {
  const questions = teaching.questions.map((q) => {
    const options = q.options.map((o) => pick(map, o));
    // Options must stay distinct: a translation that merges two keeps them as written.
    return {
      ...q,
      question: pick(map, q.question),
      analysis: pick(map, q.analysis),
      options: new Set(options.map((o) => o.trim())).size === options.length ? options : q.options,
    };
  });
  return {
    ...teaching,
    overview: pick(map, teaching.overview),
    demoExplanation: pick(map, teaching.demoExplanation),
    questions,
  };
}

/** A display copy of the course in the translated language. */
export function applyLabDisplay(
  course: PublicCourse,
  map: ReadonlyMap<string, string>,
): PublicCourse {
  return {
    ...course,
    topic: pick(map, course.topic),
    lessonPlan: {
      ...course.lessonPlan,
      title: pick(map, course.lessonPlan.title),
      objectives: course.lessonPlan.objectives.map((t) => pick(map, t)),
      knowledgePoints: course.lessonPlan.knowledgePoints.map((t) => pick(map, t)),
    },
    commonMistakes: course.commonMistakes.map((t) => pick(map, t)),
    scenes: course.scenes.map((scene) => ({
      ...scene,
      interactiveCode: translatedTemplate(scene.interactiveCode, map),
      problem: {
        ...scene.problem,
        title: pick(map, scene.problem.title),
        instructions: pick(map, scene.problem.instructions),
        constraints: scene.problem.constraints.map((t) => pick(map, t)),
        publicTestCases: scene.problem.publicTestCases.map((test) => ({
          ...test,
          description: pick(map, test.description),
        })),
      },
      ...('teachingSteps' in scene
        ? {
            teachingSteps: scene.teachingSteps.map((step) => ({
              ...step,
              title: pick(map, step.title),
              instruction: pick(map, step.instruction),
              hint: pick(map, step.hint),
            })),
          }
        : {}),
    })) as PublicCourse['scenes'],
  };
}
