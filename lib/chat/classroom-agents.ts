/** Saved classrooms retain their own cast when homepage selections change. */
export function classroomAgentIds(
  stage: { agentIds?: readonly string[] } | null | undefined,
  fallback: readonly string[] = [],
): string[] {
  const ids = stage?.agentIds?.length ? stage.agentIds : fallback;
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.trim()))];
  return unique.length ? unique : ['default-1'];
}
