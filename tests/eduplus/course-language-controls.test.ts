import { describe, expect, it } from 'vitest';
import dictionaries from '@/lib/eduplus/ui-translations.generated.json';
import { labText, classroomText } from '@/lib/eduplus/lab-text';
import { contentLanguage, simulatorText, COURSE_LOCALES } from '@/lib/eduplus/content-language';
import { nativeWidgetText } from '@/lib/server/generation/widget-fallback';
import { courseTarget, localizeSpeeches } from '@/lib/server/generation/steps/speech-language';

const flatten = (object: object) =>
  Object.values(object).map((value) =>
    typeof value === 'function'
      ? value(...Array.from({ length: value.length }, (_, index) => `__ARG_${index}__`))
      : value,
  );
const source = [
  ...new Set(
    [labText('en'), classroomText('en'), simulatorText('en'), nativeWidgetText('en')].flatMap(
      flatten,
    ),
  ),
];

describe('offline course controls follow every supported locale', () => {
  it.each(['zh-TW', ...COURSE_LOCALES])(
    '%s has every control bundled, with intact interpolation markers',
    (locale) => {
      const map = (dictionaries as Record<string, Record<string, string>>)[locale];
      expect(map).toBeDefined();
      for (const text of source) {
        expect(map[text], `${locale}: ${text}`).toBeTruthy();
        const markers = (value: string) => (value.match(/__ARG_\d+__|\{\w+\}/g) ?? []).sort();
        expect(markers(map[text])).toEqual(markers(text));
        if (locale !== 'zh-TW' && locale !== 'ja-JP')
          expect(map[text]).not.toMatch(/[\u3400-\u9fff]/);
      }
    },
  );
  it.each(COURSE_LOCALES)('%s survives routing instead of silently becoming English', (locale) => {
    expect(contentLanguage(`Teach the course in locale ${locale}.`)).toBe(locale);
    expect(courseTarget(`Teach the course in locale ${locale}.`)).toBe(locale);
    expect(labText(locale).runPublic).toBe(
      (dictionaries as Record<string, Record<string, string>>)[locale]['Run public tests'],
    );
    expect(classroomText(locale).passedOf(2, 4)).not.toContain('__ARG_');
  });
  it('translates non-English Latin-script courses rather than applying the Chinese-only detector', async () => {
    const result = await localizeSpeeches(
      [{ type: 'speech', text: 'Welcome to the classroom.' }],
      'locale fr-FR',
      async (system) => {
        expect(system).toContain('fr-FR');
        return JSON.stringify({ texts: ['Bienvenue dans la classe.'] });
      },
    );
    expect(result[0].text).toBe('Bienvenue dans la classe.');
  });
});
