import { expect, test } from "bun:test";
import type { GrantView, Permission } from "@openboard/contract";
import { explainAccess, explainSubject, resolveRankedCan } from "../../src/index.ts";

test("keeps an empty exact grant over prefixes and selects the closest level before combining permissions", () => {
  const grants: Parameters<typeof resolveRankedCan>[0] = [
    { can: { "*": "all", "dev/": ["sync"] }, capped: true, level: "group" },
    { can: { "dev/": ["manage"], "dev/web": [] }, capped: true, level: "principal" },
    { can: { "dev/": ["sync"] }, capped: false, level: "principal" },
    { can: { "dev/": [] }, capped: false, level: "everyone" },
  ];
  expect(explainAccess("dev/web", grants, "member")).toMatchObject({
    pattern: "dev/web",
    over: ["dev/", "*"],
    level: "principal",
    can: [],
    capped: null,
  });
  const can: Permission[] = ["read", "post", "react", "label", "sync"];
  expect(explainAccess("dev/ops", grants, "member")).toMatchObject({
    pattern: "dev/",
    over: ["*"],
    level: "principal",
    can,
    capped: "member",
  });
  expect(resolveRankedCan(grants, "member")["dev/"]).toEqual(can);
});

test("a repository explanation follows live workload access while everyone rules are pending", () => {
  const views: GrantView[] = [
    {
      id: "g4",
      principals: [{ kind: "github", repository: "acme/web", repositoryId: null }],
      can: { "*": ["post"] },
      capped: false,
      by: null,
      at: null,
    },
    {
      id: "g5",
      principals: [{ kind: "everyone" }],
      can: { "dev/": [] },
      capped: false,
      by: null,
      at: null,
    },
  ];
  const repository = { kind: "github", repository: "acme/web", repositoryId: null } as const;
  expect(explainSubject("dev/web", views, repository)).toMatchObject({
    pattern: "*",
    level: "principal",
    can: ["post"],
  });
});

test("everyone alone cannot give a named connection access", () => {
  const views: GrantView[] = [
    {
      id: "g4",
      principals: [{ kind: "all-connections" }],
      can: { "ops/": ["read"] },
      capped: false,
      by: null,
      at: null,
    },
    {
      id: "g5",
      principals: [{ kind: "everyone" }],
      can: { "dev/": ["read"] },
      capped: false,
      by: null,
      at: null,
    },
  ];
  const connection = { kind: "connection", id: "cn_aaaaaaaaaaaaaaaa" } as const;
  expect(explainSubject("dev/web", views, connection, true)).toEqual({
    channel: "dev/web",
    pattern: null,
    over: [],
    level: null,
    grants: [],
    capped: null,
    can: [],
  });
});
