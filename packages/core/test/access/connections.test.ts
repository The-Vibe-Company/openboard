import { describe, expect, test } from "bun:test";
import { profileAllowed } from "../../src/access/connections.ts";

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
