import { getEduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import { withEduplusOwner } from '@/lib/server/eduplus-route';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  return withEduplusOwner(request, async (ownerId, headers) => {
    const courses = await (await getEduplusCourseStore()).list(ownerId);
    return Response.json({ courses }, { headers });
  });
}
