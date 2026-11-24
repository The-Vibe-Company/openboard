import { Type } from "@sinclair/typebox";
import { OrgExport } from "../../entities/org/exports.ts";
import { Slug } from "../../entities/orgs.ts";
import { defineOperation, Ref } from "../../operation.ts";

const path = "/orgs/:org/exports";
const params = Type.Object({ org: Slug, id: Ref("export", { pattern: "^ex_[0-9a-f]{32}$" }) });
const common = {
  scope: "org",
  access: null,
  orgPersonalToken: true,
  cli: false,
  mcp: false,
  why: "Organization owners use the export commands, including streaming the archive to disk.",
  upstream: false,
} as const;
const errors = ["unauthorized", "forbidden", "not_found", "not_supported"] as const;
const output = Type.Object({ export: OrgExport });

export const requestOrgExport = defineOperation({
  ...common,
  name: "requestOrgExport",
  summary: "Queue an organization export.",
  route: { method: "POST", path },
  status: 202,
  input: { params: Type.Object({ org: Slug }) },
  output,
  errors,
  effects: { readOnly: false, idempotent: false, emits: ["ob.export.requested"] },
});

export const getOrgExport = defineOperation({
  ...common,
  name: "getOrgExport",
  summary: "Read an organization export's status.",
  route: { method: "GET", path: path + "/:id" },
  input: { params },
  output,
  errors,
  effects: { readOnly: true, idempotent: true, emits: [] },
});

export const downloadOrgExport = defineOperation({
  ...common,
  name: "downloadOrgExport",
  summary: "Download an organization export as a gzip-compressed tar archive.",
  route: { method: "GET", path: path + "/:id/download" },
  input: { params },
  output: Type.Unsafe<ReadableStream<Uint8Array>>({ type: "string", format: "binary" }),
  responseType: "application/gzip",
  errors: [...errors, "rate_limited"],
  effects: { readOnly: false, idempotent: false, emits: ["ob.export.downloaded"] },
});
