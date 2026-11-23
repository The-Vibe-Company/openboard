import type { BoardScope, BoardView, PlatformView } from "@openboard/ports";
import init from "../migrations/0001-init.sql" with { type: "text" };
import connectionsDdl from "../migrations/0002-connections.sql" with { type: "text" };
import type { Db, Dialect } from "./db.ts";
import { platformView } from "./views/boards.ts";
import { channelReads } from "./views/channels.ts";
import { connectionReads } from "./views/connections.ts";
import { eventReads } from "./views/events.ts";
import { boardView } from "./views/messages.ts";
import { threadReads } from "./views/threads.ts";

export type { Db, Dialect, Row, SqlValue } from "./db.ts";
export { platformStatements, statements } from "./statements.ts";

/** A migration of the one DDL source, in Postgres syntax (docs/data-model.md "DDL"). */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/** Every migration, in order. */
export const migrations: readonly Migration[] = Object.freeze([
  { version: 1, name: "0001-init", sql: init },
  { version: 2, name: "0002-connections", sql: connectionsDdl },
]);

/** The store's views over one engine: the driver adds its connection, lock and lifecycle. */
export function createViews(
  db: Db,
  dialect: Dialect,
): { platform(): PlatformView; board(scope: BoardScope): BoardView } {
  return {
    platform: () => platformView(db, dialect),
    board: (scope) => ({
      ...boardView(db, dialect, scope),
      ...threadReads(db, dialect, scope),
      ...channelReads(db, dialect, scope),
      ...connectionReads(db, dialect, scope),
      ...eventReads(db, dialect, scope),
    }),
  };
}
