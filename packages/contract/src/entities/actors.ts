import { Type } from "@sinclair/typebox";
import { Author } from "./messages.ts";

const tenant = Type.Object({ slug: Type.String(), name: Type.String() });

export const Me = Type.Object({
  ...Author.properties,
  /** `person` for the local owner; `connection` for a connection's secret (docs/auth.md "Connections"). */
  kind: Type.Union([Type.Literal("person"), Type.Literal("connection")]),
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
