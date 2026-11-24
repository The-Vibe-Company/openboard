import { expect, test } from "bun:test";
import { agents, resolveRankedCan } from "@openboard/core";
import type { RankedGrant } from "../../src/access/resolve.ts";

const everyone = { level: "everyone", can: { "ops/": ["read"] }, capped: false } satisfies RankedGrant;

test("everyone needs a grant at a closer level to admit the subject", () => {
  expect(resolveRankedCan([everyone])).toEqual({});
});

test("specificity comes before rank, and a closer level wins at the same pattern", () => {
  const broad = { level: "principal", can: { "*": ["read", "post"] }, capped: false } satisfies RankedGrant;
  const group = { level: "group", can: { "ops/": ["post"] }, capped: false } satisfies RankedGrant;
  expect(agents.allowedAt(resolveRankedCan([everyone, broad]), "ops/x")).toEqual(["read"]);
  expect(agents.allowedAt(resolveRankedCan([everyone, broad, group]), "ops/x")).toEqual(["post"]);
});
