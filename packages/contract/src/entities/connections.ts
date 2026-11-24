import { type Static, Type } from "@sinclair/typebox";

/** Upstream's grant permissions (docs/auth.md "Upstream's model, as we keep it"). */
export const Permission = Type.Union([
  Type.Literal("read"),
  Type.Literal("post"),
  Type.Literal("react"),
  Type.Literal("label"),
  Type.Literal("sync"),
  Type.Literal("manage"),
]);
export type Permission = Static<typeof Permission>;

/** A grant pattern: `*`, a channel `name`, or a channel prefix `name/`. */
const Pattern = Type.String({ minLength: 1, maxLength: 501 });

/** What a grant lets in, as written: per pattern, `"all"` or a list of permissions. */
export const CanInput = Type.Record(
  Pattern,
  Type.Union([Type.Literal("all"), Type.Array(Permission, { maxItems: 6 })]),
);
export type CanInput = Static<typeof CanInput>;

/** What a grant lets in, compiled: per pattern, its permissions in upstream's order, none repeated. */
export const Can = Type.Record(Type.String(), Type.Array(Permission));
export type Can = Static<typeof Can>;

/** Connection names: the handle its profiles write under (`laptop`, `ci-fixers`). */
export const ConnectionName = Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,62}$" });

/** A connection as the board shows it; its secret is never part of it (docs/auth.md "Connections"). */
export const Connection = Type.Object({
  id: Type.String(),
  principal: Type.String(),
  name: ConnectionName,
  /** The ID of the connection's grant on this board, `g<n>`. */
  grant: Type.String(),
  can: Can,
  direct: Type.Boolean(),
  profiles: Type.Array(Type.String()),
  /** `…` and the last four characters of the secret, for people to tell secrets apart; never its `obc_` prefix. */
  secretHint: Type.String(),
  createdBy: Type.String(),
  createdAt: Type.String(),
});
export type Connection = Static<typeof Connection>;

/** What creating a connection answers: the secret is shown here once, and nowhere else. */
export const CreatedConnection = Type.Object({
  connection: Connection,
  secret: Type.String(),
  env: Type.Object({ BOARD_URL: Type.String(), BOARD_TOKEN: Type.String() }),
});
export type CreatedConnection = Static<typeof CreatedConnection>;

/** An agent claimed with a connection's secret: its token is pinned to one profile (docs/auth.md mode 2). */
export const ClaimedAgent = Type.Object({
  id: Type.String(),
  /** `ob:conn:cn_…+<profile>`: the connection's principal and the pinned profile. */
  actor: Type.String(),
  can: Can,
  /** When the token stops working; a refresh moves it, never past `hardExpiresAt`. */
  expiresAt: Type.String(),
  hardExpiresAt: Type.String(),
});
export type ClaimedAgent = Static<typeof ClaimedAgent>;

/** What a claim answers: the agent, its `obt_` token shown once, and the env an orchestrator injects. */
export const ClaimResult = Type.Object({
  agent: ClaimedAgent,
  token: Type.String(),
  env: Type.Object({ BOARD_URL: Type.String(), BOARD_TOKEN: Type.String(), BOARD_PROFILE: Type.String() }),
});
export type ClaimResult = Static<typeof ClaimResult>;

/** A live agent of a connection as its managers see it: no token, only who it writes as and until when. */
export const ConnectionAgent = Type.Object({
  ...ClaimedAgent.properties,
  /** The pinned profile as the claim spelled it. */
  profile: Type.String(),
  createdAt: Type.String(),
});
export type ConnectionAgent = Static<typeof ConnectionAgent>;

/** A connection as the people who manage it see it: its live agents and when it was last used, never a secret. */
export const ManagedConnection = Type.Object({
  ...Connection.properties,
  /** When the connection or one of its agents last wrote on the board, a claim included; null when never. */
  lastUsedAt: Type.Union([Type.String(), Type.Null()]),
  /** Its unrevoked agents whose hard expiry has not passed, oldest first. */
  agents: Type.Array(ConnectionAgent),
});
export type ManagedConnection = Static<typeof ManagedConnection>;
