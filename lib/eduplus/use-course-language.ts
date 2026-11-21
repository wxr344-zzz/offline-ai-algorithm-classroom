'use client';

import { useOptionalLocale } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store/stage';
import { contentLanguage, type ContentLanguage } from './content-language';

/** The language a classroom's built-in components speak: the course's, then the UI's. */
export function useCourseLanguage(): ContentLanguage {
  const locale = useOptionalLocale();
  const directive = useStageStore((s) => s.stage?.languageDirective);
  return contentLanguage(directive, locale);
}
