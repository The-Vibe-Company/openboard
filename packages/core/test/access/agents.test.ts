import { describe, expect, test } from "bun:test";
import { decideClaim, ttlSeconds } from "../../src/access/agents.ts";

const NOW = 1_700_000_000_000;
const by = { actor: "ob:conn:cn_aaaaaaaaaaaaaaaa", principal: "ob:conn:cn_aaaaaaaaaaaaaaaa", profile: null };
const connection = {
  id: "cn_aaaaaaaaaaaaaaaa",
  profiles: ["fixer-*"],
  can: { "dev/": ["read" as const, "post" as const] },
  tokenTtl: 3600,
  tokenMax: 86_400,
};
const token = { id: "ag_bbbbbbbbbbbbbbbb", hash: "ef".repeat(32) };
const claim = (command: Parameters<typeof decideClaim>[1]) =>
  decideClaim({ head: 7 }, command, { by, now: NOW, connection, token });

describe("claiming an agent token", () => {
  test("pins the profile, keeps the connection's grant, and lives the connection's token lifetime", () => {
    const { agent, events } = claim({ profile: "Fixer-2" });
    expect(agent).toEqual({
      id: token.id,
      actor: "ob:conn:cn_aaaaaaaaaaaaaaaa+fixer-2",
      can: connection.can,
      expiresAt: "2023-11-14T23:13:20.000Z",
      hardExpiresAt: "2023-11-15T22:13:20.000Z",
    });
    expect(events[0]).toMatchObject({ id: 8, type: "ob.agent.claimed", visibility: 2, actor: by.actor });
    expect(events[0].payload).toMatchObject({ connection: connection.id, profile: "Fixer-2", tokenHash: token.hash });
  });

  test("takes the claim's can, compiled, and its ttl, capped at the connection's maximum", () => {
    expect(claim({ profile: "fixer-2", can: { dev: "all" }, ttl: "5m" }).agent).toMatchObject({
      can: { dev: ["read", "post", "react", "label", "sync", "manage"] },
      expiresAt: "2023-11-14T22:18:20.000Z",
    });
    expect(claim({ profile: "fixer-2", ttl: "30d" }).agent.expiresAt).toBe("2023-11-15T22:13:20.000Z");
  });

  test("refuses a profile the connection's patterns do not let in with 403 forbidden", () => {
    expect(() => claim({ profile: "reviewer" })).toThrow(expect.objectContaining({ code: "forbidden" }));
  });

  test("reads lifetimes in seconds, minutes, hours and days, and refuses anything else", () => {
    expect([ttlSeconds("90s"), ttlSeconds("5m"), ttlSeconds("1h"), ttlSeconds("2d")]).toEqual([90, 300, 3600, 172_800]);
    expect(() => ttlSeconds("1w")).toThrow(expect.objectContaining({ code: "invalid_request" }));
  });
});
