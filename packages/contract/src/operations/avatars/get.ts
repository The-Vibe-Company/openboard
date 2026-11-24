import { Type } from "@sinclair/typebox";
import { defineOperation } from "../../operation.ts";

export const getAvatar = defineOperation({
  name: "getAvatar",
  operationId: "avatar",
  summary: "Fetch a generic profile avatar as SVG. No token.",
  route: { method: "GET", path: "/avatars/:name" },
  scope: "public",
  input: { params: Type.Object({ name: Type.String() }) },
  output: Type.String(),
  responseType: "image/svg+xml",
  errors: ["not_found"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "Profile viewers fetch avatar images directly by URL.",
  upstream: true,
});
