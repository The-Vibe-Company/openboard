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

/**
 * Who a request writes as: the first verifier that matches decides, and a credential it refuses is 401
 * `unauthorized`. A request no verifier matches still writes as the local owner until anonymous requests are refused.
 */
export async function authenticate(
  request: Request,
  chain: readonly CredentialVerifier[],
  config: ServerConfig,
): Promise<Principal> {
  const verifier = chain.find((candidate) => candidate.match(request));
  if (!verifier) return { actor: config.localOwner, principal: config.localOwner, profile: null };
  const principal = await verifier.verify(request);
  if (!principal) throw new BoardError("unauthorized", "the credential is not valid on this board");
  return principal;
}
