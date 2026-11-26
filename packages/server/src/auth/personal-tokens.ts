import { BoardError, CAN_HEADER } from "@openboard/contract";
import { narrowCan } from "@openboard/core";
import type { PlatformView } from "@openboard/ports";
import {
  callerCan,
  credentialExpiry,
  credentialKind,
  credentialName,
  memberOf,
  personalPin,
  requestNarrowed,
} from "../deps.ts";
import { notFound, type Tenants } from "../http/scope.ts";
import { personGrantCan } from "./access.ts";
import type { CredentialVerifier } from "./chain.ts";
import { bearer, hashToken } from "./secrets.ts";

const tokenPattern = /^obp_[a-z2-7]{16}_[A-Za-z0-9_-]{43}$/;

/** A bearer can manage tokens only if the credential is unrestricted. */
export async function accountPersonalToken(request: Request, platform: PlatformView, now: number) {
  const token = bearer(request);
  if (!token?.startsWith("obp_")) return null;
  const account = tokenPattern.test(token) ? await platform.accountPersonalToken(hashToken(token), now) : null;
  if (!account) throw new BoardError("unauthorized", "the personal token is invalid or expired");
  if (account.restricted || request.headers.has(CAN_HEADER)) {
    throw new BoardError("forbidden", "a narrowed personal token cannot access account routes");
  }
  return account.personId;
}

export async function orgTokenPerson(request: Request, slug: string, tenants: Tenants, at: number) {
  const token = bearer(request);
  if (!token || !tokenPattern.test(token)) {
    throw new BoardError("unauthorized", "a personal token is required");
  }
  const board = await tenants.board({ org: slug, board: "main", mount: "", rest: "" }, async () => false);
  const person = await board.personalToken(hashToken(token), at);
  if (!person) throw notFound();
  if (person === "inactive") throw new BoardError("unauthorized", "the personal token is inactive");
  if (person.boardBound || person.can !== undefined || request.headers.has(CAN_HEADER)) {
    throw new BoardError("forbidden", "a narrowed personal token cannot access organization routes");
  }
  return person;
}

/** A personal token inherits the holder's current membership, and the role-capped `can` it gives, scoped by the board's view. */
export function personalTokenVerifier(now: () => number): CredentialVerifier {
  return {
    name: "personal",
    match: (request) => bearer(request)?.startsWith("obp_") ?? false,
    async verify(request, board) {
      const token = bearer(request);
      if (!token || !tokenPattern.test(token)) return null;
      const person = await board.personalToken(hashToken(token), now());
      if (!person) throw new BoardError("not_found", "no such board or route");
      if (person === "inactive") return null;
      const { id, handle, name, avatar, tokenName, expiresAt, can } = person;
      const member = await board.member(id);
      if (!member) throw new BoardError("not_found", "no such board or route");
      const principal = `ob:user:${id}`;
      const effective = personGrantCan(await board.personGrants(id), member.role);
      return {
        actor: principal,
        principal,
        profile: null,
        [credentialKind]: "personal",
        [credentialExpiry]: expiresAt,
        [credentialName]: tokenName,
        [memberOf]: { handle, name, avatar, ...member },
        [callerCan]: can === undefined ? effective : narrowCan(effective, can),
        ...(can === undefined ? {} : { [requestNarrowed]: true as const, [personalPin]: can }),
      };
    },
  };
}
