import { BoardError, type createSchema, type listSchemas, type readSchema } from "@openboard/contract";
import { builtInSchemas, parseSchemaId } from "@openboard/core";
import type { Handler } from "../index.ts";

export const listSchemasHandler: Handler<typeof listSchemas> = async () => ({ schemas: builtInSchemas() });

export const readSchemaHandler: Handler<typeof readSchema> = async (_ctx, { id }) => {
  parseSchemaId(id);
  const schema = builtInSchemas().find((entry) => entry.id === id);
  if (!schema) throw new BoardError("schema_not_found", "Schema not found.", { status: 404 });
  return { schema };
};

export const createSchemaHandler: Handler<typeof createSchema> = async () => {
  throw new BoardError("no_schemas", "This board does not support schema registration.");
};
