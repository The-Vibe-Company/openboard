import type { TaskEvent } from "@openboard/core";
import type { BoardKeys } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { query, sql } from "../../sql.ts";

export const taskFoldStatements = {
  insertTask: sql`INSERT INTO tasks (org_id, board_id, id, channel, state, owner, by_actor, by_profile, created_at)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"channel"}, 'ready', ${"owner"}, ${"actor"}, ${"profile"}, ${"at"})`,
  projectTaskRoot: sql`UPDATE messages SET labels = ${"labels"}, version = ${"version"}, view = ${"view"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"} AND re IS NULL`,
};

export async function foldTaskEvent(tx: Db, dialect: Dialect, keys: BoardKeys, event: TaskEvent): Promise<void> {
  const { by, view } = event.payload;
  await query(tx, dialect, taskFoldStatements.insertTask, {
    ...keys,
    id: event.message,
    channel: event.channel,
    owner: by.principal,
    actor: by.actor,
    profile: by.profile,
    at: event.at,
  });
  await query(tx, dialect, taskFoldStatements.projectTaskRoot, {
    ...keys,
    id: event.message,
    labels: JSON.stringify(view.labels),
    version: event.id,
    view: JSON.stringify(view),
  });
}
