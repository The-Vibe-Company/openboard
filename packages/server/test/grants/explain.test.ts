import { expect, test } from "bun:test";
import type { GrantPrincipalInput } from "@openboard/contract";
import { seed, signIn } from "../isolation/seed.ts";

test("explain and live access agree on pattern, closest principal, ties and the role cap", async () => {
  const { app, store, a, send } = await seed();
  try {
    const base = "/api/alpha/main";
    const me = await send("GET", `${base}/me`, a.session);
    const { principal } = (await me.json()) as { principal: string };
    const owner = principal.slice("ob:user:".length);
    const member = await signIn(store, "reader", "f");
    const invitation = await send("POST", "/api/x/orgs/alpha/invitations", a.session, { role: "member" });
    const { url } = (await invitation.json()) as { url: string };
    const accept = await send("POST", "/api/x/invitations/accept", member.headers, {
      token: new URL(url).pathname.split("/").at(-1),
    });
    expect(accept.status).toBe(200);

    const person = (userId: string): GrantPrincipalInput => ({ kind: "user", userId });
    const add = async (principals: GrantPrincipalInput[], can: Record<string, string[]>) => {
      const response = await send("POST", `${base}/grants`, a.session, { principals, can });
      expect(response.status).toBe(200);
      const { grant } = (await response.json()) as { grant: { id: string } };
      return grant.id;
    };
    const channel = "dev/web";
    const path = `${base}/grants/explain?channel=${channel}`;
    const forMember = `${path}&user=${member.personId}`;
    const capped = await send("GET", forMember, a.connection);
    expect(await capped.json()).toMatchObject({
      pattern: "*",
      level: "group",
      capped: "member",
      can: ["read", "post", "react", "label"],
    });
    expect((await send("GET", `${path}&user=${owner}`, member.headers)).status).toBe(403);

    await add([person(member.personId)], { "*": ["post"] });
    await add([{ kind: "all-users" }], { "dev/": ["read", "react"] });
    const group = await send("GET", path, member.headers);
    expect(await group.json()).toEqual({
      channel,
      pattern: "dev/",
      over: ["*"],
      level: "group",
      grants: [],
      capped: null,
      can: ["read", "react"],
    });
    expect((await send("POST", `${base}/messages`, member.headers, { channel, text: "blocked" })).status).toBe(403);

    const read = await add([person(member.personId)], { "dev/": ["read"] });
    const post = await add([person(member.personId)], { "dev/": ["post"] });
    const explained = await send("GET", forMember, a.connection);
    expect(await explained.json()).toMatchObject({
      channel,
      pattern: "dev/",
      over: ["*"],
      level: "principal",
      grants: [{ id: read }, { id: post }],
      can: ["read", "post"],
    });
    expect((await send("POST", `${base}/messages`, member.headers, { channel, text: "allowed" })).status).toBe(201);
    expect((await send("GET", `${path}&user=${owner}`, a.agent)).status).toBe(403);
    expect(await (await send("GET", path, a.agent)).json()).toMatchObject({
      pattern: "*",
      grants: [],
      can: ["read", "post", "react", "label", "sync", "manage"],
    });
  } finally {
    await app.close();
    await store.close();
  }
});

test("a hypothetical project sees the more specific denial", async () => {
  const { app, store, a, send } = await seed();
  try {
    const base = "/api/alpha/main";
    const project = { kind: "project", project: "prj_demo", environments: ["production"] };
    for (const [principal, can] of [
      [project, { "*": ["read"] }],
      [{ kind: "everyone" }, { "dev/": [] }],
    ])
      expect((await send("POST", `${base}/grants`, a.session, { principals: [principal], can })).status).toBe(200);
    const path = `${base}/grants/explain?channel=dev/web&project=prj_demo&environment=production`;
    expect(await (await send("GET", path, a.session)).json()).toMatchObject({
      pattern: "dev/",
      over: ["*"],
      level: "everyone",
      can: [],
    });
  } finally {
    await app.close();
    await store.close();
  }
});
