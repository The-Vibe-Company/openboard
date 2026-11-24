import { type Static, Type } from "@sinclair/typebox";
import { ActorKind, Author, MessageAuthor } from "./messages.ts";
import { Role } from "./orgs.ts";

const tenant = Type.Object({ slug: Type.String(), name: Type.String() });

const CredentialKind = Type.Union([
  Type.Literal("local"),
  Type.Literal("connection"),
  Type.Literal("agent"),
  Type.Literal("session"),
  Type.Literal("personal"),
  Type.Literal("oidc"),
]);

export const Me = Type.Object({
  ...Author.properties,
  /** `person` for the local owner, `workflow` for a connection's secret (D45), `agent` for a profile of either. */
  kind: ActorKind,
  handle: Type.String(),
  name: Type.String(),
  avatar: Type.Union([Type.String(), Type.Null()]),
  expiresAt: Type.Union([Type.Number(), Type.Null()]),
  can: Type.Record(
    Type.String(),
    Type.Array(
      Type.Union([
        Type.Literal("read"),
        Type.Literal("post"),
        Type.Literal("react"),
        Type.Literal("label"),
        Type.Literal("sync"),
        Type.Literal("manage"),
      ]),
    ),
  ),
  credential: Type.Optional(
    Type.Object({
      kind: CredentialKind,
      name: Type.Optional(Type.String()),
      /** Epoch milliseconds. */
      expiresAt: Type.Optional(Type.Number()),
    }),
  ),
  openboard: Type.Object({
    org: tenant,
    board: tenant,
    /** The person's role in the organization; null for a credential that is not a person's. */
    role: Type.Union([Role, Type.Null()]),
    credential: CredentialKind,
  }),
});

/**
 * An actor the board has seen write, as `GET /actors` lists it (upstream `{ id, kind, handle, name, avatar, via? }`):
 * its ID and how its writes show, as their `author`.
 */
export const Actor = Type.Object({ id: Type.String(), ...MessageAuthor.properties });
export type Actor = Static<typeof Actor>;
