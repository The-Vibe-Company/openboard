import { timingSafeEqual } from "node:crypto";
import type { BoardView, ConnectionRecord } from "@openboard/ports";
import { callerCan, connectionOf, credentialKind, type Principal } from "../deps.ts";
import type { CredentialVerifier } from "./chain.ts";
import { bearer, hashToken } from "./secrets.ts";

const PREFIX = "obc_";
/** `obc_<16 base32>_<43 base64url>`: the 16 base32 characters name the connection, `cn_<name>`. */
const SECRET = /^obc_([a-z2-7]{16})_[A-Za-z0-9_-]{43}$/;

/** The operation any connection's secret may call, `direct` or not: trading it for an agent token (mode 2). */
const CLAIM = "claimConnection";

/** Random bytes of a secret's secret part: 32, which base64url writes in 43 characters. */
export const SECRET_PART_BYTES = 32;

/** A new secret for the connection `cn_<name>`: the same name, so it selects the same row, and a fresh secret part. */
export function reissueSecret(
  connectionId: string,
  random: Uint8Array,
): { readonly token: string; readonly hash: string } {
  if (random.length !== SECRET_PART_BYTES) throw new RangeError(`a secret takes ${SECRET_PART_BYTES} random bytes`);
  const token = `${PREFIX}${connectionId.slice("cn_".length)}_${Buffer.from(random).toString("base64url")}`;
  return { token, hash: hashToken(token) };
}

/** Whether `hash` (hex) is the connection's secret, or the one its last rotation replaced while the overlap lasts. */
function holdsSecret(record: ConnectionRecord, hash: string, now: number): boolean {
  const presented = Buffer.from(hash, "hex");
  if (timingSafeEqual(presented, Buffer.from(record.secretHash, "hex"))) return true;
  const { previous } = record;
  return (
    previous !== null && now < previous.until && timingSafeEqual(presented, Buffer.from(previous.secretHash, "hex"))
  );
}

/**
 * Step 2 of the verifier chain (docs/auth.md "Three ways to connect", modes 1 and 2): an `obc_` bearer writes as its
 * connection when the request's board holds that connection, the secret's SHA-256 is the one kept, and the connection
 * is `direct` or the request claims an agent token. Within a rotation's overlap the replaced secret's hash is kept too.
 */
export function connectionVerifier(now: () => number): CredentialVerifier {
  return {
    name: "connection",
    match: (request) => bearer(request)?.startsWith(PREFIX) ?? false,
    async verify(request: Request, board: BoardView, operation: string): Promise<Principal | null> {
      const secret = bearer(request) ?? "";
      const id = SECRET.exec(secret)?.[1];
      if (id === undefined) return null;
      const record = await board.connection(`cn_${id}`);
      if (!record || !(record.connection.direct || operation === CLAIM)) return null;
      if (!holdsSecret(record, hashToken(secret), now())) return null;
      const { principal, name, profiles, can } = record.connection;
      return {
        actor: principal,
        principal,
        profile: null,
        [credentialKind]: "connection",
        [connectionOf]: { name, profiles },
        [callerCan]: can,
      };
    },
  };
}
