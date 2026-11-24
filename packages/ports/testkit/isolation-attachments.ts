import { expect } from "bun:test";
import { at, type StoreTenant } from "./isolation-seed.ts";

const attachment = {
  id: "att_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "isolation.txt",
  type: "text/plain",
  size: 1,
};
const digest = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";
async function putAttachment(tenant: StoreTenant) {
  await tenant.board.uploadAttachment(attachment, digest, tenant.personId, new Uint8Array([97]), at);
}

export const attachmentBoardCases = {
  attachments: async (a: StoreTenant, b: StoreTenant) => {
    await putAttachment(b);
    expect(await b.board.attachments([attachment.id])).toHaveLength(1);
    expect(await a.board.attachments([attachment.id])).toEqual([]);
  },
  uploadAttachment: async (a: StoreTenant, b: StoreTenant) => {
    await putAttachment(a);
    expect(await a.board.attachments([attachment.id])).toHaveLength(1);
    expect(await b.board.attachments([attachment.id])).toEqual([]);
  },
};

export const attachmentWriterCases = {
  attachments: async (a: StoreTenant, b: StoreTenant) => {
    await putAttachment(b);
    expect(await b.board.write((writer) => writer.attachments([attachment.id]))).toHaveLength(1);
    expect(await a.board.write((writer) => writer.attachments([attachment.id]))).toEqual([]);
  },
};
