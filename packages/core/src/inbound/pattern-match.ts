import { type InboundPattern, PATTERN_LIMIT } from "./pattern.ts";
import { canonical, type CharacterClass } from "./pattern-syntax.ts";

type Capture = { slot: number; value: number; previous: Capture | undefined };
type Thread = { pc: number; start: number; capture?: Capture };
type Match = { index: number; captures: (string | undefined)[]; groups: Record<string, string | undefined> };

function includes(set: CharacterClass, code: number): boolean {
  return (
    set.parts.some(
      (part) => part.ranges.some(([start, end]) => start <= code && code <= end) !== Boolean(part.negate),
    ) !== Boolean(set.negate)
  );
}
function result(pattern: InboundPattern, input: string, thread: Thread, end: number): Match {
  const slots = new Int16Array(2 * (pattern.groups + 1)).fill(-2);
  for (let capture = thread.capture; capture; capture = capture.previous) {
    if (slots[capture.slot] === -2) slots[capture.slot] = capture.value;
  }
  const captures: Match["captures"] = [input.slice(thread.start, end)];
  for (let group = 1; group <= pattern.groups; group++) {
    const start = slots[2 * group] ?? -1;
    const stop = slots[2 * group + 1] ?? -1;
    captures.push(start >= 0 && stop >= 0 ? input.slice(start, stop) : undefined);
  }
  const groups = Object.fromEntries(Object.entries(pattern.names).map(([name, group]) => [name, captures[group]]));
  return { index: thread.start, captures, groups };
}

function step(
  pattern: InboundPattern,
  active: Thread[],
  input: string,
  offset: number,
): { next: Thread[]; matched?: Thread } {
  const seen = new Uint8Array(pattern.code.length);
  const pending = active.reverse();
  const next: Thread[] = [];
  const byte = input.charCodeAt(offset);
  const code = pattern.ignoreCase ? canonical(byte) : byte;
  const boundary = /\w/.test(input[offset - 1] ?? "") !== /\w/.test(input[offset] ?? "");
  for (let thread = pending.pop(); thread; thread = pending.pop()) {
    const { pc, start, capture } = thread;
    if (pc < 0 || seen[pc]) continue;
    seen[pc] = 1;
    const instruction = pattern.code[pc];
    if (!instruction) throw new Error("invalid compiled pattern address");
    switch (instruction.op) {
      case "match":
        return { next, matched: thread };
      case "char": {
        const set = pattern.classes[instruction.set];
        if (set && offset < input.length && includes(set, code)) next.push({ ...thread, pc: instruction.next });
        continue;
      }
      case "split":
        pending.push({ ...thread, pc: instruction.other });
        break;
      case "start":
        if (offset !== 0) continue;
        break;
      case "end":
        if (offset !== input.length) continue;
        break;
      case "boundary":
        if (!boundary) continue;
        break;
      case "nonboundary":
        if (boundary) continue;
        break;
      case "clear":
      case "save":
        pending.push({
          start,
          pc: instruction.next,
          capture: { slot: instruction.slot, value: instruction.op === "save" ? offset : -1, previous: capture },
        });
        continue;
    }
    pending.push({ ...thread, pc: instruction.next });
  }
  return { next };
}

export function matchInboundPattern(pattern: InboundPattern, input: string): Match | null {
  const text = input.slice(0, PATTERN_LIMIT);
  let active: Thread[] = [];
  let best: { thread: Thread; end: number } | undefined;
  for (let offset = 0; offset <= text.length; offset++) {
    // New starts have lower priority than every existing thread.
    if (!best) active.push({ pc: pattern.entry, start: offset });
    const { next, matched } = step(pattern, active, text, offset);
    if (matched) best = { thread: matched, end: offset };
    if (best && next.length === 0) break;
    active = next;
  }
  return best ? result(pattern, text, best.thread, best.end) : null;
}
