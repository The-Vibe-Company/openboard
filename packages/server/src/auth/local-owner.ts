import { timingSafeEqual } from "node:crypto";
import { credentialKind, type Principal } from "../deps.ts";
import type { CredentialVerifier } from "./chain.ts";
import { hashToken, mintSecret } from "./secrets.ts";

const PREFIX = "obl_";

/**
 * A fresh local owner token, `obl_<16 base32>_<43 base64url>`, from 42 random bytes the caller draws: 10 name the
 * token, 32 are its 256-bit secret.
 */
export function mintLocalOwnerToken(random: Uint8Array): { readonly token: string; readonly hash: string } {
  const { token, hash } = mintSecret(PREFIX, random);
  return { token, hash };
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
}

/** Step 4 of the verifier chain: an `obl_` bearer is the local owner, if its SHA-256 is the one `ob serve` wrote. */
export function localOwnerVerifier(owner: string, hash: string): CredentialVerifier {
  const expected = Buffer.from(hash, "hex");
  const principal: Principal = { actor: owner, principal: owner, profile: null, [credentialKind]: "local" };
  return {
    name: "local",
    match: (request) => bearer(request)?.startsWith(PREFIX) ?? false,
    async verify(request) {
      const presented = Buffer.from(hashToken(bearer(request) ?? ""), "hex");
      return timingSafeEqual(presented, expected) ? principal : null;
    },
  };
}
