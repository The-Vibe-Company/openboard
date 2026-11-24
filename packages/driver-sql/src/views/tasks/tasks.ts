import type { Message } from "@openboard/contract";
import type { BoardKeys, BoardTaskReads } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { query, sql } from "../../sql.ts";

export const taskReadStatements = {
  taskRoot: sql`SELECT m.view FROM tasks t
    JOIN messages m ON m.org_id = t.org_id AND m.board_id = t.board_id AND m.id = t.id
    WHERE t.org_id = ${"orgId"} AND t.board_id = ${"boardId"} AND t.id = ${"id"}`,
};

export function taskReads(db: Db, dialect: Dialect, keys: BoardKeys): BoardTaskReads {
  return {
    async taskRoot(id) {
      const [row] = await query(db, dialect, taskReadStatements.taskRoot, { ...keys, id });
      return row ? (JSON.parse(String(row.view)) as Message) : null;
    },
  };
}
