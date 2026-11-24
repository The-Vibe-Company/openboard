import { Type } from "@sinclair/typebox";
import { ATTACHMENT_BYTES, Attachment } from "../../entities/attachments/index.ts";
import { defineOperation, Ref } from "../../operation.ts";

export const upload = defineOperation({
  name: "upload",
  summary: "Upload a file to attach to a message.",
  scope: "board",
  route: { method: "POST", path: "/attachments" },
  input: { binary: { maxBytes: ATTACHMENT_BYTES } },
  output: Type.Object({ attachment: Attachment }),
  status: 201,
  errors: ["invalid_request", "too_large", "forbidden", "quota_exceeded"],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: [] },
  cli: false,
  mcp: false,
  why: "The CLI uploads local files through post --attach. MCP cannot supply a byte body.",
  upstream: true,
});

export const download = defineOperation({
  name: "download",
  summary: "Download bytes from an attachment carried by a readable message.",
  scope: "board",
  route: { method: "GET", path: "/attachments/:id" },
  input: { params: Type.Object({ id: Ref("file") }) },
  output: Type.Unsafe<Response>({ type: "string", format: "binary" }),
  responseType: "application/octet-stream",
  errors: ["attachment_not_found", "rate_limited"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "The CLI download command writes streamed bytes to a file. MCP cannot return a byte stream.",
  upstream: true,
});
