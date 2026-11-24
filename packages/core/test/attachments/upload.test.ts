import { expect, test } from "bun:test";
import { attachmentDisposition, attachmentId, attachmentName, attachmentType } from "../../src/attachments/upload.ts";

test("attachment names and media types cannot inject response headers", () => {
  const name = attachmentName(encodeURIComponent('path/quote".png\r\n'));
  expect(name).toBe('quote".png');
  expect(attachmentDisposition(name, "image/png")).toBe(
    "inline; filename=\"quote_.png\"; filename*=UTF-8''quote%22.png",
  );
  expect(attachmentDisposition("file.svg", "image/svg+xml")).toStartWith("attachment;");
  expect(attachmentType("invalid type")).toBe("application/octet-stream");
  expect(attachmentId(new Uint8Array(16))).toBe("att_00000000-0000-4000-8000-000000000000");
});
