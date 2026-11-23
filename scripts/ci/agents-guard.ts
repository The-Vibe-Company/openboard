// docs/codebase.md 5.1: AGENTS.md stays under its byte budget and holds no issue numbers or dates.
// Rules that age (an issue, a day) belong in tickets, docs/decisions.md or the git log.

export const budgetBytes = 9216;

const month =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

const patterns: { kind: string; pattern: RegExp }[] = [
  { kind: "issue reference", pattern: /(?<![\w&])#\d+\b/ },
  { kind: "date", pattern: /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/ },
  { kind: "date", pattern: /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b/ },
  { kind: "date", pattern: new RegExp(`\\b${month}\\.? \\d{1,2}(?:st|nd|rd|th)?,? \\d{4}\\b`) },
  { kind: "date", pattern: new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)? ${month}\\.?,? \\d{4}\\b`) },
  { kind: "date", pattern: new RegExp(`\\b${month}\\.?,? \\d{4}\\b`) },
];

// Returns one message per problem; an empty list means AGENTS.md passes.
export function checkAgents(bytes: Uint8Array, path = "AGENTS.md"): string[] {
  const problems: string[] = [];
  if (bytes.byteLength > budgetBytes) {
    problems.push(`${path}: ${bytes.byteLength} bytes, over the ${budgetBytes}-byte budget; shorten it`);
  }
  const lines = new TextDecoder().decode(bytes).split("\n");
  lines.forEach((line, index) => {
    for (const { kind, pattern } of patterns) {
      const match = pattern.exec(line);
      if (!match) continue;
      problems.push(`${path}:${index + 1}: ${kind} "${match[0]}"; AGENTS.md holds no issue numbers or dates`);
      break;
    }
  });
  return problems;
}

if (import.meta.main) {
  const path = process.argv[2] ?? "AGENTS.md";
  const problems = checkAgents(await Bun.file(path).bytes(), path);
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exit(problems.length > 0 ? 1 : 0);
}
