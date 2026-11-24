import { BoardError, CAN_HEADER, type Can, type Message, type Operation, type Role } from "@openboard/contract";
import { agents, grants, narrowCan, parseCanHeader, parseId, resolveRankedCan } from "@openboard/core";
import type { BoardView, PersonGrant } from "@openboard/ports";
import { callerCan, credentialKind, memberOf, type Principal } from "../deps.ts";

/** Only the local owner has implicit unrestricted access. */
export function unrestrictedLocalOwner(by: Principal): boolean {
  return by[credentialKind] === "local" && by[callerCan] === undefined;
}

export function narrowCaller(request: Request, by: Principal): Principal {
  if (request.headers.has("x-board-scope")) {
    throw new BoardError(
      "invalid_scope",
      "Replace x-board-scope with x-board-can. Write pattern=permissions;pattern=permissions, for example dev/=read,post;ci/=read.",
    );
  }
  const header = request.headers.get(CAN_HEADER);
  if (header === null) return by;
  const base = unrestrictedLocalOwner(by) ? { "*": [...grants.PERMISSIONS] } : (by[callerCan] ?? {});
  return { ...by, [callerCan]: narrowCan(base, parseCanHeader(header)) };
}

type Permission = NonNullable<Operation["access"]>["permission"] | "label";
type Access = { readonly permission: Permission; readonly channel: NonNullable<Operation["access"]>["channel"] };

/** A write that sets labels, a post or a task with `labels`, also needs `label` where it lands (upstream `03-http.md` "Access"). */
function permissionsFor(permission: Permission, input: unknown): Permission[] {
  const { labels, claim } = input as { labels?: unknown; claim?: unknown };
  const labelled = typeof labels === "object" && labels !== null && Object.keys(labels).length > 0;
  return (labelled || claim === true) && permission !== "label" ? [permission, "label"] : [permission];
}

const EVERY = "on every channel";

export function personGrantCan(active: readonly PersonGrant[], role: Role): Can {
  return resolveRankedCan(active, role);
}

/** Why `by` may not `permission` `where`, in the words of the credential it holds, with one way out. */
function outsideCan(by: Principal, permission: Permission, where: string): BoardError {
  const kind = by[credentialKind];
  if (kind === "agent") {
    return new BoardError("forbidden", `this token was claimed without ${permission} ${where}`, {
      hint: "Run `ob whoami` to see what it can do; claim another token with that permission in its can.",
    });
  }
  if (kind === "connection") {
    return new BoardError("forbidden", `this connection's grant lacks ${permission} ${where}`, {
      hint: "Run `ob whoami` to see what it can do; ask the board's owner for a connection whose can allows it.",
    });
  }
  const role = by[memberOf]?.role;
  const who = role === undefined ? "this caller" : `a ${role}`;
  return new BoardError("forbidden", `${who} may not ${permission} ${where === EVERY ? "this board" : where}`, {
    hint: "Run `ob whoami` to see what you can do; ask an organization admin or owner.",
  });
}

/**
 * The message `id` names stays inside `can`: in a channel the caller cannot read it answers as a missing one (404
 * `message_not_found`, docs/auth.md rule 9), so the caller learns nothing of it; readable without `permission` is 403
 * `forbidden`. A message the board lacks answers the same 404 here, so a later one cannot slip past the check.
 */
async function checkMessage(by: Principal, can: Can, permission: Permission, board: BoardView, id: unknown) {
  const position = typeof id === "string" ? parseId(id) : null;
  if (position === null) return;
  const channel = (await board.thread(position, { limit: 0 }))?.message.channel;
  const allowed = channel === undefined ? [] : agents.allowedAt(can, channel);
  if (!allowed.includes("read")) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  if (!allowed.includes(permission)) throw outsideCan(by, permission, `in ${channel}`);
}

/**
 * Every verified caller stays inside the `can` it acts under (`callerCan`: an `obt_` token's pin, an `obc_`
 * connection's grant, a member's role-capped grant through a session or an `obp_` token), as upstream checks every grant (docs/auth.md "Pinned
 * narrowing"). An operation on a channel needs the permission there: the channel its input names (`channel`, or
 * `path` when it creates one; for a subtree, every pattern inside it too), and the channel of the message it reads or replies to (`id`, `re`). One that reaches
 * every channel needs the permission at `*` and under every other pattern, since nothing narrows its answer yet. The
 * local owner holds no `can` and may do everything; any other caller without one may do nothing.
 */
export async function keepInsideCan(
  operation: Pick<Operation, "access">,
  input: unknown,
  by: Principal,
  board: BoardView,
): Promise<void> {
  const { access } = operation;
  if (access === null || unrestrictedLocalOwner(by)) return;
  const can: Can = by[callerCan] ?? {};
  // A call naming `re` may need another permission there, as making a task of a thread needs `label` (upstream).
  const named = (input as { re?: unknown }).re !== undefined ? (access.re ?? access.permission) : access.permission;
  for (const permission of permissionsFor(named, input)) {
    await checkPermission(by, can, { ...access, permission }, input, board);
  }
}

export function allowedEverywhere(can: Can, permission: Permission): boolean {
  return (
    agents.allowedAt(can, "*").includes(permission) &&
    Object.values(can).every((given) => grants.withImplied(given).includes(permission))
  );
}

/**
 * Whether `can` lets `permission` in at `channel`, and for a subtree (`dev/`) also at every pattern inside it, since
 * nothing narrows a subtree's answer to the channels the caller may see.
 */
function allowedThroughout(can: Can, channel: string, permission: Permission): boolean {
  if (!agents.allowedAt(can, channel).includes(permission)) return false;
  if (!channel.endsWith("/")) return true;
  return Object.entries(can).every(
    ([pattern, given]) =>
      !(pattern === channel.slice(0, -1) || pattern.startsWith(channel)) ||
      grants.withImplied(given).includes(permission),
  );
}

/** Mention candidates come from the board-wide actor directory. */
export function canListMentionActors(by: Principal): boolean {
  return unrestrictedLocalOwner(by) || allowedEverywhere(by[callerCan] ?? {}, "read");
}

export function canReadChannel(by: Principal, channel: string): boolean {
  return unrestrictedLocalOwner(by) || agents.allowedAt(by[callerCan] ?? {}, channel).includes("read");
}

export function withoutMentionDetails(message: Message): Message {
  const { mentions: _mentions, ...visible } = message;
  return visible;
}

async function checkPermission(by: Principal, can: Can, access: Access, input: unknown, board: BoardView) {
  const { permission } = access;
  const named = input as { channel?: unknown; path?: unknown; re?: unknown; id?: unknown };
  if (access.channel === "fromMessage") return checkMessage(by, can, permission, board, named.id);
  if (access.channel === "some") {
    if (Object.values(can).some((given) => grants.withImplied(given).includes(permission))) return;
    throw outsideCan(by, permission, "in any channel");
  }
  const channel = named.channel ?? named.path;
  if (access.channel === "any" || (access.channel === "fromInputOrAny" && channel === undefined)) {
    if (allowedEverywhere(can, permission)) return;
    throw outsideCan(by, permission, EVERY);
  }
  if (typeof channel === "string" && !allowedThroughout(can, channel, permission)) {
    throw outsideCan(by, permission, `in ${channel}`);
  }
  await checkMessage(by, can, permission, board, named.re);
}
