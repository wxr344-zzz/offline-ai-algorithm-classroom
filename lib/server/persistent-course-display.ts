import type { EduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import {
  assertDisplayLanguage,
  displayNeedsTranslation,
  translateTexts,
  type Translate,
} from './course-translation';

/** Presentation-only translations survive restart and offline classroom visits.
 * Owner scoping stays in the store; examples and grading assets are unchanged. */
export async function persistentCourseDisplay(
  store: EduplusCourseStore,
  ownerId: string,
  courseId: string,
  language: string,
  texts: readonly string[],
  translate: Translate,
): Promise<Map<string, string>> {
  const directive = `Teach the entire course in locale ${language}.`;
  const map =
    typeof store.getDisplayTexts === 'function'
      ? await store.getDisplayTexts(ownerId, courseId, language)
      : new Map<string, string>();
  const pending = texts.filter(
    (text) =>
      !map.has(text) ||
      (language.startsWith('en') && displayNeedsTranslation(map.get(text)!, directive)),
  );
  if (pending.length) {
    const fresh = await translateTexts(pending, directive, translate, async (completed) => {
      for (const [source, translated] of completed) map.set(source, translated);
      if (typeof store.saveDisplayTexts === 'function')
        await store.saveDisplayTexts(ownerId, courseId, language, map);
    });
    for (const [source, translated] of fresh) map.set(source, translated);
    assertDisplayLanguage(
      texts.map((text) => map.get(text) ?? text),
      directive,
    );
    if (typeof store.saveDisplayTexts === 'function')
      await store.saveDisplayTexts(ownerId, courseId, language, map);
  }
  assertDisplayLanguage(
    texts.map((text) => map.get(text) ?? text),
    directive,
  );
  return map;
}
