import { type Static, Type } from "@sinclair/typebox";
import { Ref } from "../../operation.ts";

export const ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const ATTACHMENT_ID_PATTERN =
  /^(?:[A-Za-z0-9_-]{22}|att_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const AttachmentIds = Type.Array(Ref("file", { pattern: ATTACHMENT_ID_PATTERN.source }), { maxItems: 10 });

export const Attachment = Type.Object({
  id: Type.String({ pattern: ATTACHMENT_ID_PATTERN.source }),
  name: Type.String(),
  type: Type.String(),
  size: Type.Integer(),
});
export type Attachment = Static<typeof Attachment>;
