import { withEduplusOwner } from '@/lib/server/eduplus-route';
import { requestSimulation } from '@/lib/server/exam-simulator';
import { cachedTranslation, translationKey, translateTexts } from '@/lib/server/course-translation';
import { teachingModelCall } from '@/lib/server/lab-display-model';
export const runtime = 'nodejs';
export function GET(request: Request) {
  const lang = new URL(request.url).searchParams.get('lang') ?? '';
  return withEduplusOwner(request, async (owner, headers) => {
    const result = (await requestSimulation(
      undefined,
      request.signal,
      /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(lang) ? lang : undefined,
    )) as { profiles: Array<{ title: string; section: string }> };
    if (lang && !/^(?:en|zh-CN)(?:-|$)/i.test(lang) && Array.isArray(result.profiles)) {
      const profiles = result.profiles;
      const texts = profiles.flatMap((profile) => [profile.title, profile.section]);
      const map = await cachedTranslation(translationKey([owner, lang, ...texts]), () =>
        translateTexts(
          texts,
          `Teach the entire course in locale ${lang}.`,
          teachingModelCall(owner, request.signal),
        ),
      );
      result.profiles = profiles.map((profile) => ({
        ...profile,
        title: map.get(profile.title) ?? profile.title,
        section: map.get(profile.section) ?? profile.section,
      }));
    }
    return Response.json(result, { headers });
  });
}
