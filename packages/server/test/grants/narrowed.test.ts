import { expect, test } from "bun:test";
import type { CanInput, createConnection, GrantView, OutputOf } from "@openboard/contract";
import { signIn } from "../isolation/seed.ts";
import { BOARD_URL, call, makeApp, NOW, OWNER, PUBLIC_URL } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

type App = ReturnType<typeof makeApp>;

const principals = [{ kind: "github", repository: "acme/repo" }];

async function directConnection(app: App) {
  const response = await call(app, "POST", "/x/connections", { name: "manager", can: { "*": "all" }, direct: true });
  expect(response.status).toBe(201);
  return (await response.json()) as OutputOf<typeof createConnection>;
}

function narrowed(app: App, secret: string, scope: string) {
  return (method: string, path: string, body?: unknown) =>
    app.fetch(
      new Request(`${BOARD_URL}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
          "x-board-can": scope,
        },
        body: JSON.stringify(body),
      }),
    );
}

async function forbidden(response: Response) {
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
}

async function made(response: Response) {
  expect(response.status).toBe(200);
  return ((await response.json()) as { grant: GrantView }).grant;
}

test("a connection capped out of ops/secret/ gets 403 forbidden on ops/ before and after an everyone closure, and 200 on ops/ci/", async () => {
  const app = makeApp();
  try {
    const send = narrowed(app, (await directConnection(app)).secret, "*=all;ops/secret/=");
    const outer = { principals, can: { "ops/": ["read"] } };
    const existing = await made(await call(app, "POST", "/grants", outer));
    const path = `/grants/${existing.id}`;
    await forbidden(await send("POST", "/grants", outer));
    await made(await call(app, "POST", "/grants", { principals: [{ kind: "everyone" }], can: { "ops/secret/": [] } }));
    await forbidden(await send("POST", "/grants", outer));
    await forbidden(await send("POST", "/grants/batch", { grants: [outer] }));
    await forbidden(await send("PATCH", path, { can: { "ops/ci/": ["read"] } }));
    await forbidden(await send("POST", `${path}/revoke`));
    const can: CanInput = { "ops/ci/": ["post"] };
    expect((await made(await send("POST", "/grants", { principals, can }))).can).toEqual(can);
  } finally {
    await app.close();
  }
});

test.each(["connection", "local owner"])(
  "%s with read,post gets 403 forbidden on grant writes, list and explain-other, and grants: [] on explain-self",
  async (kind) => {
    const app = makeApp();
    try {
      const secret = kind === "connection" ? (await directConnection(app)).secret : OWNER.token;
      const draft = { principals, can: { "work/": ["read"] } };
      const probe = await made(await call(app, "POST", "/grants", draft));
      const path = `/grants/${probe.id}`;
      const explain = "/grants/explain?channel=work/inner";
      const send = narrowed(app, secret, "*=read,post");
      await forbidden(await send("POST", "/grants", draft));
      await forbidden(await send("PATCH", path, { can: draft.can }));
      await forbidden(await send("POST", `${path}/revoke`));
      await forbidden(await send("GET", "/grants"));
      await forbidden(await send("GET", `${explain}&github=acme/repo`));
      const self = await send("GET", explain);
      expect(self.status).toBe(200);
      expect(await self.json()).toMatchObject({ grants: [], can: ["read", "post"] });
    } finally {
      await app.close();
    }
  },
);

test("manage under work/inner/ allows create, update and revoke there and gets 403 forbidden on work/ and list", async () => {
  const app = makeApp();
  try {
    const send = narrowed(app, (await directConnection(app)).secret, "*=read,post;work/inner/=all");
    const can = { "work/inner/": ["read"] };
    const grant = await made(await send("POST", "/grants", { principals, can }));
    const path = `/grants/${grant.id}`;
    const outer = { "work/": ["read"] };
    await forbidden(await send("POST", "/grants", { principals, can: outer }));
    await forbidden(await send("PATCH", path, { can: outer }));
    await forbidden(await send("GET", "/grants"));
    await made(await send("PATCH", path, { can: { "work/inner/": ["post"] } }));
    expect(await (await send("POST", `${path}/revoke`)).json()).toEqual({ revoked: true });
  } finally {
    await app.close();
  }
});

test("a narrowed grant denial keeps underlying private pattern names out of the error", async () => {
  const app = makeApp();
  try {
    const { secret, connection } = await directConnection(app);
    await made(await call(app, "PATCH", `/grants/${connection.grant}`, { can: { "*": "all", "ops/private/": [] } }));
    const send = narrowed(app, secret, "*=read,post");
    const response = await send("POST", "/grants", { principals, can: { "ops/": ["read"] } });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "forbidden", message: "changing this grant needs manage wherever it reaches" },
    });
  } finally {
    await app.close();
  }
});

test("an organization owner can manage grants within the header after revoking the default owner grant", async () => {
  const store = openStore(() => NOW);
  const app = makeApp({ store, mode: "hosted", signup: "open", secretKey: new Uint8Array(32) });
  try {
    const { headers } = await signIn(store, "owner", "a");
    const send = (method: string, path: string, scope?: string, body?: unknown) =>
      app.fetch(
        new Request(PUBLIC_URL + path, {
          method,
          headers: { ...headers, "content-type": "application/json", ...(scope && { "x-board-can": scope }) },
          body: JSON.stringify(body),
        }),
      );
    expect((await send("POST", "/api/x/orgs", undefined, { slug: "work", name: "Work" })).status).toBe(201);
    const path = "/api/work/main/grants";
    expect(await (await send("POST", `${path}/g1/revoke`)).json()).toEqual({ revoked: true });
    expect((await send("GET", path, "*=all")).status).toBe(200);
    await forbidden(await send("GET", path, "*=read,post"));
    const can = { "work/inner/": ["read"] };
    const scoped = "work/inner/=all";
    const grant = await made(await send("POST", path, scoped, { principals, can }));
    await forbidden(await send("POST", path, scoped, { principals, can: { "work/": ["read"] } }));
    expect(await (await send("POST", `${path}/${grant.id}/revoke`, scoped)).json()).toEqual({ revoked: true });
  } finally {
    await app.close();
  }
});
