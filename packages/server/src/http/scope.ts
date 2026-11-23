import { BoardError, operations } from "@openboard/contract";
import type { BoardKeys, BoardScope, BoardView, Store } from "@openboard/ports";

/** Organization and board slugs (docs/protocol.md "Slugs"). */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}$/;

// Reserve documented segments before their operations ship, plus new segments from the contract.
export const BOARD_ROUTE_SEGMENTS = Object.freeze([
  "actors",
  "attachments",
  "avatars",
  "channels",
  "events",
  "grants",
  "inbox",
  "links",
  "me",
  "messages",
  "posts",
  "schedules",
  "schemas",
  "sources",
  "sync",
  "tasks",
  "threads",
  "wake",
  "watchers",
  "webhooks",
  "x",
  // Account routes live under `/api/x`, so they reserve no organization slug.
  ...operations
    .flatMap(({ route, scope }) => (scope === "account" ? [] : route.path.split("/").slice(1, 2)))
    .filter(Boolean),
]);

export interface BoardPath {
  readonly org: string;
  readonly board: string;
  /** The mount the client used, without a trailing slash. */
  readonly mount: string;
  /** The rest of the path, relative to `BOARD_URL`. */
  readonly rest: string;
}

export const notFound = () => new BoardError("not_found", "no such board or route");

/** Resolves the local alias before validating the explicit organization and board slugs (D35). */
export function boardPath(pathname: string, mode: "local" | "hosted"): BoardPath | null {
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return null;
  const relative = pathname.slice("/api".length) || "/";
  const [, first = ""] = relative.split("/", 2);
  const reserved = BOARD_ROUTE_SEGMENTS.includes(first);
  if (mode === "local" && (relative === "/" || reserved)) {
    return { org: "local", board: "main", mount: "/api", rest: relative };
  }

  const match = /^\/([^/]+)\/([^/]+)(\/.*)?$/.exec(relative);
  const [, org = "", board = "", rest = "/"] = match ?? [];
  if (!match || reserved || !SLUG.test(org) || !SLUG.test(board)) return null;
  return { org, board, mount: `/api/${org}/${board}`, rest };
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
