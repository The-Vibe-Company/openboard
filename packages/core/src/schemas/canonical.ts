/** Object keys are sorted at every level. Array order is part of the definition. */
export function canonicalSchema(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSchema).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalSchema(object[key])}`)
    .join(",")}}`;
}
