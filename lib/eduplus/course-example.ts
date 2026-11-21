/** Read only unambiguous JSON examples. Never ask the model to invent an input. */
export function courseExampleInput(
  requirement: string | undefined,
  defaults: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!requirement) return undefined;
  const objects = requirement.match(/\{[^{}]{1,1800}\}/g) ?? [];
  for (const raw of objects) {
    try {
      const value = JSON.parse(raw) as Record<string, unknown>;
      if (
        Object.keys(value).length &&
        Object.keys(value).every((key) => Object.hasOwn(defaults, key))
      )
        return { ...defaults, ...value };
    } catch {
      /* A prose brace is not an example. */
    }
  }
  const arrayFields = Object.keys(defaults).filter((key) => Array.isArray(defaults[key]));
  if (arrayFields.length !== 1) return undefined;
  const arrays = requirement.match(/\[\s*-?\d+(?:\s*,\s*-?\d+)*\s*\]/g) ?? [];
  const unique = [...new Set(arrays.map((raw) => JSON.stringify(JSON.parse(raw))))];
  if (unique.length !== 1) return undefined;
  return { ...defaults, [arrayFields[0]!]: JSON.parse(unique[0]!) };
}

export function courseExampleRule(requirement?: string): string {
  if (!requirement || !/[\[{]/.test(requirement)) return '';
  return (
    '\nCourse example contract: preserve every explicitly supplied example input exactly, including order, duplicates, signs and boundary values. Use it consistently in slides and demonstrations; never silently replace it with a different array or dataset. Other exercises must be clearly identified as separate tasks.\nOriginal request: ' +
    requirement
  );
}
