import { timingSafeEqual } from "node:crypto";
import type { BoardView } from "@openboard/ports";
import { credentialKind, type Principal } from "../deps.ts";
import type { CredentialVerifier } from "./chain.ts";
import { bearer, hashToken } from "./secrets.ts";

const PREFIX = "obc_";
/** `obc_<16 base32>_<43 base64url>`: the 16 base32 characters name the connection, `cn_<name>`. */
const SECRET = /^obc_([a-z2-7]{16})_[A-Za-z0-9_-]{43}$/;

/**
 * Step 2 of the verifier chain (docs/auth.md "Three ways to connect", mode 1): an `obc_` bearer writes as its
 * connection when the request's board holds that connection, it is `direct`, and the secret's SHA-256 is the one kept.
 */
export function connectionVerifier(): CredentialVerifier {
  return {
    name: "connection",
    match: (request) => bearer(request)?.startsWith(PREFIX) ?? false,
    async verify(request: Request, board: BoardView): Promise<Principal | null> {
      const secret = bearer(request) ?? "";
      const name = SECRET.exec(secret)?.[1];
      if (name === undefined) return null;
      const record = await board.connection(`cn_${name}`);
      if (!record?.connection.direct) return null;
      const presented = Buffer.from(hashToken(secret), "hex");
      if (!timingSafeEqual(presented, Buffer.from(record.secretHash, "hex"))) return null;
      const { principal } = record.connection;
      return { actor: principal, principal, profile: null, [credentialKind]: "connection" };
    },
  };
}
