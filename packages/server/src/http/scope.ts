import { BoardError } from "@openboard/contract";
import type { BoardKeys, BoardScope, BoardView, Store } from "@openboard/ports";

/** Organization and board slugs (docs/protocol.md "Slugs"). */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}$/;

export interface BoardPath {
  readonly org: string;
  readonly board: string;
  /** The rest of the path, relative to `BOARD_URL`. */
  readonly rest: string;
}

export const notFound = () => new BoardError("not_found", "no such board or route");

/** Splits `/api/<org>/<board>/<rest>` (D35); null for a path that does not name a board. */
export function boardPath(pathname: string): BoardPath | null {
  const match = /^\/api\/([^/]+)\/([^/]+)(\/.*)?$/.exec(pathname);
  const [, org = "", board = "", rest = "/"] = match ?? [];
  if (!match || !SLUG.test(org) || !SLUG.test(board)) return null;
  return { org, board, rest };
}

/** The board a path names. Unknown slugs answer 404 without saying which part is unknown (docs/codebase.md 4.4). */
async function resolveBoard(store: Store, path: BoardPath): Promise<BoardKeys> {
  const keys = await store.platform().findBoard(path.org, path.board);
  if (!keys) throw notFound();
  return keys;
}

/**
 * Mints the scope a handler's views are opened with: the only place one is made (D33). Credentials arrive with the
 * local owner token; until then the board the path resolved to is the scope.
 */
function mintBoardScope(keys: BoardKeys): BoardScope {
  return { orgId: keys.orgId, boardId: keys.boardId } as BoardScope;
}

/** The tenant resolver: the one holder of the `Store`, handing out views of minted scopes only. */
export interface Tenants {
  /** The view of the board a path names, or 404 `not_found`. */
  board(path: BoardPath): Promise<BoardView>;
}

export function tenants(store: Store): Tenants {
  return {
    async board(path) {
      return store.board(mintBoardScope(await resolveBoard(store, path)));
    },
  };
}
