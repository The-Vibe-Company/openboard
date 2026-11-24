import { BoardError, PROFILE_HEADER, parseProfileHeader } from "@openboard/contract";
import { connections } from "@openboard/core";
import type { BoardView, PlatformView } from "@openboard/ports";
import { connectionOf, type Deps, type Principal, profileAvatar, profileName, type ServerConfig } from "../deps.ts";
import type { RequestLimits } from "../http/limits.ts";
import { connectionVerifier } from "./connections.ts";
import { localOwnerVerifier } from "./local-owner.ts";
import { oidcVerifier } from "./oidc.ts";
import { personalTokenVerifier } from "./personal-tokens.ts";
import { oidcIssuer } from "./providers/index.ts";
import { sessionVerifier } from "./sessions.ts";
import { agentTokenVerifier } from "./tokens.ts";

/**
 * One step of the verifier chain (docs/auth.md "The verifier chain"): a cheap `match`, then `verify` against the board
 * the request's path names, so a credential bound to another board is not found there.
 */
export interface CredentialVerifier {
  readonly name: string;
  match(request: Request): boolean;
  /** `operation` is the name of the contract operation the request's route matched. */
  verify(request: Request, board: BoardView, operation: string, audience?: string): Promise<Principal | null>;
}

/**
 * The chain this server runs, in docs/auth.md order: agent tokens (step 1), connection secrets (step 2), personal tokens
 * (step 3), the local owner token (step 4), OIDC (step 5), then a browser's session (step 6). The clock checks credential lifetimes.
 */
export function verifiers(config: ServerConfig, platform: PlatformView, deps: Deps): readonly CredentialVerifier[] {
  const { now } = deps;
  const chain: CredentialVerifier[] = [agentTokenVerifier(now), connectionVerifier(now), personalTokenVerifier(now)];
  if (config.mode === "local" && config.localOwnerTokenHash) {
    chain.push(localOwnerVerifier(config.localOwner, config.localOwnerTokenHash));
  }
  chain.push(oidcVerifier(deps, oidcIssuer, platform), sessionVerifier(platform, now, config.publicUrl));
  return chain;
}

/** The answer to a request no verifier matches: no bearer, or one of no kind this board accepts. */
function noCredential(): BoardError {
  return new BoardError("unauthorized", "this board needs a credential", {
    hint: "Set BOARD_TOKEN to a token for this board, or run ob as the user who started `ob serve`.",
  });
}

/**
 * The profile `x-board-profile` picks, written as `principal+profile` (docs/auth.md "Upstream's model", points 2-3).
 * A connection writes only as a profile its `profiles` patterns let in, else 403 `forbidden`; names compare
 * case-insensitively, so the actor and profile are lowercase; the spelling sent is the one shown.
 */
function withProfile(request: Request, principal: Principal): Principal {
  const header = request.headers.get(PROFILE_HEADER);
  if (header === null) return principal;
  const { name, avatar } = parseProfileHeader(header);
  const connection = principal[connectionOf];
  if (connection && !connections.profileAllowed(connection.profiles, name)) {
    throw new BoardError("forbidden", `this connection may not write as ${name}`, {
      hint: `Pick a profile its patterns let in: ${connection.profiles.join(", ")}.`,
    });
  }
  const profile = name.toLowerCase();
  return {
    ...principal,
    actor: `${principal.principal}+${profile}`,
    profile,
    [profileName]: name,
    [profileAvatar]: avatar,
  };
}

/** Admit an authentication attempt before it resolves the board or checks any credential. */
export async function limitAuthentication<T>({ rateLimits, ip }: RequestLimits, verify: () => Promise<T>): Promise<T> {
  if (ip === undefined) return verify();
  const finish = await rateLimits.admitAuth(ip);
  if (typeof finish === "number") {
    throw new BoardError("rate_limited", "too many failed authentication attempts", {
      next: [{ kind: "wait", seconds: finish }],
    });
  }
  let failed = false;
  try {
    return await verify();
  } catch (error) {
    failed = error instanceof BoardError && error.code === "unauthorized";
    throw error;
  } finally {
    finish(failed);
  }
}

/**
 * Who a request for `operation` writes as on `board`: the first verifier that matches decides, and a credential it
 * refuses is 401 `unauthorized`. A request no verifier matches carries no credential and is 401 `unauthorized` too. A
 * verified caller then writes as the profile `x-board-profile` names, if any.
 */
export async function authenticate(
  request: Request,
  chain: readonly CredentialVerifier[],
  board: BoardView,
  operation: string,
  audience: string,
): Promise<Principal> {
  const verifier = chain.find((candidate) => candidate.match(request));
  if (!verifier) throw noCredential();
  const principal = await verifier.verify(request, board, operation, audience);
  if (!principal) throw new BoardError("unauthorized", "the credential is not valid on this board");
  return withProfile(request, principal);
}
