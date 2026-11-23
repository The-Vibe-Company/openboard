import { BoardError } from "@openboard/contract";
import type { Principal, ServerConfig } from "../deps.ts";
import { localOwnerVerifier } from "./local-owner.ts";

/** One step of the verifier chain (docs/auth.md "The verifier chain"): a cheap `match`, then `verify`. */
export interface CredentialVerifier {
  readonly name: string;
  match(request: Request): boolean;
  verify(request: Request): Promise<Principal | null>;
}

/** The chain this server runs, in docs/auth.md order; only the local owner token (step 4) exists so far. */
export function verifiers(config: ServerConfig): readonly CredentialVerifier[] {
  const chain: CredentialVerifier[] = [];
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
 * Who a request writes as: the first verifier that matches decides, and a credential it refuses is 401
 * `unauthorized`. A request no verifier matches carries no credential and is 401 `unauthorized` too.
 */
export async function authenticate(request: Request, chain: readonly CredentialVerifier[]): Promise<Principal> {
  const verifier = chain.find((candidate) => candidate.match(request));
  if (!verifier) throw noCredential();
  const principal = await verifier.verify(request);
  if (!principal) throw new BoardError("unauthorized", "the credential is not valid on this board");
  return principal;
}
