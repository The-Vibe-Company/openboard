import { describe, expect, test } from "bun:test";
import { BoardError } from "@openboard/contract";
import { orgs } from "../../src/index.ts";

const by = "ob:user:u_aaaaaaaaaaaaaaaa";
const now = 1_700_000_000_000;

describe("creating an organization", () => {
  test("makes the person its owner and gives it the board main, recorded as two organization events", () => {
    expect(orgs.decideCreate({ name: "Acme", slug: "acme" }, { by, now })).toEqual({
      org: { slug: "acme", name: "Acme" },
      role: "owner",
      board: { slug: "main", name: "main" },
      events: [
        {
          id: 1,
          type: "ob.org.created",
          at: now,
          actor: by,
          payload: { org: { slug: "acme", name: "Acme" }, owner: by },
        },
        { id: 2, type: "ob.board.created", at: now, actor: by, payload: { board: { slug: "main", name: "main" } } },
      ],
    });
  });

  test("keeps the name without its surrounding spaces", () => {
    expect(orgs.decideCreate({ name: "  Acme Inc ", slug: "acme" }, { by, now }).org.name).toBe("Acme Inc");
  });

  test("refuses a name that is only spaces", () => {
    const attempt = () => orgs.decideCreate({ name: "   ", slug: "acme" }, { by, now });
    expect(attempt).toThrow(BoardError);
    expect(attempt).toThrow(expect.objectContaining({ code: "invalid_request" }));
  });
});
