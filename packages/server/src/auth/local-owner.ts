import { createHash, timingSafeEqual } from "node:crypto";
import { credentialKind, type Principal } from "../deps.ts";
import type { CredentialVerifier } from "./chain.ts";

const PREFIX = "obl_";
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** The SHA-256 the server keeps of a token, as hex (docs/auth.md "Secret and token formats"). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** RFC 4648 base32, lower case, of bytes whose bit length is a multiple of 5 (10 bytes give 16 characters). */
function base32(bytes: Uint8Array): string {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  return (bits.match(/.{5}/g) ?? []).map((chunk) => BASE32[Number.parseInt(chunk, 2)]).join("");
}

/**
 * A fresh local owner token, `obl_<16 base32>_<43 base64url>`, from 42 random bytes the caller draws: 10 name the
 * token, 32 are its 256-bit secret.
 */
export function mintLocalOwnerToken(random: Uint8Array): { readonly token: string; readonly hash: string } {
  if (random.length !== 42) throw new RangeError("a local owner token takes 42 random bytes");
  const token = `${PREFIX}${base32(random.subarray(0, 10))}_${Buffer.from(random.subarray(10)).toString("base64url")}`;
  return { token, hash: hashToken(token) };
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
