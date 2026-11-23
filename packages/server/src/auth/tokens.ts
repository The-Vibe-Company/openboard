import { timingSafeEqual } from "node:crypto";
import { BoardError, PROFILE_HEADER, parseProfileHeader } from "@openboard/contract";
import { connections } from "@openboard/core";
import type { BoardView } from "@openboard/ports";
import { agentOf, connectionOf, credentialKind, type Principal, profileName } from "../deps.ts";
import type { CredentialVerifier } from "./chain.ts";
import { bearer, hashToken } from "./secrets.ts";

const PREFIX = "obt_";
/** `obt_<16 base32>_<43 base64url>`: the 16 base32 characters name the agent, `ag_<name>`. */
const TOKEN = /^obt_([a-z2-7]{16})_[A-Za-z0-9_-]{43}$/;

/**
 * Step 1 of the verifier chain (docs/auth.md "Three ways to connect", mode 2): an `obt_` bearer writes as the profile
 * its agent was claimed for, through the agent's connection, when the request's board holds that agent and the
 * token's SHA-256 is the one kept. The profile is pinned (D30): an `x-board-profile` naming another one is refused.
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
