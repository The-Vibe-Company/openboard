import { timingSafeEqual } from "node:crypto";
import { BoardError, type Operation, PROFILE_HEADER, parseProfileHeader } from "@openboard/contract";
import { connections, grants, resolveCan, withinPin } from "@openboard/core";
import type { AgentRecord, BoardView } from "@openboard/ports";
import { agentOf, callerCan, connectionOf, credentialKind, type Principal, profileName, tokenHashOf } from "../deps.ts";
import type { CredentialVerifier } from "./chain.ts";
import { bearer, hashToken } from "./secrets.ts";

const PREFIX = "obt_";
/** The one board extension a claimed token reaches: refreshing itself (docs/auth.md "Routes a claimed token can never reach"). */
const REFRESH = "refreshAgentToken";

/** Claimed credentials may use data routes but cannot manage grants or OpenBoard configuration. */
export function refuseClaimedConfiguration(
  request: Request,
  operation: Pick<Operation, "name" | "scope" | "route">,
): void {
  if (operation.name === REFRESH) return;
  const { scope, route } = operation;
  if (
    scope !== "account" &&
    scope !== "org" &&
    !route.mount &&
    !route.path.startsWith("/x/") &&
    route.path !== "/grants" &&
    !route.path.startsWith("/grants/")
  )
    return;
  if (bearer(request)?.startsWith(PREFIX)) {
    throw new BoardError("forbidden", "claimed tokens cannot access configuration routes");
  }
}

/** `obt_<16 base32>_<43 base64url>`: the 16 base32 characters name the agent, `ag_<name>`. */
const TOKEN = /^obt_([a-z2-7]{16})_[A-Za-z0-9_-]{43}$/;
/** Random bytes of a token's secret part: 32, which base64url writes in 43 characters. */
export const TOKEN_SECRET_BYTES = 32;

/** A new token for the agent `ag_<name>`: the same name, so it selects the same row, and a fresh secret part. */
export function reissueToken(agentId: string, random: Uint8Array): { readonly token: string; readonly hash: string } {
  if (random.length !== TOKEN_SECRET_BYTES) throw new RangeError(`a token takes ${TOKEN_SECRET_BYTES} random bytes`);
  const token = `${PREFIX}${agentId.slice("ag_".length)}_${Buffer.from(random).toString("base64url")}`;
  return { token, hash: hashToken(token) };
}

/**
 * Whether `hash` (hex) is the agent's token before its `expiresAt`, or the one its last refresh replaced while that
 * still works; neither works from the agent's `hardExpiresAt` on. A token past its life answers 401 on every route,
 * refresh included: an agent renews before it expires, then claims anew.
 */
function holdsToken(record: AgentRecord, hash: string, now: number): boolean {
  if (now >= record.hardExpires) return false;
  const presented = Buffer.from(hash, "hex");
  if (timingSafeEqual(presented, Buffer.from(record.tokenHash, "hex"))) return now < record.tokenExpires;
  const { previous } = record;
  return (
    previous !== null && now < previous.until && timingSafeEqual(presented, Buffer.from(previous.tokenHash, "hex"))
  );
}

/**
 * Step 1 of the verifier chain (docs/auth.md "Three ways to connect", mode 2): an `obt_` bearer writes as the profile
 * its agent was claimed for, through the agent's connection, when the request's board holds that agent and the
 * token's SHA-256 is the one kept. The profile is pinned (D30): an `x-board-profile` naming another one is refused.
 * The `can` it was claimed with is pinned too: `keepInsideCan` checks it on every request.
 */
export function agentTokenVerifier(now: () => number): CredentialVerifier {
  return {
    name: "agent",
    match: (request) => bearer(request)?.startsWith(PREFIX) ?? false,
    async verify(request: Request, board: BoardView): Promise<Principal | null> {
      const token = bearer(request) ?? "";
      const id = TOKEN.exec(token)?.[1];
      if (id === undefined) return null;
      const record = await board.agent(`ag_${id}`);
      if (!record) return null;
      const presented = hashToken(token);
      if (!holdsToken(record, presented, now())) return null;
      const { agent, connection, profile } = record;
      refuseOtherProfile(request, profile);
      return {
        actor: agent.actor,
        principal: connections.connectionPrincipal(connection.id),
        profile: profile.toLowerCase(),
        [credentialKind]: "agent",
        [connectionOf]: { name: connection.name, profiles: connection.profiles },
        [agentOf]: agent.id,
        [callerCan]: withinPin(resolveCan(record.grantCans.map(grants.compileCan)), agent.can),
        [profileName]: profile,
        [tokenHashOf]: presented,
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
