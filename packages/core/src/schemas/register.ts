import { BoardError, type createSchema, type InputOf, type SchemaView } from "@openboard/contract";
import { isoTime } from "../ids.ts";
import { canonicalSchema } from "./canonical.ts";

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
  if (schema.type !== "object") throw new BoardError("invalid_schema", "A schema definition must have type object.");
  return {
    id: `${name}@${version}`,
    name,
    version,
    description: description ?? null,
    definition: canonicalSchema(schema),
  };
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
