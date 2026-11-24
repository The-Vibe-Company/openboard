import { BoardError } from "@openboard/contract";
import type { PatternNode } from "./pattern.ts";

export function invalidPattern(reason: string, field = "thread.pattern"): never {
  throw new BoardError("invalid_rule", `${field}: ${reason}`);
}

type Range = [number, number];
type ClassPart = { ranges: Range[]; negate?: boolean };
export type CharacterClass = { parts: ClassPart[]; negate?: boolean };
type Atom = { part: ClassPart; literal?: number };

const lineBreaks: Range[] = [
  [10, 10],
  [13, 13],
  [8232, 8233],
];
const controls: Readonly<Record<string, number>> = { "0": 0, f: 12, n: 10, r: 13, t: 9, v: 11 };
const digits: Range[] = [[48, 57]];
const word: Range[] = [...digits, [65, 90], [95, 95], [97, 122]];
const space: Range[] = [
  [9, 13],
  [32, 32],
  [160, 160],
  [5760, 5760],
  [8192, 8202],
  [8232, 8233],
  [8239, 8239],
  [8287, 8287],
  [12288, 12288],
  [65279, 65279],
];

function literal(code: number): Atom {
  return { literal: code, part: { ranges: [[code, code]] } };
}

export function parsePattern(source: string, ignoreCase: boolean) {
  return new PatternParser(source, ignoreCase).parse();
}

class PatternParser {
  private readonly source: string;
  private readonly ignoreCase: boolean;
  private cursor = 0;
  private groups = 0;
  private readonly names: Record<string, number> = Object.create(null);

  constructor(source: string, ignoreCase: boolean) {
    this.source = source;
    this.ignoreCase = ignoreCase;
  }
  private readEscape(inClass: boolean): Atom {
    const token = this.source[this.cursor++];
    if (token === undefined) invalidPattern("unfinished escape");
    const classes: Record<string, Range[]> = { d: digits, w: word, s: space };
    const ranges = classes[token.toLowerCase()];
    if (ranges) return { part: { ranges, negate: token === token.toUpperCase() } };
    if (/^[1-9k]$/.test(token) || (token === "0" && /^\d/.test(this.source.slice(this.cursor)))) {
      invalidPattern("backreferences and octal escapes are unsupported");
    }
    if (token === "x" || token === "u") {
      const length = token === "x" ? 2 : 4;
      const hex = this.source.slice(this.cursor, this.cursor + length);
      if (hex.length !== length || !/^[0-9a-f]+$/i.test(hex)) invalidPattern("invalid hexadecimal escape");
      this.cursor += length;
      return literal(Number.parseInt(hex, 16));
    }
    if (token === "c") {
      const letter = this.source[this.cursor++];
      if (!letter || !/^[a-z]$/i.test(letter)) invalidPattern("invalid control escape");
      return literal(letter.charCodeAt(0) % 32);
    }
    if (inClass && token === "b") return literal(8);
    return literal(controls[token] ?? token.charCodeAt(0));
  }
  private characterClass(): CharacterClass {
    const negate = this.source[this.cursor] === "^";
    if (negate) this.cursor++;
    const parts: ClassPart[] = [];
    const read = () => {
      const token = this.source[this.cursor++];
      if (token === undefined) invalidPattern("unclosed character class");
      return token === "\\" ? this.readEscape(true) : literal(token.charCodeAt(0));
    };
    while (this.source[this.cursor] !== "]") {
      const start = read();
      if (this.source[this.cursor] !== "-" || this.source[this.cursor + 1] === "]") {
        parts.push(start.part);
        continue;
      }
      this.cursor++;
      const end = read();
      if (start.literal === undefined || end.literal === undefined || end.literal < start.literal) {
        invalidPattern("invalid character class range");
      }
      parts.push({ ranges: [[start.literal, end.literal]] });
    }
    this.cursor++;
    return { parts, negate };
  }
  private group(): PatternNode {
    const capture = ++this.groups;
    if (this.source[this.cursor] === "?") {
      const named = /^\?<([A-Za-z_$][\w$]*)>/.exec(this.source.slice(this.cursor));
      const name = named?.[1];
      if (!named || !name) invalidPattern("expected a capturing group or a named capturing group");
      if (Object.hasOwn(this.names, name)) invalidPattern("duplicate group name");
      this.names[name] = capture;
      this.cursor += named[0].length;
    }
    const child = this.choice();
    if (this.source[this.cursor++] !== ")") invalidPattern("unclosed group");
    return { kind: "group", child, capture, last: this.groups };
  }
  private atom(): PatternNode {
    const token = this.source[this.cursor++];
    switch (token) {
      case "(":
        return this.group();
      case "[":
        return { kind: "char", set: this.characterClass() };
      case ".":
        return { kind: "char", set: { parts: [{ ranges: lineBreaks }], negate: true } };
      case "^":
        return { kind: "start" };
      case "$":
        return { kind: "end" };
      case "\\": {
        const marker = this.source[this.cursor];
        if (marker === "b" || marker === "B") {
          this.cursor++;
          return { kind: marker === "b" ? "boundary" : "nonboundary" };
        }
        return { kind: "char", set: { parts: [this.readEscape(false).part] } };
      }
      default:
        if (token === undefined || "*+?{}".includes(token)) invalidPattern("unexpected quantifier or brace");
        return { kind: "char", set: { parts: [literal(token.charCodeAt(0)).part] } };
    }
  }
  private term(): PatternNode {
    const child = this.atom();
    if (child.kind === "char" && this.ignoreCase) child.set = canonicalClass(child.set);
    const token = this.source[this.cursor];
    let min: number;
    let max: number | null;
    if (token === "{") {
      const bounds = /^\{(\d+)(?:,(\d+))?\}/.exec(this.source.slice(this.cursor));
      if (!bounds) invalidPattern("expected {n} or {n,m}");
      min = Number(bounds[1]);
      max = Number(bounds[2] ?? bounds[1]);
      if (min > max || max > 20) invalidPattern("expected 0 <= n <= m <= 20");
      this.cursor += bounds[0].length;
    } else if (token === "*" || token === "+" || token === "?") {
      min = token === "+" ? 1 : 0;
      max = token === "?" ? 1 : null;
      this.cursor++;
    } else {
      return child;
    }
    if (child.kind !== "char" && child.kind !== "group") invalidPattern("cannot quantify an assertion");
    const lazy = this.source[this.cursor] === "?";
    if (lazy) this.cursor++;
    return { kind: "repeat", child, min, max, lazy };
  }

  private sequence(): PatternNode {
    const children: PatternNode[] = [];
    while (this.cursor < this.source.length && this.source[this.cursor] !== "|" && this.source[this.cursor] !== ")")
      children.push(this.term());
    return { kind: "sequence", children };
  }

  private choice(): PatternNode {
    const first = this.sequence();
    const children = [first];
    while (this.source[this.cursor] === "|") {
      this.cursor++;
      children.push(this.sequence());
    }
    return children.length === 1 ? first : { kind: "choice", children };
  }

  parse() {
    const root = this.choice();
    if (this.cursor !== this.source.length) invalidPattern("unexpected closing parenthesis");
    return { root, names: this.names, groups: this.groups };
  }
}

export function canonical(code: number): number {
  const upper = String.fromCharCode(code).toUpperCase();
  const folded = upper.charCodeAt(0);
  return upper.length === 1 && !(code >= 128 && folded < 128) ? folded : code;
}

function canonicalClass(set: CharacterClass): CharacterClass {
  return {
    ...set,
    parts: set.parts.map((part) => {
      const points = new Set<number>();
      for (const [start, end] of part.ranges) {
        for (let code = start; code <= end; code++) points.add(canonical(code));
      }
      const ranges: Range[] = [];
      for (const code of [...points].sort((a, b) => a - b)) {
        const last = ranges.at(-1);
        if (last && last[1] + 1 === code) last[1] = code;
        else ranges.push([code, code]);
      }
      return { ...part, ranges };
    }),
  };
}
