import { createHash } from "node:crypto";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
/** Bytes a credential is minted from: 10 name it, 32 are its 256-bit secret. */
export const SECRET_BYTES = 42;

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
 * A fresh credential `<prefix><16 base32>_<43 base64url>` (`ob[ctpl]_`), from 42 random bytes the caller draws. The
 * 16 base32 characters are its public `name`, which selects the row it belongs to.
 */
export function mintSecret(
  prefix: string,
  random: Uint8Array,
): { readonly name: string; readonly token: string; readonly hash: string } {
  if (random.length !== SECRET_BYTES) throw new RangeError(`a secret takes ${SECRET_BYTES} random bytes`);
  const name = base32(random.subarray(0, 10));
  const token = `${prefix}${name}_${Buffer.from(random.subarray(10)).toString("base64url")}`;
  return { name, token, hash: hashToken(token) };
}

/** The bearer token of a request's `authorization` header, or null when it carries none. */
export function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
}
