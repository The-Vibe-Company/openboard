import { BoardError, type Can, type Operation } from "@openboard/contract";
import { agents, grants, parseId } from "@openboard/core";
import type { BoardView } from "@openboard/ports";
import { callerCan, credentialKind, memberOf, type Principal } from "../deps.ts";

type Permission = NonNullable<Operation["access"]>["permission"] | "label";
type Access = { readonly permission: Permission; readonly channel: NonNullable<Operation["access"]>["channel"] };

/** A write that sets labels, a post or a task with `labels`, also needs `label` where it lands (upstream `03-http.md` "Access"). */
function permissionsFor(permission: Permission, input: unknown): Permission[] {
  const labels = (input as { labels?: unknown }).labels;
  const labelled = typeof labels === "object" && labels !== null && Object.keys(labels).length > 0;
  return labelled && permission !== "label" ? [permission, "label"] : [permission];
}

const EVERY = "on every channel";

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
  const channel = (await board.thread(position))?.message.channel;
  const allowed = channel === undefined ? [] : agents.allowedAt(can, channel);
  if (!allowed.includes("read")) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  if (!allowed.includes(permission)) throw outsideCan(by, permission, `in ${channel}`);
}

/**
 * Every verified caller stays inside the `can` it acts under (`callerCan`: an `obt_` token's pin, an `obc_`
 * connection's grant, a member's role-capped grant through a session or an `obp_` token), as upstream checks every grant (docs/auth.md "Pinned
 * narrowing"). An operation on a channel needs the permission there: the channel its input names (`channel`, or
 * `path` when it creates one), and the channel of the message it reads or replies to (`id`, `re`). One that reaches
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
  if (access === null || by[credentialKind] === "local") return;
  const can: Can = by[callerCan] ?? {};
  for (const permission of permissionsFor(access.permission, input)) {
    await checkPermission(by, can, { ...access, permission }, input, board);
  }
}

async function checkPermission(by: Principal, can: Can, access: Access, input: unknown, board: BoardView) {
  const { permission } = access;
  if (access.channel === "any") {
    const everywhere = agents.allowedAt(can, "*").includes(permission);
    if (everywhere && Object.values(can).every((given) => grants.withImplied(given).includes(permission))) return;
    throw outsideCan(by, permission, EVERY);
  }
  const named = input as { channel?: unknown; path?: unknown; re?: unknown; id?: unknown };
  if (access.channel === "fromMessage") return checkMessage(by, can, permission, board, named.id);
  const channel = named.channel ?? named.path;
  if (typeof channel === "string" && !agents.allowedAt(can, channel).includes(permission)) {
    throw outsideCan(by, permission, `in ${channel}`);
  }
  await checkMessage(by, can, permission, board, named.re);
}
