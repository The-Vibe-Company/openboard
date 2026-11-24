import type { Message } from "@openboard/contract";
import type { BoardKeys, BoardTaskReads, BoardTaskWriter } from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { query, sql } from "../../sql.ts";

export const taskReadStatements = {
  taskClaimProof: sql`SELECT claim_token, claim_until FROM tasks
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  taskRoot: sql`SELECT m.view FROM tasks t
    JOIN messages m ON m.org_id = t.org_id AND m.board_id = t.board_id AND m.id = t.id
    WHERE t.org_id = ${"orgId"} AND t.board_id = ${"boardId"} AND t.id = ${"id"}`,
};

export function taskReads(db: Db, dialect: Dialect, keys: BoardKeys): Pick<BoardTaskReads, "taskRoot"> {
  return {
    async taskRoot(id) {
      const [row] = await query(db, dialect, taskReadStatements.taskRoot, { ...keys, id });
      return row ? (JSON.parse(String(row.view)) as Message) : null;
    },
  };
}

export function taskWriter(
  db: Db,
  dialect: Dialect,
  keys: BoardKeys,
  preloadedProof: (id: number) => Row | undefined,
): BoardTaskWriter {
  return {
    ...taskReads(db, dialect, keys),
    async taskClaimProof(id) {
      const row =
        preloadedProof(id) ?? (await query(db, dialect, taskReadStatements.taskClaimProof, { ...keys, id }))[0];
      return row?.claim_token == null || row.claim_until == null
        ? null
        : { hash: row.claim_token as Uint8Array, until: Number(row.claim_until) };
    },
  };
}
