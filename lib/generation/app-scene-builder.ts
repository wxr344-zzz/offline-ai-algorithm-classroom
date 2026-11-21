import { buildCompleteScene } from '@openmaic/generation';
import type { Scene } from '@/lib/types/stage';
import type { GeneratedInteractiveContent } from '@/lib/types/generation';
import { repairNativeTextClearance } from '@/lib/edit/native-text-clearance';
import { avoidDecorativeTextOverlap } from '@/lib/edit/decorative-text-clearance';
import { removeEmptyBlocks } from '@/lib/edit/empty-shape-cleanup';

/** Keep app-owned interactive references across the package's DSL assembly.
 * The package deliberately knows only portable DSL fields. */
export function buildAppScene(
  ...args: Parameters<typeof buildCompleteScene>
): (Scene & { outlineId: string }) | null {
  const built = buildCompleteScene(...args);
  if (!built) return null;
  if (built.type === 'slide') {
    const canvas = built.content.canvas;
    const elements = avoidDecorativeTextOverlap(
      repairNativeTextClearance(
        removeEmptyBlocks(
          canvas.elements,
          canvas.viewportSize,
          canvas.viewportSize * canvas.viewportRatio,
        ),
        canvas.viewportSize,
        canvas.viewportSize * canvas.viewportRatio,
      ),
      canvas.viewportSize,
      canvas.viewportSize * canvas.viewportRatio,
    );
    return { ...built, content: { ...built.content, canvas: { ...canvas, elements } } };
  }
  const content = args[1];
  if (built.type === 'interactive' && 'html' in content) {
    const extensions = content as GeneratedInteractiveContent;
    return {
      ...built,
      content: {
        ...(built.content as Extract<Scene, { type: 'interactive' }>['content']),
        ...(extensions.simulation ? { simulation: extensions.simulation } : {}),
        ...(extensions.eduplus ? { eduplus: extensions.eduplus } : {}),
      },
    };
  }
  return built as Scene & { outlineId: string };
}
