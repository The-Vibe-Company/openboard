/** Normalize an upload name using the upstream basename and length rules. */
export function fileName(name: string | null): string {
  const leaf = (name ?? "").split(/[\\/]/).at(-1) ?? "";
  const cleaned = Array.from(leaf)
    .filter((char) => char >= " " && char.charCodeAt(0) !== 127)
    .join("");
  return cleaned.trim().slice(0, 255) || "file";
}

export function fileNameProblem(name: string): string | undefined {
  if (name.startsWith(".")) return `attachment names can't start with a dot: ${JSON.stringify(name)}`;
  if (/[\p{Cf}\u2028\u2029]/u.test(name)) {
    return `attachment names can't hold invisible formatting characters: ${JSON.stringify(name)}`;
  }
}
