import { BoardError, type createSchema, type InputOf, type SchemaView } from "@openboard/contract";
import { isoTime } from "../ids.ts";
import { builtInSchemas } from "./builtins.ts";
import { canonicalSchema } from "./canonical.ts";
import { checkDefinition } from "./definition.ts";

export interface SchemaRegistered {
  readonly type: "ob.schema.registered";
  readonly visibility: 2;
  readonly id: number;
  readonly at: number;
  readonly thread: null;
  readonly message: null;
  readonly channel: null;
  readonly actor: string;
  readonly principal: string;
  readonly payload: {
    readonly id: string;
    readonly name: string;
    readonly version: number;
    readonly description: string | null;
    readonly definition: string;
  };
}

export function schemaRegistration({
  name,
  version,
  description,
  schema,
}: InputOf<typeof createSchema>): SchemaRegistered["payload"] {
  if (builtInSchemas().some((entry) => entry.name === name)) {
    throw new BoardError("reserved_schema", `The schema name "${name}" is reserved for a built-in.`);
  }
  checkDefinition(schema);
  return {
    id: `${name}@${version}`,
    name,
    version,
    description: description ?? null,
    definition: canonicalSchema(schema),
  };
}

/** Compare against a stored definition without recursing through an unvalidated retry. */
export function isIdenticalSchema(
  existing: SchemaView,
  schema: SchemaView["schema"],
  description: string | null,
): boolean {
  if (existing.description !== description) return false;
  const pending: [unknown, unknown][] = [[existing.schema, schema]];
  for (let pair = pending.pop(); pair; pair = pending.pop()) {
    const [stored, raw] = pair;
    // JSON serialization represents an overflowing number as null.
    const incoming = typeof raw === "number" && !Number.isFinite(raw) ? null : raw;
    if (stored === incoming) continue;
    if (typeof stored !== "object" || stored === null || typeof incoming !== "object" || incoming === null)
      return false;
    if (Array.isArray(stored) !== Array.isArray(incoming)) return false;
    const entries = Object.entries(stored);
    if (entries.length !== Object.keys(incoming).length) return false;
    for (const [key, value] of entries) {
      if (!Object.hasOwn(incoming, key)) return false;
      pending.push([value, (incoming as Record<string, unknown>)[key]]);
    }
  }
  return true;
}

export function repeatSchema(existing: SchemaView, definition: string, description: string | null): SchemaView {
  if (existing.description !== description || canonicalSchema(existing.schema) !== definition) {
    throw new BoardError(
      "schema_immutable",
      "This schema version already has another definition or description. Register a new version.",
    );
  }
  return existing;
}

export function checkSchemaCapacity(count: number): void {
  if (count >= 500) throw new BoardError("too_many_schemas", "A board can register at most 500 schema versions.");
}

export function registeredSchema(
  { id, name, version, description, definition }: SchemaRegistered["payload"],
  by: string,
  at: number,
): SchemaView {
  return { id, name, version, description, schema: JSON.parse(definition), builtIn: false, by, at: isoTime(at) };
}
