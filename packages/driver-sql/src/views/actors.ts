import type { Actor } from "@openboard/contract";
import type { ActorSeen } from "@openboard/core";
import type { BoardKeys, BoardScope, BoardView } from "@openboard/ports";
import type { Db, Dialect, Row } from "../db.ts";
import { query, sql } from "../sql.ts";
import { lockBoard } from "./boards.ts";
import { codePointOrder } from "./channels.ts";

/**
 * `headAndActor` reads the head with the writer's record in one statement where the write lock is taken before any
 * read (SQLite's `BEGIN IMMEDIATE`). Postgres locks with `lockBoard` and then reads `findActor`: a statement that
 * waited on the board's row lock re-reads that row only, so a record joined to it could predate the lock holder's
 * commit. `listActors` returns the head with the actors, or alone on a board nobody wrote on.
 */
export const actorStatements = {
  headAndActor: sql`SELECT boards.head, actors.id, actors.kind, actors.handle, actors.name, actors.avatar, actors.via
    FROM boards LEFT JOIN actors ON actors.org_id = boards.org_id AND actors.board_id = boards.id
      AND actors.id = ${"actor"}
    WHERE boards.org_id = ${"orgId"} AND boards.id = ${"boardId"}`,
  findActor: sql`SELECT id, kind, handle, name, avatar, via FROM actors
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"actor"}`,
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
export async function lockBoardAs(tx: Db, dialect: Dialect, keys: BoardKeys, actor: string) {
  if (dialect.name === "postgres") {
    const head = await lockBoard(tx, dialect, keys);
    const [found] = await query(tx, dialect, actorStatements.findActor, { ...keys, actor });
    return { head, actor: found ? actorView(found) : null };
  }
  const [row] = await query(tx, dialect, actorStatements.headAndActor, { ...keys, actor });
  if (!row) throw new Error(`board ${keys.boardId} of organization ${keys.orgId} is missing`);
  return { head: Number(row.head), actor: actorView(row) };
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

export function actorReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "listActors"> {
  return {
    async listActors() {
      const rows = await query(db, dialect, actorStatements.listActors, {
        boardId: scope.boardId,
        orgId: scope.orgId,
      });
      return { actors: rows.map(actorView).filter((actor) => actor !== null), head: Number(rows[0]?.head ?? 0) };
    },
  };
}
