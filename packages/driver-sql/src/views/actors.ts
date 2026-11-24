import type { Actor } from "@openboard/contract";
import type { ActorSeen } from "@openboard/core";
import type { BoardKeys, BoardView } from "@openboard/ports";
import type { Db, Dialect, Row } from "../db.ts";
import { query, sql } from "../sql.ts";
import { lockBoard } from "./boards.ts";
import { codePointOrder } from "./channels.ts";

/**
 * Postgres can read `findActor` after the board lock. When the actor is loaded with the lock, the
 * snapshot check in `lockBoard` protects it from a concurrent board write.
 */
export const actorStatements = {
  findActor: sql`SELECT id, kind, handle, name, avatar, via FROM actors
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"actor"}`,
  findFilterActors: sql`SELECT id, kind, handle FROM actors
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}
      AND (id = ${"authorId"} OR lower(handle) = ${"authorHandle"}
        OR id = ${"mentionId"} OR lower(handle) = ${"mentionHandle"})`,
  upsertActor: sql`INSERT INTO actors (org_id, board_id, id, principal, profile, kind, handle, name, avatar, via,
    first_seen, last_seen) VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"principal"}, ${"profile"}, ${"kind"},
    ${"handle"}, ${"name"}, ${"avatar"}, ${"via"}, ${"at"}, ${"at"}) ON CONFLICT (board_id, id) DO UPDATE SET
    kind = excluded.kind, handle = excluded.handle, name = excluded.name, avatar = excluded.avatar,
    via = excluded.via, last_seen = excluded.last_seen`,
  listActors: sql`SELECT boards.head, actors.id, actors.kind, actors.handle, actors.name, actors.avatar, actors.via
    FROM boards LEFT JOIN actors ON actors.org_id = boards.org_id AND actors.board_id = boards.id
    WHERE boards.id = ${"boardId"} AND boards.org_id = ${"orgId"}
    ORDER BY actors.handle${codePointOrder}, actors.id${codePointOrder}`,
};

function actorView(row: Row): Actor | null {
  if (typeof row.id !== "string") return null;
  return {
    id: row.id,
    kind: String(row.kind) as Actor["kind"],
    handle: String(row.handle),
    name: String(row.name),
    avatar: row.avatar === null ? null : String(row.avatar),
    ...(typeof row.via === "string" ? { via: JSON.parse(row.via) as NonNullable<Actor["via"]> } : {}),
  };
}

/** Takes the board's lock and reads its head with the board's record of `actor`: the start of the write. */
export async function lockBoardAs(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  actor: string | null,
  window: Parameters<typeof lockBoard>[4],
  taskId: number | null = null,
) {
  const { head, row, storage, dailyEvents, actorLoaded, hasWatchers, hasWebhooks } = await lockBoard(
    tx,
    dialect,
    keys,
    actor,
    window,
    taskId,
  );
  const [found] =
    actor !== null && !actorLoaded ? await query(tx, dialect, actorStatements.findActor, { ...keys, actor }) : [row];
  return { head, storage, dailyEvents, hasWatchers, hasWebhooks, actor: found ? actorView(found) : null, row };
}

/** The fold of `actor.seen`: the actor's row, its first sighting kept and its details and last sighting replaced. */
export async function foldActorSeen(tx: Db, dialect: Dialect, keys: BoardKeys, event: ActorSeen): Promise<void> {
  const { actor, kind, handle, name, avatar, via } = event.payload;
  const profile = actor === event.principal ? null : actor.slice(event.principal.length + 1);
  await query(tx, dialect, actorStatements.upsertActor, {
    ...keys,
    id: actor,
    principal: event.principal,
    profile,
    kind,
    handle,
    name,
    avatar,
    via: via === undefined ? null : JSON.stringify(via),
    at: event.at,
  });
}

export function actorReads(
  db: Db,
  dialect: Dialect,
  scope: BoardKeys,
): Pick<BoardView, "listActors" | "findFilterActors"> {
  return {
    async findFilterActors(author, mention) {
      const rows = await query(db, dialect, actorStatements.findFilterActors, {
        orgId: scope.orgId,
        boardId: scope.boardId,
        authorId: author ?? null,
        authorHandle: author?.toLowerCase() ?? null,
        mentionId: mention?.id ?? null,
        mentionHandle: mention?.handle ?? null,
      });
      return rows.map((row) => ({
        id: String(row.id),
        kind: String(row.kind) as Actor["kind"],
        handle: String(row.handle),
      }));
    },
    async listActors() {
      const rows = await query(db, dialect, actorStatements.listActors, {
        boardId: scope.boardId,
        orgId: scope.orgId,
      });
      return { actors: rows.map(actorView).filter((actor) => actor !== null), head: Number(rows[0]?.head ?? 0) };
    },
  };
}
