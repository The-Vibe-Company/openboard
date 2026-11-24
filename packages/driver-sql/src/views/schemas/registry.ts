import { registeredSchema, type SchemaRegistered } from "@openboard/core";
import type { BoardKeys, BoardView, BoardWriter } from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { query, sql } from "../../sql.ts";

import { codePointOrder } from "../channels.ts";

export const schemaStatements = {
  schemaById: sql`SELECT id, name, version, description, schema, by, at FROM schemas
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  listSchemas: sql`SELECT id, name, version, description, schema, by, at FROM schemas
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} ORDER BY name${codePointOrder}, version`,
  schemaCount: sql`SELECT COUNT(*) AS count FROM schemas
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}`,
  insertSchema: sql`INSERT INTO schemas (org_id, board_id, id, name, version, description, schema, by, at)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"name"}, ${"version"}, ${"description"}, ${"definition"}, ${"by"}, ${"at"})`,
};

function rowSchema(row: Row) {
  return registeredSchema(
    {
      id: String(row.id),
      name: String(row.name),
      version: Number(row.version),
      description: typeof row.description === "string" ? row.description : null,
      definition: String(row.schema),
    },
    String(row.by),
    Number(row.at),
  );
}

export function schemaReads(db: Db, dialect: Dialect, keys: BoardKeys): Pick<BoardView, "schema" | "schemas"> {
  return {
    async schema(id) {
      const [row] = await query(db, dialect, schemaStatements.schemaById, { ...keys, id });
      return row ? rowSchema(row) : null;
    },
    async schemas() {
      return (await query(db, dialect, schemaStatements.listSchemas, keys)).map(rowSchema);
    },
  };
}

export function schemaWriter(db: Db, dialect: Dialect, keys: BoardKeys): Pick<BoardWriter, "schema" | "schemaCount"> {
  return {
    schema: schemaReads(db, dialect, keys).schema,
    async schemaCount() {
      const [row] = await query(db, dialect, schemaStatements.schemaCount, keys);
      return Number(row?.count ?? 0);
    },
  };
}

export async function foldSchemaRegistered(tx: Db, dialect: Dialect, keys: BoardKeys, event: SchemaRegistered) {
  await query(tx, dialect, schemaStatements.insertSchema, {
    ...keys,
    ...event.payload,
    by: event.actor,
    at: event.at,
  });
}
