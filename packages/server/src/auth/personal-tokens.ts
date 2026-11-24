import { BoardError } from "@openboard/contract";
import { callerCan, credentialExpiry, credentialKind, credentialName, memberOf } from "../deps.ts";
import { personGrantCan } from "./access.ts";
import type { CredentialVerifier } from "./chain.ts";
import { bearer, hashToken } from "./secrets.ts";

/** A personal token inherits the holder's current membership, and the role-capped `can` it gives, scoped by the board's view. */
export function personalTokenVerifier(now: () => number): CredentialVerifier {
  return {
    name: "personal",
    match: (request) => bearer(request)?.startsWith("obp_") ?? false,
    async verify(request, board) {
      const token = bearer(request);
      if (!token || !/^obp_[a-z2-7]{16}_[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const person = await board.personalToken(hashToken(token), now());
      if (!person) throw new BoardError("not_found", "no such board or route");
      if (person === "inactive") return null;
      const { id, handle, name, avatar, tokenName, expiresAt } = person;
      const member = await board.member(id);
      if (!member) throw new BoardError("not_found", "no such board or route");
      const principal = `ob:user:${id}`;
      return {
        actor: principal,
        principal,
        profile: null,
        [credentialKind]: "personal",
        [credentialExpiry]: expiresAt,
        [credentialName]: tokenName,
        [memberOf]: { handle, name, avatar, ...member },
        [callerCan]: personGrantCan(await board.personGrants(id), member.role),
      };
    },
  };
}
