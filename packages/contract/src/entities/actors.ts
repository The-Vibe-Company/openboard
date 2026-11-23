import { type Static, Type } from "@sinclair/typebox";
import { ActorKind, Author, MessageAuthor } from "./messages.ts";

const tenant = Type.Object({ slug: Type.String(), name: Type.String() });

export const Me = Type.Object({
  ...Author.properties,
  /** `person` for the local owner, `workflow` for a connection's secret (D45), `agent` for a profile of either. */
  kind: ActorKind,
  handle: Type.String(),
  name: Type.String(),
  avatar: Type.Null(),
  expiresAt: Type.Null(),
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
  openboard: Type.Object({
    org: tenant,
    board: tenant,
    /** The person's role in the organization; null for a credential that is not a person's. */
    role: Type.Union([Type.Literal("owner"), Type.Null()]),
    credential: Type.Union([Type.Literal("local"), Type.Literal("connection")]),
  }),
});

/**
 * An actor the board has seen write, as `GET /actors` lists it (upstream `{ id, kind, handle, name, avatar, via? }`):
 * its ID and how its writes show, as their `author`.
 */
export const Actor = Type.Object({ id: Type.String(), ...MessageAuthor.properties });
export type Actor = Static<typeof Actor>;
