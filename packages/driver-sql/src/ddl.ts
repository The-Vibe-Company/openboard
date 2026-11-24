/** The statements of a DDL file, comments removed; DDL holds no `;` inside a literal. */
export function splitStatements(source: string): string[] {
  return source
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}
