import { BoardError } from "@openboard/contract";
import type { PersonRecord, PlatformView, SessionRecord, SignInRecord } from "@openboard/ports";
import type { Db, Dialect, Row, SqlValue } from "../db.ts";
import { query, sql } from "../sql.ts";
import { redeemInvitation } from "./invitations.ts";

/** People, identities and sessions: global rows, so every statement here is a platform statement. */
export const accountStatements = {
  identityUser: sql`SELECT u.id, u.disabled_at FROM identities i JOIN users u ON u.id = i.user_id
    WHERE i.provider = ${"provider"} AND i.subject = ${"subject"}`,
  refreshUser: sql`UPDATE users SET handle = ${"handle"}, name = ${"name"}, email = ${"email"}, avatar = ${"avatar"}
    WHERE id = ${"userId"}`,
  refreshIdentity: sql`UPDATE identities SET email = ${"email"} WHERE provider = ${"provider"} AND subject = ${"subject"}`,
  insertUser: sql`INSERT INTO users (public_id, handle, name, email, avatar, created_at)
    VALUES (${"publicId"}, ${"handle"}, ${"name"}, ${"email"}, ${"avatar"}, ${"at"}) RETURNING id`,
  insertIdentity: sql`INSERT INTO identities (provider, subject, user_id, email, created_at)
    VALUES (${"provider"}, ${"subject"}, ${"userId"}, ${"email"}, ${"at"})
    ON CONFLICT (provider, subject) DO NOTHING RETURNING user_id`,
  insertSession: sql`INSERT INTO sessions (id_hash, user_id, csrf, created_at, seen_at, expires_at)
    VALUES (${"idHash"}, ${"userId"}, ${"csrf"}, ${"at"}, ${"at"}, ${"expiresAt"})`,
  userById: sql`SELECT public_id, handle, name, email, avatar FROM users WHERE id = ${"userId"}`,
  userProviders: sql`SELECT provider FROM identities WHERE user_id = ${"userId"} ORDER BY provider`,
  sessionByHash: sql`SELECT s.user_id, s.csrf, s.seen_at, s.expires_at, u.public_id, u.handle, u.name, u.email,
    u.avatar FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id_hash = ${"idHash"} AND s.revoked_at IS NULL AND u.disabled_at IS NULL`,
  touchSession: sql`UPDATE sessions SET seen_at = ${"at"} WHERE id_hash = ${"idHash"}`,
  revokeSession: sql`UPDATE sessions SET revoked_at = ${"at"} WHERE id_hash = ${"idHash"} AND revoked_at IS NULL`,
  listPersonalTokens: sql`SELECT t.id, t.name, o.slug AS org, t.created_at, t.expires_at, t.revoked_at
    FROM personal_tokens t JOIN orgs o ON o.id = t.org_id
    WHERE t.user_id = (SELECT id FROM users WHERE public_id = ${"personId"})
    ORDER BY t.created_at DESC, t.id`,
  revokePersonalToken: sql`UPDATE personal_tokens SET revoked_at = COALESCE(revoked_at, ${"at"})
    WHERE id = ${"id"} AND user_id = (SELECT id FROM users WHERE public_id = ${"personId"}) RETURNING revoked_at`,
  revokeAllSessions: sql`UPDATE sessions SET revoked_at = ${"at"} WHERE revoked_at IS NULL
    AND user_id = (SELECT id FROM users WHERE public_id = ${"personId"})`,
};

export const accountPlatformStatements: readonly (keyof typeof accountStatements)[] = Object.freeze(
  Object.keys(accountStatements) as (keyof typeof accountStatements)[],
);

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const text = (value: SqlValue | undefined) => (value === null || value === undefined ? null : String(value));

async function personOf(db: Db, dialect: Dialect, userId: number, row: Row): Promise<PersonRecord> {
  const providers = await query(db, dialect, accountStatements.userProviders, { userId });
  return {
    id: String(row.public_id),
    handle: String(row.handle),
    name: String(row.name),
    email: text(row.email),
    avatar: text(row.avatar),
    providers: providers.map((provider) => String(provider.provider)),
  };
}

class IdentityCreatedConcurrently extends Error {}

/** The person holding the identity, refreshed from it, or a new one if admitted; null if refused or disabled. */
async function holder(tx: Db, dialect: Dialect, record: SignInRecord): Promise<number | null> {
  const { identity, now } = record;
  const details = { handle: identity.login, name: identity.name, email: identity.email, avatar: identity.avatar };
  const [known] = await query(tx, dialect, accountStatements.identityUser, identity);
  if (known) {
    if (known.disabled_at !== null) return null;
    const userId = Number(known.id);
    await query(tx, dialect, accountStatements.refreshUser, { ...details, userId });
    await query(tx, dialect, accountStatements.refreshIdentity, identity);
    return userId;
  }
  if (!record.admitNew && !record.invitationHash) return null;
  const [created] = await query(tx, dialect, accountStatements.insertUser, {
    ...details,
    publicId: record.newPersonId,
    at: now,
  });
  const userId = Number(created?.id);
  const [inserted] = await query(tx, dialect, accountStatements.insertIdentity, { ...identity, userId, at: now });
  if (!inserted) throw new IdentityCreatedConcurrently();
  if (record.invitationHash && !(await redeemInvitation(tx, dialect, record.invitationHash, record.newPersonId, now))) {
    throw new BoardError("forbidden", "a live invitation is required to sign up with this link");
  }
  return userId;
}

/** The platform's account methods, written once for both engines. */
export function accountView(
  db: Db,
  dialect: Dialect,
): Pick<
  PlatformView,
  | "signIn"
  | "session"
  | "touchSession"
  | "revokeSession"
  | "revokeAllSessions"
  | "listPersonalTokens"
  | "revokePersonalToken"
> {
  const signIn = (record: SignInRecord) =>
    db.transaction(async (tx) => {
      const userId = await holder(tx, dialect, record);
      if (userId === null) return null;
      const { idHash, csrf, expiresAt } = record.session;
      const at = record.now;
      await query(tx, dialect, accountStatements.insertSession, {
        idHash: bytes(idHash),
        userId,
        csrf,
        at,
        expiresAt,
      });
      const [row] = await query(tx, dialect, accountStatements.userById, { userId });
      if (!row) throw new Error(`user ${userId} vanished during its sign-in`);
      return personOf(tx, dialect, userId, row);
    });
  return {
    async signIn(record) {
      try {
        return await signIn(record);
      } catch (error) {
        if (!(error instanceof IdentityCreatedConcurrently)) throw error;
        // The conflicting sign-in committed. Retry after rolling back our provisional person.
        return signIn(record);
      }
    },
    async session(idHash): Promise<SessionRecord | null> {
      const [row] = await query(db, dialect, accountStatements.sessionByHash, { idHash: bytes(idHash) });
      if (!row) return null;
      const person = await personOf(db, dialect, Number(row.user_id), row);
      return { person, csrf: String(row.csrf), seenAt: Number(row.seen_at), expiresAt: Number(row.expires_at) };
    },
    async touchSession(idHash, now) {
      await query(db, dialect, accountStatements.touchSession, { idHash: bytes(idHash), at: now });
    },
    async revokeSession(idHash, now) {
      await query(db, dialect, accountStatements.revokeSession, { idHash: bytes(idHash), at: now });
    },
    async listPersonalTokens(personId) {
      const rows = await query(db, dialect, accountStatements.listPersonalTokens, { personId });
      return rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        org: String(row.org),
        createdAt: Number(row.created_at),
        expiresAt: Number(row.expires_at),
        revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
      }));
    },
    async revokePersonalToken(personId, id, now) {
      const [row] = await query(db, dialect, accountStatements.revokePersonalToken, { personId, id, at: now });
      return row ? Number(row.revoked_at) : null;
    },
    async revokeAllSessions(personId, now) {
      await query(db, dialect, accountStatements.revokeAllSessions, { personId, at: now });
    },
  };
}
