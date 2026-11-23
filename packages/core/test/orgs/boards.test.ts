import { describe, expect, test } from "bun:test";
import { BoardError } from "@openboard/contract";
import { boards } from "../../src/index.ts";

const by = "ob:user:u_aaaaaaaaaaaaaaaa";
const now = 1_700_000_000_000;

function refusal(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof BoardError) return error.code;
    throw error;
  }
  return undefined;
}

describe("creating a board", () => {
  test("names the board and records it as ob.board.created by the person", () => {
    expect(boards.decideCreateBoard({ slug: "ops", name: " Ops " }, { by, now })).toEqual({
      board: { slug: "ops", name: "Ops" },
      event: { type: "ob.board.created", at: now, actor: by, payload: { board: { slug: "ops", name: "Ops" } } },
    });
  });

  test("refuses the reserved slugs x and settings", () => {
    for (const slug of ["x", "settings"]) {
      expect(refusal(() => boards.decideCreateBoard({ slug, name: "Ops" }, { by, now }))).toBe("reserved_slug");
    }
  });

  test("refuses a name that is only spaces", () => {
    expect(refusal(() => boards.decideCreateBoard({ slug: "ops", name: "   " }, { by, now }))).toBe("invalid_request");
  });
});
