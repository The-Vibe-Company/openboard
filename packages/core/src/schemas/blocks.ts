import { BoardError } from "@openboard/contract";
import { parseSchemaId } from "./id.ts";
import { checkValue } from "./value.ts";

type SchemaId = ReturnType<typeof parseSchemaId>;
export type FoundBlock = { id: string; source: string; start: number; end: number } & (
  | (SchemaId & { data: Record<string, unknown>; problem?: never })
  | (Partial<SchemaId> & { problem: string })
);
export interface MessageBlock {
  schema: string;
  version: number;
  data: Record<string, unknown>;
}

function opening(line: string) {
  const match = /^ {0,3}(~{3,}|\x60{3,})(.*)$/.exec(line);
  if (!match || (match[1]!.startsWith("\x60") && match[2]!.includes("\x60"))) return null;
  return { marker: match[1]!, info: match[2]!.trim() };
}

type Fence = NonNullable<ReturnType<typeof opening>>;
function closes(line: string, fence: Fence) {
  const marker = /^ {0,3}(~{3,}|\x60{3,})[ \t]*$/.exec(line)?.[1];
  return marker !== undefined && marker[0] === fence.marker[0] && marker.length >= fence.marker.length;
}

function readBlock(id: string, source: string, start: number, end: number, closed: boolean): FoundBlock {
  const range = { id, source, start, end };
  let named: SchemaId | undefined;
  try {
    named = parseSchemaId(id);
  } catch (error) {
    if (!(error instanceof BoardError) || error.code !== "invalid_schema_id") throw error;
  }
  if (!closed) return { ...range, ...named, problem: `the ${id} block's fence never closes` };
  if (!named) {
    return { ...range, problem: `${id || "json#"} names no schema: one is name@version, like sandbox@1` };
  }
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return { ...range, ...named, problem: `the ${id} block isn't JSON` };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ...range, ...named, problem: `the ${id} block isn't a JSON object` };
  }
  return { ...range, ...named, data: data as Record<string, unknown> };
}

const QUOTE = /^ {0,3}>[ \t]?/;
const ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?: {1,4}|\t|$)/;
const INTERRUPT = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|([-*_])(?:[ \t]*\1){2,}[ \t]*$|<)/;

function plain(line: string) {
  return line.trim() !== "" && !opening(line) && !QUOTE.test(line) && !ITEM.test(line) && !INTERRUPT.test(line);
}

function containerLines() {
  let kind: "quote" | "item" | null = null;
  let indent = 0;
  let fence: Fence | null = null;
  let paragraph = false;

  return (line: string) => {
    const quote = QUOTE.exec(line);
    let inner: string;
    if (quote) {
      if (kind !== "quote") fence = null;
      kind = "quote";
      inner = line.slice(quote[0].length);
    } else if (kind === "item" && (!line.trim() || line.length - line.trimStart().length >= indent)) {
      inner = line.slice(indent);
    } else if (kind && paragraph && !fence && plain(line)) {
      inner = line;
    } else {
      const item = ITEM.exec(line);
      fence = null;
      kind = item ? "item" : null;
      if (!item) return false;
      indent = item[0].length + Number(item[0].length === line.length);
      inner = line.slice(indent);
    }
    fence = fence ? (closes(inner, fence) ? null : fence) : opening(inner);
    paragraph = !fence && plain(inner);
    return true;
  };
}

/** Find top-level structured fences and keep the original UTF-16 source offsets. */
export function findBlocks(text: string): FoundBlock[] {
  if (!text.includes("json#")) return [];
  const blocks: FoundBlock[] = [];
  const inContainer = containerLines();
  let active: (Fence & { start: number; content: number }) | null = null;
  const emit = (fence: NonNullable<typeof active>, end: number, sourceEnd: number, closed: boolean) => {
    const id = /^json#(\S*)/.exec(fence.info)?.[1];
    if (id !== undefined) blocks.push(readBlock(id, text.slice(fence.content, sourceEnd), fence.start, end, closed));
  };

  for (let start = 0; start <= text.length; ) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(start, end).replace(/\r$/, "");
    if (active) {
      if (closes(line, active)) {
        emit(active, start + line.length, start - 1, true);
        active = null;
      }
    } else if (!inContainer(line)) {
      const fence = opening(line);
      if (fence) active = { ...fence, start, content: Math.min(end + 1, text.length) };
    }
    if (newline === -1) break;
    start = newline + 1;
  }
  if (active) emit(active, text.length, text.length, false);
  return blocks;
}

// SQLite's JSON functions accept 1,000 nested containers. An edit event adds
// four outside the data: its payload, message view, blocks array, and block.
const MAX_DATA_DEPTH = 996;

/** Check that decoded JSON can be stored and queried on both database engines. */
function storable(data: Record<string, unknown>): boolean {
  const pending: { value: unknown; depth: number }[] = [{ value: data, depth: 1 }];
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (typeof value === "string" && (value.includes("\0") || !value.isWellFormed())) return false;
    if (typeof value === "number" && !Number.isFinite(value)) return false;
    if (value && typeof value === "object") {
      if (depth > MAX_DATA_DEPTH) return false;
      for (const [key, child] of Object.entries(value)) {
        pending.push({ value: key, depth }, { value: child, depth: depth + 1 });
      }
    }
  }
  return true;
}

export function blockData(block: FoundBlock): MessageBlock {
  if (block.problem !== undefined) throw new BoardError("invalid_block", block.problem);
  if (!storable(block.data)) throw new BoardError("invalid_block", `the ${block.id} block contains unstorable JSON`);
  return { schema: block.name, version: block.version, data: block.data };
}

export function checkBlock(id: string, block: MessageBlock, definition: Record<string, unknown> | undefined) {
  if (!definition)
    throw new BoardError("schema_not_found", `the ${id} block names a schema this board doesn't have`, { status: 400 });
  const problem = checkValue(definition, block.data);
  if (problem !== null) throw new BoardError("invalid_block", `the ${id} block doesn't match its schema: ${problem}`);
}
