/** The statements of a DDL file, with line comments removed and quoted bodies intact. */
export function splitStatements(source: string): string[] {
  const statements: string[] = [];
  let cursor = 0;
  let statement = "";
  const tokens = /--[^\n]*|(\$(?:[A-Za-z_]\w*)?\$)[\s\S]*?\1|'(?:''|[^'])*'|"(?:""|[^"])*"|;/g;
  for (const { 0: token, index } of source.matchAll(tokens)) {
    if (token !== ";" && !token.startsWith("--")) continue;
    statement += source.slice(cursor, index);
    cursor = index + token.length;
    if (token === ";") {
      if (statement.trim()) statements.push(statement.trim());
      statement = "";
    }
  }
  const remaining = (statement + source.slice(cursor)).trim();
  if (remaining) statements.push(remaining);
  return statements;
}
