import { Type } from "@sinclair/typebox";
import { defineOperation } from "../../operation.ts";

export const getMetrics = defineOperation({
  name: "getMetrics",
  summary: "Scrape instance metrics using the configured operator bearer token.",
  route: { method: "GET", path: "/metrics", mount: "/api/x" },
  scope: "public",
  auth: "operator",
  input: {},
  output: Type.String(),
  responseType: "text/plain",
  errors: ["not_found", "unauthorized", "unavailable"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "Instance metrics are for operators.",
  upstream: false,
});
