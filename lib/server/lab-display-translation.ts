import type { PublicCourse } from '@/lib/types/eduplus.generated';
import type { ClassroomTeaching } from '@/lib/types/eduplus-teaching.generated';
import { labDisplayTexts, teachingTexts } from '@/lib/eduplus/lab-display';
import {
  cachedTranslation,
  translateTexts,
  translationKey,
  type Translate,
} from './course-translation';

/** Translations of display texts into the course language, cached per course and text. */
const partialTranslations = new Map<string, Map<string, string>>();
export function cachedDisplayTranslation(
  courseId: string,
  texts: readonly string[],
  directive: string,
  translate: Translate,
): Promise<Map<string, string>> {
  const key = translationKey([courseId, directive, ...texts]);
  return cachedTranslation(key, async () => {
    const previous = partialTranslations.get(key) ?? new Map<string, string>();
    const missing = texts.filter(
      (text) => !previous.has(text) || /[㐀-鿿]/.test(previous.get(text)!),
    );
    const fresh = await translateTexts(missing, directive, translate);
    const merged = new Map([...previous, ...fresh]);
    partialTranslations.set(key, merged);
    if (partialTranslations.size > 200)
      partialTranslations.delete(partialTranslations.keys().next().value!);
    return merged;
  });
}

/** The Lab course's own text (statements, steps, plan) in the course language. */
export function labDisplayTranslation(
  courseId: string,
  course: PublicCourse,
  directive: string,
  translate: Translate,
): Promise<Map<string, string>> {
  return cachedDisplayTranslation(courseId, labDisplayTexts(course), directive, translate);
}

/** The teaching (overview, demo, quiz) in the course language. */
export function teachingDisplayTranslation(
  courseId: string,
  teaching: ClassroomTeaching,
  directive: string,
  translate: Translate,
): Promise<Map<string, string>> {
  return cachedDisplayTranslation(courseId, teachingTexts(teaching), directive, translate);
}
