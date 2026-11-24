import { describe, expect, test } from "bun:test";
import { BoardError } from "@openboard/contract";
import { connections, grants } from "../../src/index.ts";

const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };
const secret = { id: "cn_aaaaaaaaaaaaaaaa", hash: "ab".repeat(32), hint: "obc_aaaa…wxyz" };

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof BoardError) return error.code;
    throw error;
  }
  return undefined;
}

describe("compileCan", () => {
  test("expands all to every permission in upstream's order", () => {
    expect(grants.compileCan({ "*": "all" })).toEqual({ "*": ["read", "post", "react", "label", "sync", "manage"] });
  });

  test("orders permissions and drops repeats, per pattern", () => {
    expect(grants.compileCan({ "dev/": ["post", "read", "post"], ops: ["label"] })).toEqual({
      "dev/": ["read", "post"],
      ops: ["label"],
    });
  });

  test.each([["Dev"], ["dev//"], ["/dev"], [""], ["dev*"]])("refuses the pattern %p as invalid_grant", (pattern) => {
    expect(codeOf(() => grants.compileCan({ [pattern]: "all" }))).toBe("invalid_grant");
  });

  test("refuses an unknown permission as invalid_grant", () => {
    expect(codeOf(() => grants.compileCan({ "*": ["read", "write" as "read"] }))).toBe("invalid_grant");
  });

  test("refuses a map with no patterns as grant_empty", () => {
    expect(codeOf(() => grants.compileCan({}))).toBe("grant_empty");
  });

  test("retains a pattern with no permissions", () => {
    expect(grants.compileCan({ dev: [] })).toEqual({ dev: [] });
  });
});

describe("connections.decideCreate", () => {
  test("records the connection and a grant naming only it, at the next log position and grant ID", () => {
    const state = { head: 7, nextGrant: 4, nameTaken: false };
    const { connection, events } = connections.decideCreate(
      state,
      { name: "laptop", can: { "*": "all" }, direct: true },
      { by, now: 1_700_000_000_000, secret },
    );
    expect(connection).toEqual({
      id: "cn_aaaaaaaaaaaaaaaa",
      principal: "ob:conn:cn_aaaaaaaaaaaaaaaa",
      name: "laptop",
      grant: "g4",
      can: { "*": ["read", "post", "react", "label", "sync", "manage"] },
      direct: true,
      profiles: ["*"],
      secretHint: "obc_aaaa…wxyz",
      createdBy: "ob:user:local-dev",
      createdAt: "2023-11-14T22:13:20.000Z",
    });
    const [event] = events;
    expect(event).toMatchObject({ id: 8, type: "ob.connection.created", visibility: 2, channel: null });
    expect(event.payload.grant).toEqual({
      id: 4,
      principals: [{ kind: "connection", connection: "cn_aaaaaaaaaaaaaaaa" }],
      can: connection.can,
    });
    expect(event.payload.secretHash).toBe(secret.hash);
    expect(event.payload.claims).toBeNull();
  });

  test("keeps claims on a claim-only connection, and refuses them on a direct one as invalid_request", () => {
    const state = { head: 7, nextGrant: 4, nameTaken: false };
    const create = (direct: boolean) => () =>
      connections.decideCreate(state, { name: "sbx", can: { "*": "all" }, direct, claims: 1 }, { by, now: 1, secret });
    expect(create(false)().events[0].payload.claims).toBe(1);
    expect(codeOf(create(true))).toBe("invalid_request");
  });

  test("refuses a name the board already uses as slug_taken", () => {
    const state = { head: 7, nextGrant: 5, nameTaken: true };
    const decide = () =>
      connections.decideCreate(state, { name: "laptop", can: { "*": "all" } }, { by, now: 1, secret });
    expect(codeOf(decide)).toBe("slug_taken");
  });
});

describe("withImplied", () => {
  test("adds read to react, label and sync, and every permission to manage", () => {
    expect(grants.withImplied(["react"])).toEqual(["read", "react"]);
    expect(grants.withImplied(["post", "label"])).toEqual(["read", "post", "label"]);
    expect(grants.withImplied(["post"])).toEqual(["post"]);
    expect(grants.withImplied(["manage"])).toEqual(["read", "post", "react", "label", "sync", "manage"]);
  });
});

describe("capByRole", () => {
  const all = { "*": ["read", "post", "react", "label", "sync", "manage"] } as const;

  test("caps a member to read, post, react and label", () => {
    expect(grants.capByRole({ "*": [...all["*"]] }, "member")).toEqual({ "*": ["read", "post", "react", "label"] });
  });

  test.each([["owner"], ["admin"]] as const)("leaves an %s uncapped", (role) => {
    expect(grants.capByRole({ "*": [...all["*"]] }, role)).toEqual({ "*": [...all["*"]] });
  });

  test("caps implied permissions and keeps explicit closures", () => {
    expect(grants.capByRole({ "dev/": ["manage"], ops: ["sync"], ci: ["post"] }, "member")).toEqual({
      "dev/": ["read", "post", "react", "label"],
      ops: ["read"],
      ci: ["post"],
    });
    expect(grants.capByRole({ ci: ["post"], ops: [] }, "member")).toEqual({ ci: ["post"], ops: [] });
  });

  test("seeded g1 gives a member the capped set and an admin manage", () => {
    expect(grants.allUsersCan("member")).toEqual({ "*": ["read", "post", "react", "label"] });
    expect(grants.allUsersCan("admin")["*"]).toContain("manage");
  });
});
