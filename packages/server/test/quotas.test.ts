import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { createInvitation, listBoards, listConnections, listMembers, OutputOf } from "@openboard/contract";
import type { App } from "../src/index.ts";
import { NOW, PUBLIC_URL } from "./support/app.ts";
import { browserSession, makeBrowserApp } from "./support/browser-session.ts";
import { openStore } from "./support/drivers.ts";

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const org = "/api/x/orgs/acme";
const board = "/api/acme/main";

async function setup() {
  const store = openStore(() => NOW);
  const server = makeBrowserApp(undefined, store);
  app = server;
  const owner = await browserSession(server.fetch, "ada");
  const send = (path: string, body?: unknown, headers = owner.headers) =>
    server.fetch(
      new Request(`${PUBLIC_URL}${path}`, {
        headers,
        ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
      }),
    );
  expect((await send("/api/x/orgs", { slug: "acme", name: "Acme" })).status).toBe(201);
  const platform = store.platform();
  const keys = await platform.findBoard("acme", "main");
  if (!keys) throw new Error("organization did not create its main board");
  const invite = async () => {
    const response = await send(`${org}/invitations`, { role: "member" });
    expect(response.status).toBe(201);
    const { url } = (await response.json()) as OutputOf<typeof createInvitation>;
    const token = new URL(url).pathname.split("/").pop();
    if (!token) throw new Error("invitation did not return a token");
    return token;
  };
  return { server, send, invite, platform, orgId: keys.orgId };
}

async function refused(response: Response, reason: string, limit: number) {
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({
    error: { code: "quota_exceeded", reason, hint: expect.stringContaining(String(limit)) },
  });
}

test("the 11th board writes nothing by default, and a board override admits the 11th and 12th", async () => {
  const { send, platform, orgId } = await setup();
  const create = (n: number) => send(`${org}/boards`, { slug: `board-${n}`, name: `Board ${n}` });
  for (let n = 2; n <= 10; n++) expect((await create(n)).status).toBe(201);
  const audit = await (await send(`${org}/audit?limit=200`)).json();
  await refused(await create(11), "boards", 10);
  expect(await platform.findBoard("acme", "board-11")).toBeNull();
  expect(await (await send(`${org}/audit?limit=200`)).json()).toEqual(audit);

  expect(await platform.setOrgQuotas(orgId, { boards: 12 })).toBe(true);
  expect((await create(11)).status).toBe(201);
  expect((await create(12)).status).toBe(201);
  await refused(await create(13), "boards", 12);
  const { boards } = (await (await send(`${org}/boards`)).json()) as OutputOf<typeof listBoards>;
  expect(boards).toHaveLength(12);
});

test("two board creations competing for the last slot have one winner", async () => {
  const { send, platform, orgId } = await setup();
  expect(await platform.setOrgQuotas(orgId, { boards: 2 })).toBe(true);
  const create = (slug: string) => send(`${org}/boards`, { slug, name: slug });
  const [one, two] = await Promise.all([create("one"), create("two")]);
  const [created, rejected] = one.status === 201 ? [one, two] : [two, one];
  expect(created.status).toBe(201);
  await refused(rejected, "boards", 2);
  const { boards } = (await (await send(`${org}/boards`)).json()) as OutputOf<typeof listBoards>;
  expect(boards).toHaveLength(2);
});

test("accepting an invitation for the 51st member writes nothing and leaves the link usable", async () => {
  const { server, send, invite, platform, orgId } = await setup();
  for (let n = 2; n <= 50; n++) {
    const id = `fixture-${n}`;
    await platform.signIn({
      identity: { provider: "github", subject: id, login: id, name: id, email: null, avatar: null },
      admitNew: true,
      newPersonId: id,
      session: { idHash: createHash("sha256").update(id).digest("hex"), csrf: id, expiresAt: NOW + 60_000 },
      now: NOW,
    });
    const hash = createHash("sha256")
      .update(await invite())
      .digest();
    expect(await platform.acceptInvitation(hash, id, NOW)).toMatchObject({ role: "member" });
  }
  const candidate = await browserSession(server.fetch, "lin");
  const token = await invite();
  const accept = () => send("/api/x/invitations/accept", { token }, candidate.headers);
  const members = (await (await send(`${org}/members`)).json()) as OutputOf<typeof listMembers>;
  const audit = await (await send(`${org}/audit?limit=200`)).json();
  expect(members.members).toHaveLength(50);
  await refused(await accept(), "members", 50);
  expect(await (await send(`${org}/members`)).json()).toEqual(members);
  expect(await (await send(`${org}/audit?limit=200`)).json()).toEqual(audit);
  expect(await (await send(`/api/x/invitations/${token}`)).json()).toMatchObject({ role: "member" });
  expect(await platform.setOrgQuotas(orgId, { members: 51 })).toBe(true);
  expect((await accept()).status).toBe(200);
});

test("the 101st connection leaves the board's connections, grants, and audit unchanged", async () => {
  const { send } = await setup();
  const connections = `${board}/x/connections`;
  const create = (n: number) => send(connections, { name: `connection-${n}`, can: { "*": "all" } });
  for (let n = 1; n <= 100; n++) expect((await create(n)).status).toBe(201);
  const paths = [connections, `${board}/grants`, `${board}/x/audit?limit=200`];
  const snapshot = () =>
    Promise.all(
      paths.map(async (path) => {
        const response = await send(path);
        expect(response.status).toBe(200);
        return response.json();
      }),
    );
  const before = await snapshot();
  expect((before[0] as OutputOf<typeof listConnections>).connections).toHaveLength(100);
  await refused(await create(101), "connections", 100);
  expect(await snapshot()).toEqual(before);
});
