import { Type } from "@sinclair/typebox";
import { Author } from "./messages.ts";

const tenant = Type.Object({ slug: Type.String(), name: Type.String() });

export const Me = Type.Object({
  ...Author.properties,
  kind: Type.Literal("person"),
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
    role: Type.Literal("owner"),
    credential: Type.Literal("local"),
  }),
});
