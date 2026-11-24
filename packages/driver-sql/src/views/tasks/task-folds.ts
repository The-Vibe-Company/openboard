import type { BoardEvent, TaskEvent } from "@openboard/core";
import { type BoardKeys, TASK_EXPIRY_JOB } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { query, sql } from "../../sql.ts";

export const taskFoldStatements = {
  insertTask: sql`INSERT INTO tasks (org_id, board_id, id, channel, state, owner, by_actor, by_profile, created_at)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"channel"}, 'ready', ${"owner"}, ${"actor"}, ${"profile"}, ${"at"})`,
  claimTask: sql`UPDATE tasks SET state = 'claimed', epoch = ${"epoch"}, claim_actor = ${"actor"},
    claim_until = ${"until"}, claim_token = ${"hash"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  renewTask: sql`UPDATE tasks SET claim_until = ${"until"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  readyTask: sql`UPDATE tasks SET state = 'ready', reason = NULL, claim_actor = NULL, claim_until = NULL, claim_token = NULL
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  completeTask: sql`UPDATE tasks SET state = 'completed', result = ${"result"},
    claim_actor = NULL, claim_until = NULL, claim_token = NULL
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  failTask: sql`UPDATE tasks SET state = 'failed', reason = ${"reason"},
    claim_actor = NULL, claim_until = NULL, claim_token = NULL
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  cancelTask: sql`UPDATE tasks SET state = 'canceled', reason = ${"reason"},
    claim_actor = NULL, claim_until = NULL, claim_token = NULL, blocked_kind = NULL, blocked_reason = NULL
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  projectTaskRoot: sql`UPDATE messages SET labels = ${"labels"}, version = ${"version"}, view = ${"view"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"} AND re IS NULL`,
};

function foldTaskRow(tx: Db, dialect: Dialect, keys: BoardKeys, event: TaskEvent) {
  if (event.type === "task.expired" || event.type === "task.released" || event.type === "task.reopened") {
    return query(tx, dialect, taskFoldStatements.readyTask, { ...keys, id: event.message });
  }
  const { by } = event.payload;
  if (event.type === "task.created") {
    return query(tx, dialect, taskFoldStatements.insertTask, {
      ...keys,
      id: event.message,
      channel: event.channel,
      owner: by.principal,
      actor: by.actor,
      profile: by.profile,
      at: event.at,
    });
  }
  if (event.type === "task.renewed") {
    return query(tx, dialect, taskFoldStatements.renewTask, {
      ...keys,
      id: event.message,
      until: event.payload.untilMs,
    });
  }
  if (event.type === "task.completed") {
    return query(tx, dialect, taskFoldStatements.completeTask, {
      ...keys,
      id: event.message,
      result: event.payload.result,
    });
  }
  if (event.type === "task.failed" || event.type === "task.canceled") {
    const statement = event.type === "task.failed" ? taskFoldStatements.failTask : taskFoldStatements.cancelTask;
    return query(tx, dialect, statement, {
      ...keys,
      id: event.message,
      reason: event.payload.reason,
    });
  }
  const { epoch, untilMs, tokenHash } = event.payload;
  return query(tx, dialect, taskFoldStatements.claimTask, {
    ...keys,
    id: event.message,
    epoch,
    actor: by.actor,
    until: untilMs,
    hash: Uint8Array.from(Buffer.from(tokenHash, "hex")),
  });
}

/** Both projections use the event payload, so they can share a Postgres pipeline. */
export async function foldTaskEvent(tx: Db, dialect: Dialect, keys: BoardKeys, event: TaskEvent): Promise<void> {
  const { view } = event.payload;
  await Promise.all([
    foldTaskRow(tx, dialect, keys, event),
    query(tx, dialect, taskFoldStatements.projectTaskRoot, {
      ...keys,
      id: event.message,
      labels: JSON.stringify(view.labels),
      version: event.id,
      view: JSON.stringify(view),
    }),
  ]);
}

/** SQLite has no database notification for jobs inserted by the task trigger. */
export function notifyTaskExpiry(events: readonly BoardEvent[], committed: (kind: string, dueAt: number) => void) {
  for (const event of events) {
    if (event.type === "task.claimed" || event.type === "task.renewed") {
      committed(TASK_EXPIRY_JOB, event.payload.untilMs);
    }
  }
}
