/**
 * The `LIKE` operand that finds `text` inside a message's lowercased text: lowercased as the stored copy is
 * (Unicode-aware), with `\`, `%` and `_` escaped so each matches only itself under `ESCAPE '\'`.
 */
export function textPattern(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
