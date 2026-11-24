import { type Static, Type } from "@sinclair/typebox";

const NullableText = Type.Union([Type.String(), Type.Null()]);

/** Public task state on a thread root. Claim secrets are never part of this view. */
export const Task = Type.Object({
  state: Type.Union([
    Type.Literal("blocked"),
    Type.Literal("canceled"),
    Type.Literal("claimed"),
    Type.Literal("completed"),
    Type.Literal("failed"),
    Type.Literal("ready"),
    Type.Literal("waiting"),
  ]),
  owner: Type.String(),
  by: Type.String(),
  for: NullableText,
  needs: Type.Array(Type.String()),
  epoch: Type.Integer({ minimum: 0 }),
  claim: Type.Union([Type.Object({ actor: Type.String(), until: Type.String() }), Type.Null()]),
  blocked: Type.Union([Type.Object({ kind: NullableText, reason: Type.String() }), Type.Null()]),
  result: NullableText,
  reason: NullableText,
});
export type Task = Static<typeof Task>;
