import { expect, test } from "bun:test";
import { fileName, fileNameProblem } from "../../src/attachments/name.ts";
import { attachmentDisposition } from "../../src/attachments/upload.ts";

// Expected values from the pinned upstream fileName and fileNameProblem.
const cases = [
  [null, "file"],
  ["", "file"],
  ["../x.txt", "x.txt"],
  ["a/b.txt", "b.txt"],
  ["a\\b.txt", "b.txt"],
  ["a/b/", "file"],
  [" \u0000a\t\u001f\u007fb.txt ", "ab.txt"],
  ["after.png", "after.png"],
  ["résumé.txt", "résumé.txt"],
  ["a".repeat(256), "a".repeat(255)],
  [`${"a".repeat(254)}😀`, `${"a".repeat(254)}\ud83d`],
  [".env", ".env", 'attachment names can\'t start with a dot: ".env"'],
  ["..", "..", 'attachment names can\'t start with a dot: ".."'],
  ["folder/ \u0000.env ", ".env", 'attachment names can\'t start with a dot: ".env"'],
  ...["a\u200bb", "a\u202eb", "a\u2028b", "a\u2029b"].map(
    (name) =>
      [name, name, `attachment names can't hold invisible formatting characters: ${JSON.stringify(name)}`] as const,
  ),
] as const;

test("matches upstream fileName and fileNameProblem", () => {
  for (const [input, name, problem] of cases) {
    const normalized = fileName(input);
    expect(normalized).toBe(name);
    expect(fileNameProblem(normalized)).toBe(problem);
  }
});

test("can encode a download name if upstream truncation splits a surrogate pair", () => {
  const prefix = "a".repeat(254);
  const name = fileName(`${prefix}😀`);
  expect(attachmentDisposition(name, "application/octet-stream")).toEndWith(`filename*=UTF-8''${prefix}%EF%BF%BD`);
});

test("suggests a safe download name for attachments stored with unsafe names", () => {
  for (const name of [".env", "a\u202eb"]) {
    expect(attachmentDisposition(name, "application/octet-stream")).toBe(
      `attachment; filename="file"; filename*=UTF-8''file`,
    );
  }
});
