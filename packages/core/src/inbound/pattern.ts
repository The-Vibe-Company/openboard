import { type CharacterClass, invalidPattern, parsePattern } from "./pattern-syntax.ts";

export const PATTERN_LIMIT = 200;
const PROGRAM_LIMIT = 512;

export type PatternNode =
  | { kind: "char"; set: CharacterClass }
  | { kind: "start" | "end" | "boundary" | "nonboundary" }
  | { kind: "sequence" | "choice"; children: PatternNode[] }
  | { kind: "group"; capture: number; child: PatternNode; last: number }
  | { kind: "repeat"; child: PatternNode; min: number; max: number | null; lazy: boolean };
type Instruction =
  | { op: "char"; set: number; next: number }
  | { op: "start" | "end" | "boundary" | "nonboundary"; next: number }
  | { op: "save" | "clear"; slot: number; next: number }
  | { op: "split"; next: number; other: number }
  | { op: "match" };
export type InboundPattern = {
  entry: number;
  code: Instruction[];
  classes: CharacterClass[];
  ignoreCase: boolean;
  names: Record<string, number>;
  groups: number;
};
export function compileInboundPattern(source: string, flags = ""): InboundPattern {
  if (source.length > PATTERN_LIMIT) invalidPattern("maximum length is 200 characters");
  if (flags !== "" && flags !== "i") invalidPattern("only the i flag is supported", "thread.flags");
  const { root, names, groups } = parsePattern(source, flags === "i");
  if (groups === 0) invalidPattern("expected a capturing group");
  const classes = new Map<CharacterClass, number>();
  const code: Instruction[] = [{ op: "match" }];
  function emit(instruction: Instruction): number {
    if (code.length >= PROGRAM_LIMIT) invalidPattern("compiled pattern exceeds 512 instructions");
    return code.push(instruction) - 1;
  }
  function compile(node: PatternNode, next: number): number {
    switch (node.kind) {
      case "sequence":
        return node.children.reduceRight((tail, child) => compile(child, tail), next);
      case "choice":
        return node.children
          .map((child) => compile(child, next))
          .reduceRight((other, head) => emit({ op: "split", next: head, other }));
      case "group": {
        const slot = node.capture * 2;
        const end = emit({ op: "save", slot: slot + 1, next });
        const start = emit({ op: "save", slot, next: compile(node.child, end) });
        let entry = start;
        for (let clear = slot + 2; clear < 2 * (node.last + 1); clear++) {
          entry = emit({ op: "clear", slot: clear, next: entry });
        }
        return entry;
      }
      case "repeat": {
        const split = (take: number, skip: number): Instruction =>
          node.lazy ? { op: "split", next: skip, other: take } : { op: "split", next: take, other: skip };
        const optional = (tail: number) => {
          const entry = compile(node.child, tail);
          return nullable(node.child) ? requireCharacter(code, emit, entry, tail) : entry;
        };
        let tail = next;
        if (node.max === null) {
          tail = emit(split(next, next));
          code[tail] = split(optional(tail), next);
        } else {
          for (let count = node.min; count < node.max; count++) {
            tail = emit(split(optional(tail), next));
          }
        }
        for (let count = 0; count < node.min; count++) tail = compile(node.child, tail);
        return tail;
      }
      case "char": {
        const set = classes.get(node.set) ?? classes.size;
        classes.set(node.set, set);
        return emit({ op: "char", set, next });
      }
      default:
        return emit({ op: node.kind, next });
    }
  }
  return { entry: compile(root, 0), code, classes: [...classes.keys()], ignoreCase: flags === "i", names, groups };
}

function nullable(node: PatternNode): boolean {
  switch (node.kind) {
    case "char":
      return false;
    case "sequence":
      return node.children.every(nullable);
    case "choice":
      return node.children.some(nullable);
    case "group":
      return nullable(node.child);
    case "repeat":
      return node.min === 0 || nullable(node.child);
    default:
      return true;
  }
}

// An optional iteration must consume input. Duplicate only the paths before
// the first character, where reaching the continuation means the body was empty.
function requireCharacter(
  code: Instruction[],
  emit: (instruction: Instruction) => number,
  entry: number,
  continuation: number,
): number {
  const copies = new Map<number, number>();
  function copy(pc: number): number {
    if (pc === continuation || pc === -1) return -1;
    const instruction = code[pc];
    if (!instruction) throw new Error("invalid pattern compiler address");
    if (instruction.op === "char" || instruction.op === "match") return pc;
    const previous = copies.get(pc);
    if (previous !== undefined) return previous;
    const clone = emit(instruction);
    copies.set(pc, clone);
    const next = copy(instruction.next);
    code[clone] =
      instruction.op === "split" ? { ...instruction, next, other: copy(instruction.other) } : { ...instruction, next };
    return clone;
  }
  return copy(entry);
}
