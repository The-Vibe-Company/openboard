export type SqlToken = { text: string; offset: number };

function endOfBlockComment(sql: string, start: number): number {
  const delimiters = /\/\*|\*\//g;
  delimiters.lastIndex = start + 2;
  let depth = 1;
  for (let match = delimiters.exec(sql); match; match = delimiters.exec(sql)) {
    depth += match[0] === "/*" ? 1 : -1;
    if (depth === 0) return delimiters.lastIndex;
  }
  return sql.length;
}

export function scanSql(sql: string): { statements: SqlToken[][]; contractPhase: boolean } {
  const tokens =
    /[ \t\r\n\f\v]+|--[^\r\n]*|\/\*|[Ee]'(?:\\[\s\S]|''|[^'\\])*'|'(?:''|[^'])*'|(?:[Uu]&)?"(?:""|[^"])*"|\$(?:[A-Za-z_\u0080-\u{10FFFF}][A-Za-z_0-9\u0080-\u{10FFFF}]*)?\$|[A-Za-z_\u0080-\u{10FFFF}][A-Za-z_0-9$\u0080-\u{10FFFF}]*|[\s\S]/uy;
  const escapeContinuation = /'(?:\\[\s\S]|''|[^'\\])*'/uy;
  const statements: SqlToken[][] = [];
  let statement: SqlToken[] = [];
  let contractPhase = false;
  let escapedStringEnd: number | undefined;
  for (let match = tokens.exec(sql); match; match = tokens.exec(sql)) {
    escapeContinuation.lastIndex = match.index;
    const continued =
      match[0].startsWith("'") &&
      escapedStringEnd !== undefined &&
      /[\r\n]/u.test(sql.slice(escapedStringEnd, match.index))
        ? escapeContinuation.exec(sql)
        : null;
    const word = continued?.[0] ?? match[0];
    if (continued) tokens.lastIndex = escapeContinuation.lastIndex;
    if (word === "/*") {
      tokens.lastIndex = endOfBlockComment(sql, match.index);
      escapedStringEnd = undefined;
    } else if (word.startsWith("--")) {
      const lineStart = Math.max(sql.lastIndexOf("\n", match.index - 1), sql.lastIndexOf("\r", match.index - 1));
      if (word.trimEnd() === "-- contract-phase" && sql.slice(lineStart + 1, match.index).trim() === "") {
        contractPhase = true;
      }
    } else if (word === ";") {
      if (statement.length > 0) statements.push(statement);
      statement = [];
      escapedStringEnd = undefined;
    } else if (!/^[ \t\r\n\f\v]/u.test(word)) {
      escapedStringEnd = continued || /^[Ee]'/u.test(word) ? tokens.lastIndex : undefined;
      if (word.startsWith("$") && word.endsWith("$") && word.length > 1) {
        const end = sql.indexOf(word, match.index + word.length);
        tokens.lastIndex = end === -1 ? sql.length : end + word.length;
      }
      statement.push({ text: sql.slice(match.index, tokens.lastIndex), offset: match.index });
    }
  }
  if (statement.length > 0) statements.push(statement);
  return { statements, contractPhase };
}

export function alterActions(words: string[]): string[][] {
  const actions: string[][] = [[]];
  let depth = 0;
  for (const word of words) {
    if (word === "(" || word === "[") depth++;
    if (word === ")" || word === "]") depth--;
    if (word === "," && depth === 0) actions.push([]);
    else actions[actions.length - 1]?.push(word);
  }
  return actions;
}

export function parenthesizedList(words: string[]): string[] {
  const opening = words.indexOf("(");
  if (opening < 0) return [];
  let depth = 1;
  for (let index = opening + 1; index < words.length; index++) {
    if (words[index] === "(") depth++;
    if (words[index] === ")") depth--;
    if (depth === 0) return words.slice(opening + 1, index);
  }
  return [];
}

export function identifierEnd(words: string[], start: number): number {
  return words[start + 1] === "UESCAPE" ? start + 3 : start + 1;
}

export function identifierName(words: string[], start: number, end: number): string {
  const token = words[start] ?? "";
  if (token.startsWith('"')) return token.slice(1, -1).replaceAll('""', '"');
  if (!/^[Uu]&"/u.test(token)) return token.replace(/[A-Z]/gu, (character) => character.toLowerCase());

  const name = token.slice(3, -1).replaceAll('""', '"');
  const escapeCharacter = end - start === 3 ? words[start + 2]?.slice(1, -1) : "\\";
  if (!escapeCharacter) return token;
  const decoded: string[] = [];
  for (let index = 0; index < name.length; index++) {
    const character = name[index];
    if (character !== escapeCharacter) {
      decoded.push(character ?? "");
      continue;
    }
    if (name[index + 1] === escapeCharacter) {
      decoded.push(escapeCharacter);
      index++;
      continue;
    }
    const long = name[index + 1] === "+";
    const digits = name.slice(index + (long ? 2 : 1), index + (long ? 8 : 5));
    const value = Number.parseInt(digits, 16);
    if (digits.length !== (long ? 6 : 4) || !/^[0-9a-f]+$/iu.test(digits) || value > 0x10ffff) return token;
    decoded.push(String.fromCodePoint(value));
    index += long ? 7 : 4;
  }
  return decoded.join("");
}

export function relation(words: string[], index: number): { name: string; only: boolean; actions: string[] } {
  if (words[index] === "IF" && words[index + 1] === "EXISTS") index += 2;
  const only = words[index] === "ONLY";
  if (only) index++;
  const parenthesized = words[index] === "(";
  if (parenthesized) index++;
  const names: string[] = [];
  while (words[index] !== undefined) {
    const end = identifierEnd(words, index);
    names.push(identifierName(words, index, end));
    index = end;
    if (words[index] !== ".") break;
    index++;
  }
  if (parenthesized && words[index] === ")") index++;
  if (words[index] === "*") index++;
  return { name: JSON.stringify(names), only, actions: words.slice(index) };
}
