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

/** Headers that name no profile: empty, a name the rules refuse, or a parameter RFC 8941 cannot read. */
const NOT_A_PROFILE = [
  "",
  " ",
  "\t",
  "9 bad",
  "fixer 2",
  "fixer_2",
  "a:b",
  ":Zm9v:",
  "?1",
  '"open',
  "fixer;Avatar=1",
  "fixer, 2",
];

describe("x-board-profile", () => {
  test("names a profile as a token, keeping the spelling sent", () => {
    expect(parseProfileHeader("fixer-2")).toEqual({ name: "fixer-2", avatar: null });
    expect(parseProfileHeader(" Claude ")).toEqual({ name: "Claude", avatar: null });
  });

  test("names a profile as an RFC 8941 string", () => {
    expect(parseProfileHeader('"fixer-2"').name).toBe("fixer-2");
  });

  test("uses the last quoted avatar URL and ignores unknown parameters", () => {
    const header = 'fixer; avatar="https://example.com/old.png"; bot; count=2; avatar="https://example.com/f.png"';
    expect(parseProfileHeader(header)).toEqual({ name: "fixer", avatar: "https://example.com/f.png" });
  });

  test("allows HTTP on local development hosts", () => {
    for (const host of ["localhost", "127.0.0.1"]) {
      const url = `http://${host}:8787/f.png`;
      expect(parseProfileHeader(`fixer; avatar="${url}"`).avatar).toBe(url);
    }
  });

  test("refuses an avatar that is not a quoted allowed URL", () => {
    for (const suffix of [
      "avatar",
      "avatar=?0",
      "avatar=https://example.com/f.png",
      'avatar=""',
      'avatar="/f.png"',
      'avatar="https://"',
      'avatar="http://example.com/f.png"',
      'avatar="data:image/png;base64,AA=="',
    ]) {
      expect(codeOf(`fixer; ${suffix}`)).toBe("invalid_profile");
    }
  });

  test("keeps the last avatar, so a later one it cannot read is refused rather than dropped", () => {
    expect(codeOf('fixer; avatar="https://example.com/f.png"; avatar="http://example.com/g.png"')).toBe(
      "invalid_profile",
    );
    expect(codeOf('fixer; avatar="https://example.com/f.png"; avatar')).toBe("invalid_profile");
  });

  test("refuses a parameter number RFC 8941 cannot hold", () => {
    for (const value of ["1234567890123.5", "-1234567890123.5", "1234567890123456", "1.2345", "1."]) {
      expect(codeOf(`fixer; count=${value}`)).toBe("invalid_profile");
    }
    for (const value of ["123456789012.5", "-123456789012.5", "123456789012345", "1.234", "-1", "0"]) {
      expect(parseProfileHeader(`fixer; count=${value}`)).toEqual({ name: "fixer", avatar: null });
    }
  });

  test("takes a name of up to 32 characters", () => {
    expect(parseProfileHeader(`a${"b".repeat(31)}`).name).toHaveLength(32);
    expect(codeOf(`a${"b".repeat(32)}`)).toBe("invalid_profile");
  });

  test("refuses a header longer than 2048 characters before reading it", () => {
    expect(parseProfileHeader(`fixer${" ".repeat(2043)}`).name).toBe("fixer");
    expect(codeOf(`fixer${" ".repeat(2044)}`)).toBe("invalid_profile");
    expect(codeOf(`a${" ".repeat(100_000)}b`)).toBe("invalid_profile");
  });
});

test("refuses what is not a profile name as 400 invalid_profile", () => {
  for (const value of NOT_A_PROFILE) {
    expect(codeOf(value)).toBe("invalid_profile");
  }
});
