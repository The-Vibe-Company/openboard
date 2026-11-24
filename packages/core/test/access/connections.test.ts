import { describe, expect, test } from "bun:test";
import { decideRotate, profileAllowed } from "../../src/access/connections.ts";

describe("a connection's profile patterns", () => {
  test("`*` lets any profile in", () => {
    expect(profileAllowed(["*"], "anyone")).toBe(true);
  });

  test("a pattern ending in `*` lets in the names it starts", () => {
    expect(profileAllowed(["fixer-*"], "fixer-2")).toBe(true);
    expect(profileAllowed(["fixer-*"], "Fixer-3")).toBe(true);
    expect(profileAllowed(["fixer-*"], "reviewer")).toBe(false);
  });

  test("a plain pattern lets in that name only, in any case", () => {
    expect(profileAllowed(["ci", "Bot"], "CI")).toBe(true);
    expect(profileAllowed(["ci", "Bot"], "bot")).toBe(true);
    expect(profileAllowed(["ci", "Bot"], "ci-2")).toBe(false);
  });
});

describe("rotating a connection's secret", () => {
  const by = { actor: "ob:user:owner", principal: "ob:user:owner", profile: null };
  const secret = { hash: "ab".repeat(32), hint: "obc_…wxyz" };
  const rotate = (overlap?: string) =>
    decideRotate(7, { connection: "cn_x", ...(overlap === undefined ? {} : { overlap }) }, { by, now: 1000, secret });

  test("keeps the replaced secret working for the overlap", () => {
    expect(rotate("10m")).toMatchObject({
      id: 8,
      type: "ob.connection.rotated",
      visibility: 2,
      payload: { connection: "cn_x", secretHash: secret.hash, secretHint: secret.hint, previousUntil: 601_000 },
    });
    expect(rotate("24h").payload.previousUntil).toBe(1000 + 86_400_000);
  });

  test("stops the replaced secret at once without an overlap, or with 0s", () => {
    expect(rotate().payload.previousUntil).toBeNull();
    expect(rotate("0s").payload.previousUntil).toBeNull();
  });

  test("refuses an overlap longer than 24 hours", () => {
    expect(() => rotate("25h")).toThrow(expect.objectContaining({ code: "invalid_request" }));
    expect(() => rotate("2d")).toThrow(expect.objectContaining({ code: "invalid_request" }));
  });
});
