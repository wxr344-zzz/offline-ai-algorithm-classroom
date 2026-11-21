import { withEduplusOwner } from '@/lib/server/eduplus-route';
import { requireSameOrigin } from '@/lib/server/eduplus-request';
import { repairNativeLabs } from '@/lib/server/eduplus-native-repair';
export const runtime = 'nodejs';
export const maxDuration = 660;
export async function POST(request: Request, context: { params: Promise<{ stageId: string }> }) {
  const { stageId } = await context.params;
  return withEduplusOwner(request, async (_ownerId, headers, principal) => {
    requireSameOrigin(request);
    const result = await repairNativeLabs(principal, stageId, request.signal);
    return Response.json(result, { headers });
  });
}
