import { describe, expect, test } from "bun:test";
import { BoardError } from "../src/errors.ts";
import { parseProfileHeader } from "../src/headers.ts";

function codeOf(value: string): string {
  try {
    parseProfileHeader(value);
  } catch (error) {
    if (error instanceof BoardError) return error.code;
    throw error;
  }
  throw new Error("expected a BoardError");
}

describe("x-board-profile", () => {
  test("names a profile as a token, keeping the spelling sent", () => {
    expect(parseProfileHeader("fixer-2")).toEqual({ name: "fixer-2", params: {} });
    expect(parseProfileHeader(" Claude ")).toEqual({ name: "Claude", params: {} });
  });

  test("names a profile as an RFC 8941 string", () => {
    expect(parseProfileHeader('"fixer-2"').name).toBe("fixer-2");
  });

  test("reads the parameters after the name", () => {
    expect(parseProfileHeader('fixer; avatar="https://example.com/f.png"; bot').params).toEqual({
      avatar: "https://example.com/f.png",
      bot: true,
    });
  });

  test("takes a name of up to 32 characters", () => {
    expect(parseProfileHeader(`a${"b".repeat(31)}`).name).toHaveLength(32);
    expect(codeOf(`a${"b".repeat(32)}`)).toBe("invalid_profile");
  });

  test("refuses what is not a profile name as 400 invalid_profile", () => {
    for (const value of ["", "9 bad", "fixer 2", "fixer_2", "a:b", ":Zm9v:", "?1", '"open', "fixer;Avatar=1"]) {
      expect(codeOf(value)).toBe("invalid_profile");
    }
  });
});
