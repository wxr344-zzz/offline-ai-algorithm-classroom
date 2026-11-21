import type { Scene } from '@/lib/types/stage';

/** Shared by playback and migration, excluding native labs and simulators. */
export function isLegacyPythonLab(content: Scene['content']): boolean {
  return (
    content.type === 'interactive' &&
    content.widgetType === 'code' &&
    !content.eduplus &&
    !content.simulation &&
    /pyodide/i.test(content.html ?? '')
  );
}
