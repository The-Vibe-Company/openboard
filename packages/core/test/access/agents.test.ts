import { describe, expect, test } from "bun:test";
import type { Can, CanInput } from "@openboard/contract";
import { decideClaim, decideRefresh, ttlSeconds } from "../../src/access/agents.ts";

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
    expect(claim({ profile: "fixer-2", can: { "dev/a": ["post", "read"] }, ttl: "5m" }).agent).toMatchObject({
      can: { "dev/a": ["read", "post"] },
      expiresAt: "2023-11-14T22:18:20.000Z",
    });
    expect(claim({ profile: "fixer-2", ttl: "30d" }).agent.expiresAt).toBe("2023-11-15T22:13:20.000Z");
  });

  test("keeps a can inside the grant: `dev/` covers `dev` and what is under it", () => {
    const inside: Can[] = [{ dev: ["read"] }, { "dev/x/": ["post"] }, { "dev/": ["read"] }];
    for (const can of inside) {
      expect(claim({ profile: "fixer-2", can }).agent.can).toEqual(can);
    }
  });

  test("refuses a can past the connection's grant with 403 forbidden", () => {
    const past: CanInput[] = [{ "*": "all" }, { "dev/": ["label"] }, { ops: ["read"] }];
    for (const can of past) {
      expect(() => claim({ profile: "fixer-2", can })).toThrow(expect.objectContaining({ code: "forbidden" }));
    }
  });

  test("checks the grant's most specific pattern, under the claim's broader one too", () => {
    const grant = { "*": ["read" as const, "post" as const], "ops/": ["read" as const] };
    const at = { by, now: NOW, connection: { ...connection, profiles: ["*"], can: grant }, token };
    const decide = (can: Record<string, ("read" | "post")[]>) => () =>
      decideClaim({ head: 7 }, { profile: "a", can }, at);
    expect(decide({ "*": ["post"] })).toThrow(expect.objectContaining({ code: "forbidden" }));
    expect(decide({ ops: ["post"] })).toThrow(expect.objectContaining({ code: "forbidden" }));
    expect(decide({ "*": ["post"], "ops/": ["read"] })).not.toThrow();
  });

  test("refuses a profile the connection's patterns do not let in with 403 forbidden", () => {
    expect(() => claim({ profile: "reviewer" })).toThrow(expect.objectContaining({ code: "forbidden" }));
  });

  test("reads lifetimes in seconds, minutes, hours and days, and refuses anything else", () => {
    expect([ttlSeconds("90s"), ttlSeconds("5m"), ttlSeconds("1h"), ttlSeconds("2d")]).toEqual([90, 300, 3600, 172_800]);
    expect(() => ttlSeconds("1w")).toThrow(expect.objectContaining({ code: "invalid_request" }));
  });
});

describe("refreshing an agent token", () => {
  const claimed = claim({ profile: "fixer-2", ttl: "5m" }).agent;
  const next = { id: token.id, hash: "12".repeat(32) };
  const stored = { tokenHash: token.hash, tokenTtl: 3600, tokenExpires: NOW + 300_000, hardExpires: NOW + 86_400_000 };
  const refresh = (now: number, presented = token.hash, agent = { ...stored, agent: claimed }) =>
    decideRefresh({ head: 9, agent }, { by, now, presented, token: next });

  test("lives the connection's token lifetime from now, keeps the pins, and keeps the old token 60 s", () => {
    const { agent, events } = refresh(NOW + 60_000);
    expect(agent).toEqual({ ...claimed, expiresAt: "2023-11-14T23:14:20.000Z" });
    expect(events[0]).toMatchObject({ id: 10, type: "ob.agent.refreshed", visibility: 2, actor: by.actor });
    expect(events[0].payload).toMatchObject({
      agent: token.id,
      tokenHash: next.hash,
      previousHash: token.hash,
      previousUntil: NOW + 120_000,
    });
  });

  test("never moves past the hard expiry, and refuses past it", () => {
    expect(refresh(NOW + 86_000_000).agent.expiresAt).toBe(claimed.hardExpiresAt);
    expect(() => refresh(NOW + 86_400_000)).toThrow("hard expiry");
  });

  test("never shortens a token claimed for longer than the connection's token lifetime", () => {
    const long = claim({ profile: "fixer-2", ttl: "12h" }).agent;
    const agent = { ...stored, agent: long, tokenExpires: NOW + 43_200_000 };
    expect(refresh(NOW + 60_000, token.hash, agent).agent.expiresAt).toBe(long.expiresAt);
  });

  test("refuses a token that is no longer the agent's current one", () => {
    expect(() => refresh(NOW, "34".repeat(32))).toThrow("already refreshed");
  });
});
