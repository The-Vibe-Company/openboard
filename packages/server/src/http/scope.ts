import { BoardError, operations } from "@openboard/contract";
import type { BoardKeys, BoardScope, BoardView, Job, OrgScope, OrgView, Store } from "@openboard/ports";

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
    .flatMap(({ route, scope }) =>
      scope === "account" || scope === "org" || route.mount ? [] : route.path.split("/").slice(1, 2),
    )
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

/**
 * Mints the scope a handler's views are opened with: the only place one is made (D33). Credentials arrive with the
 * local owner token; until then the board the path resolved to is the scope.
 */
function mintBoardScope(keys: BoardKeys): BoardScope {
  return { orgId: keys.orgId, boardId: keys.boardId } as BoardScope;
}

/**
 * Step 3 for a person (docs/codebase.md 4.4): their membership of the organization of the board the path names. Anyone
 * else is answered 404 `not_found` as for an unknown board, never 401 or 403, so it reveals no other organization.
 */
export async function boardMember(board: BoardView, personId: string) {
  const member = await board.member(personId);
  if (!member) throw notFound();
  return member;
}

/** The person's membership of the organization `slug` names; 404 when either is unknown, as for a stranger. */
async function membership(store: Store, slug: string, personId: string) {
  if (!SLUG.test(slug)) throw notFound();
  const member = await store.platform().orgMembership(slug, personId);
  if (!member) throw notFound();
  return member;
}

/** The tenant resolver: the one holder of the `Store`, handing out views of minted scopes only. */
export interface Tenants {
  /** The view of the board a path names, or 404 `not_found`. */
  board(path: BoardPath, provesOwnership: (board: BoardView) => Promise<boolean>): Promise<BoardView>;
  /** A background job enters its board using routing keys from the trusted picker. */
  jobBoard(job: Job): BoardView;
  jobOrg(job: Pick<Job, "orgId">): OrgView;
  /** The view of an organization the person administers; 404 for a non-member, 403 `forbidden` for a member. */
  adminOrg(slug: string, personId: string): Promise<OrgView>;
  /** The view of an organization the person belongs to, with any role; 404 for anyone else. */
  ownerOrg(slug: string, personId: string): Promise<OrgView>;
  memberOrg(slug: string, personId: string): Promise<OrgView>;
}

export function tenants(store: Store): Tenants {
  return {
    jobBoard: (job) => store.board(mintBoardScope(job)),
    jobOrg: ({ orgId }) => store.org({ orgId } as OrgScope),
    async adminOrg(slug, personId) {
      const member = await membership(store, slug, personId);
      if (member.role === "member") throw new BoardError("forbidden", "this organization needs an administrator");
      return store.org({ orgId: member.orgId } as OrgScope);
    },
    async ownerOrg(slug, personId) {
      const member = await membership(store, slug, personId);
      if (member.role !== "owner") throw new BoardError("forbidden", "this organization needs an owner");
      return store.org({ orgId: member.orgId } as OrgScope);
    },
    async memberOrg(slug, personId) {
      const member = await membership(store, slug, personId);
      return store.org({ orgId: member.orgId } as OrgScope);
    },
    async board(path, provesOwnership) {
      const keys = await store.platform().findBoard(path.org, path.board, true);
      if (!keys) throw notFound();
      const board = store.board(mintBoardScope(keys));
      if (!keys.deleted) return board;
      if (await provesOwnership(board))
        throw new BoardError("unauthorized", "the credential is not valid on this board");
      throw notFound();
    },
  };
}
