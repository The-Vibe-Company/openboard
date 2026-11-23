import { timingSafeEqual } from "node:crypto";
import { BoardError, type Can, type Operation, PROFILE_HEADER, parseProfileHeader } from "@openboard/contract";
import { agents, connections, parseId } from "@openboard/core";
import type { BoardView } from "@openboard/ports";
import { agentOf, connectionOf, credentialKind, type Principal, pinnedCan, profileName } from "../deps.ts";
import type { CredentialVerifier } from "./chain.ts";
import { bearer, hashToken } from "./secrets.ts";

const PREFIX = "obt_";
/** `obt_<16 base32>_<43 base64url>`: the 16 base32 characters name the agent, `ag_<name>`. */
const TOKEN = /^obt_([a-z2-7]{16})_[A-Za-z0-9_-]{43}$/;

/**
 * Step 1 of the verifier chain (docs/auth.md "Three ways to connect", mode 2): an `obt_` bearer writes as the profile
 * its agent was claimed for, through the agent's connection, when the request's board holds that agent and the
 * token's SHA-256 is the one kept. The profile is pinned (D30): an `x-board-profile` naming another one is refused.
 * The `can` it was claimed with is pinned too: `keepInsidePin` checks it on every request.
 */
export function agentTokenVerifier(): CredentialVerifier {
  return {
    name: "agent",
    match: (request) => bearer(request)?.startsWith(PREFIX) ?? false,
    async verify(request: Request, board: BoardView): Promise<Principal | null> {
      const token = bearer(request) ?? "";
      const id = TOKEN.exec(token)?.[1];
      if (id === undefined) return null;
      const record = await board.agent(`ag_${id}`);
      if (!record) return null;
      const presented = Buffer.from(hashToken(token), "hex");
      if (!timingSafeEqual(presented, Buffer.from(record.tokenHash, "hex"))) return null;
      const { agent, connection, profile } = record;
      refuseOtherProfile(request, profile);
      return {
        actor: agent.actor,
        principal: connections.connectionPrincipal(connection.id),
        profile: profile.toLowerCase(),
        [credentialKind]: "agent",
        [connectionOf]: { name: connection.name, profiles: connection.profiles },
        [agentOf]: agent.id,
        [pinnedCan]: agent.can,
        [profileName]: profile,
      };
    },
  };
}

/**
 * A claimed token writes only as its pinned profile (docs/auth.md mode 2, "Pinned profile"; D30): an `x-board-profile`
 * naming another one answers 403 `forbidden` with the pinned name, where upstream's proxy silently overwrites it. The
 * same name in any case passes, so the spelling sent is the one shown.
 */
function refuseOtherProfile(request: Request, pinned: string): void {
  const header = request.headers.get(PROFILE_HEADER);
  if (header === null) return;
  const { name } = parseProfileHeader(header);
  if (name.toLowerCase() === pinned.toLowerCase()) return;
  throw new BoardError("forbidden", `this token is pinned to the profile ${pinned} and may not write as ${name}`, {
    hint: `Drop --as and BOARD_PROFILE, or set them to ${pinned}; claim another token to write as ${name}.`,
  });
}

type Permission = NonNullable<Operation["access"]>["permission"];

function outsidePin(permission: Permission, where: string): BoardError {
  return new BoardError("forbidden", `this token was claimed without ${permission} ${where}`, {
    hint: "Run `ob whoami` to see what it can do; claim another token with that permission in its can.",
  });
}

/**
 * The message `id` names stays inside the pin: in a channel the pin cannot read it answers as a missing one (404
 * `message_not_found`, docs/auth.md rule 9), so the token learns nothing of it; readable without `permission` is 403
 * `forbidden`. A message the board lacks is left to the handler, which answers the same 404.
 */
async function checkMessage(can: Can, permission: Permission, board: BoardView, id: unknown): Promise<void> {
  const position = typeof id === "string" ? parseId(id) : null;
  if (position === null) return;
  const channel = (await board.thread(position))?.message.channel;
  if (channel === undefined) return;
  const allowed = agents.allowedAt(can, channel);
  if (!allowed.includes("read")) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  if (!allowed.includes(permission)) throw outsidePin(permission, `in ${channel}`);
}

/**
 * A claimed token is always a narrowed caller (docs/auth.md mode 2, "Pinned narrowing"). An operation on a channel
 * needs the permission there: the channel its input names (`channel`, or `path` when it creates one), and the channel
 * of the message it reads or replies to (`id`, `re`). One that reaches every channel needs the permission at `*`, since
 * nothing narrows its answer yet. Other credentials pass untouched.
 */
export async function keepInsidePin(
  operation: Pick<Operation, "access">,
  input: unknown,
  by: Principal,
  board: BoardView,
): Promise<void> {
  const can: Can | undefined = by[pinnedCan];
  const { access } = operation;
  if (can === undefined || access === null) return;
  const { permission } = access;
  if (access.channel === "any") {
    if (agents.allowedAt(can, "*").includes(permission)) return;
    throw outsidePin(permission, "on every channel");
  }
  const named = input as { channel?: unknown; path?: unknown; re?: unknown; id?: unknown };
  if (access.channel === "fromMessage") return checkMessage(can, permission, board, named.id);
  const channel = named.channel ?? named.path;
  if (typeof channel === "string" && !agents.allowedAt(can, channel).includes(permission)) {
    throw outsidePin(permission, `in ${channel}`);
  }
  await checkMessage(can, permission, board, named.re);
}
