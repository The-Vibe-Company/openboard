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
  errors: ["invalid_request", "invalid_attachment", "too_large", "forbidden", "quota_exceeded"],
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

const directUpload = {
  scope: "board",
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  stub: true,
  cli: false,
  mcp: false,
  why: "This board only supports attachments of up to 4 MB through POST /attachments.",
  upstream: true,
} as const;

export const startUpload = defineOperation({
  ...directUpload,
  name: "startUpload",
  operationId: "uploadStart",
  summary: "Start a direct upload. This board answers 501.",
  route: { method: "POST", path: "/attachments/uploads" },
  input: {
    body: Type.Object({
      name: Type.Optional(Type.Union([Type.String({ maxLength: 1024 }), Type.Null()])),
      type: Type.Optional(Type.Union([Type.String({ maxLength: 1024 }), Type.Null()])),
      size: Type.Integer({ minimum: 1, maximum: 100 * 1024 * 1024 }),
      sha256: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9+/]{43}=$" })),
    }),
  },
  output: Type.Object({
    id: Type.String(),
    url: Type.String(),
    headers: Type.Record(Type.String(), Type.String()),
    expiresAt: Type.String(),
  }),
  errors: ["invalid_request", "no_direct_uploads"],
});

export const finishUpload = defineOperation({
  ...directUpload,
  name: "finishUpload",
  operationId: "uploadFinish",
  summary: "Finish a direct upload. This board answers 501.",
  route: { method: "POST", path: "/attachments/uploads/:id" },
  input: { params: Type.Object({ id: Ref("file") }) },
  output: Type.Object({ attachment: Attachment }),
  status: 201,
  errors: ["invalid_request", "no_direct_uploads"],
});
