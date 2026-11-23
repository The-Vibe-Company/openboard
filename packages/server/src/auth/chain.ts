import { BoardError, PROFILE_HEADER, parseProfileHeader } from "@openboard/contract";
import { connections } from "@openboard/core";
import type { BoardView } from "@openboard/ports";
import { connectionOf, type Principal, type ServerConfig } from "../deps.ts";
import { connectionVerifier } from "./connections.ts";
import { localOwnerVerifier } from "./local-owner.ts";

/**
 * One step of the verifier chain (docs/auth.md "The verifier chain"): a cheap `match`, then `verify` against the board
 * the request's path names, so a credential bound to another board is not found there.
 */
export interface CredentialVerifier {
  readonly name: string;
  match(request: Request): boolean;
  verify(request: Request, board: BoardView): Promise<Principal | null>;
}

/** The chain this server runs, in docs/auth.md order: connection secrets (step 2), then the local owner token (step 4). */
export function verifiers(config: ServerConfig): readonly CredentialVerifier[] {
  const chain: CredentialVerifier[] = [connectionVerifier()];
  if (config.mode === "local" && config.localOwnerTokenHash) {
    chain.push(localOwnerVerifier(config.localOwner, config.localOwnerTokenHash));
  }
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
 * case-insensitively, so the actor and profile are lowercase.
 */
function withProfile(request: Request, principal: Principal): Principal {
  const header = request.headers.get(PROFILE_HEADER);
  if (header === null) return principal;
  const { name } = parseProfileHeader(header);
  const connection = principal[connectionOf];
  if (connection && !connections.profileAllowed(connection.profiles, name)) {
    throw new BoardError("forbidden", `this connection may not write as ${name}`, {
      hint: `Pick a profile its patterns let in: ${connection.profiles.join(", ")}.`,
    });
  }
  const profile = name.toLowerCase();
  return { ...principal, actor: `${principal.principal}+${profile}`, profile };
}

/**
 * Who a request writes as on `board`: the first verifier that matches decides, and a credential it refuses is 401
 * `unauthorized`. A request no verifier matches carries no credential and is 401 `unauthorized` too. A verified
 * caller then writes as the profile `x-board-profile` names, if any.
 */
export async function authenticate(
  request: Request,
  chain: readonly CredentialVerifier[],
  board: BoardView,
): Promise<Principal> {
  const verifier = chain.find((candidate) => candidate.match(request));
  if (!verifier) throw noCredential();
  const principal = await verifier.verify(request, board);
  if (!principal) throw new BoardError("unauthorized", "the credential is not valid on this board");
  return withProfile(request, principal);
}
