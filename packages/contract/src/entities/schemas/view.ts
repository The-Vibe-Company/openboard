import { type Static, Type } from "@sinclair/typebox";

export const SchemaDefinition = Type.Record(Type.String(), Type.Unknown());

export const SchemaView = Type.Object({
  id: Type.String(),
  name: Type.String(),
  version: Type.Integer(),
  description: Type.Union([Type.String(), Type.Null()]),
  schema: SchemaDefinition,
  builtIn: Type.Boolean(),
  by: Type.Union([Type.String(), Type.Null()]),
  at: Type.Union([Type.String(), Type.Null()]),
});
export type SchemaView = Static<typeof SchemaView>;
