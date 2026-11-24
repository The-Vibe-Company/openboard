import { BoardError, type createSchema, type listSchemas, type readSchema } from "@openboard/contract";
import {
  builtInSchemas,
  checkSchemaCapacity,
  isIdenticalSchema,
  parseSchemaId,
  registeredSchema,
  repeatSchema,
  type SchemaRegistered,
  schemaRegistration,
} from "@openboard/core";
import type { Handler } from "../index.ts";

export const listSchemasHandler: Handler<typeof listSchemas> = async ({ board }) => ({
  schemas: [...builtInSchemas(), ...(await board.schemas())],
});

export const readSchemaHandler: Handler<typeof readSchema> = async ({ board }, { id }) => {
  parseSchemaId(id);
  const schema = builtInSchemas().find((entry) => entry.id === id) ?? (await board.schema(id));
  if (!schema) throw new BoardError("schema_not_found", "Schema not found.", { status: 404 });
  return { schema };
};

export const createSchemaHandler: Handler<typeof createSchema> = async ({ board, by, now, debitWrite }, input) => {
  let payload: SchemaRegistered["payload"];
  try {
    payload = schemaRegistration(input);
  } catch (error) {
    if (!(error instanceof BoardError) || error.code !== "invalid_schema") throw error;
    // Identical retries of previously stored custom versions remain no-ops.
    const existing = await board.schema(`${input.name}@${input.version}`);
    if (existing && isIdenticalSchema(existing, input.schema, input.description ?? null)) {
      return { schema: existing, created: false };
    }
    throw error;
  }
  const { id, definition, description } = payload;
  return board.write(async (writer) => {
    const existing = await writer.schema(id);
    if (existing) return { schema: repeatSchema(existing, definition, description), created: false };
    checkSchemaCapacity(await writer.schemaCount());
    debitWrite();
    const event: SchemaRegistered = {
      type: "ob.schema.registered",
      visibility: 2,
      id: writer.head + 1,
      at: now(),
      actor: by.actor,
      principal: by.principal,
      thread: null,
      message: null,
      channel: null,
      payload,
    };
    await writer.append([event]);
    return { schema: registeredSchema(event.payload, event.actor, event.at), created: true };
  });
};
