import { createHash } from "node:crypto";

import { base32 } from "@openboard/core";

export { base32 };
/** Bytes a credential is minted from: 10 name it, 32 are its 256-bit secret. */
export const SECRET_BYTES = 42;

/** The SHA-256 the server keeps of a token, as hex (docs/auth.md "Secret and token formats"). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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
