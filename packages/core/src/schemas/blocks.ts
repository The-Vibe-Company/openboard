import { BoardError, findBlockFences } from "@openboard/contract";
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

export function findBlocks(text: string): FoundBlock[] {
  return findBlockFences(text).map(({ id, source, start, end, closed }) => readBlock(id, source, start, end, closed));
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
