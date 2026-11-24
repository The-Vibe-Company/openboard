import { type Static, Type } from "@sinclair/typebox";

export const OrgExport = Type.Object({
  id: Type.String(),
  status: Type.Union([Type.Literal("pending"), Type.Literal("ready"), Type.Literal("failed")]),
  expiresAt: Type.Union([Type.Null(), Type.Integer()]),
});
export type OrgExport = Static<typeof OrgExport>;
