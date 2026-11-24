import { expect, test } from "bun:test";
import { BOARD_URL, call, makeApp, NOW } from "../support/app.ts";

const ISSUER = "https://gitlab.example.com";
const SUBJECT = "project_path:acme/api:main";
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const JWKS = `${ISSUER}/keys`;
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
const keys = await crypto.subtle.generateKey(
  { ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
  true,
  ["sign", "verify"],
);
const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function token(overrides = {}, kid = "first") {
  const signed = `${encode({ alg: "RS256", kid })}.${encode({
    iss: ISSUER,
    sub: SUBJECT,
    project_id: 42,
    aud: BOARD_URL,
    exp: NOW / 1000 + 3600,
    ...overrides,
  })}`;
  const signature = await crypto.subtle.sign(RSA, keys.privateKey, Buffer.from(signed));
  return `${signed}.${Buffer.from(signature).toString("base64url")}`;
}

type App = Pick<ReturnType<typeof makeApp>, "fetch">;
const post = (app: App, jwt: string, profile?: string) =>
  app.fetch(
    new Request(`${BOARD_URL}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
        ...(profile && { "x-board-profile": profile }),
      },
      body: JSON.stringify({ channel: "ci/nightly", text: "pipeline passed" }),
    }),
  );
const named = (issuer: string) => ({
  kind: "oidc",
  issuer,
  claims: { sub: "project_path:acme/api:*", project_id: "42" },
});
const grant = (app: App, ...issuers: string[]) =>
  call(app, "POST", "/grants", { principals: issuers.map(named), can: { "ci/": ["post"] } });
const discovery = (jwks_uri = JWKS) => Response.json({ issuer: ISSUER, jwks_uri });
const jwks = (kid = "first") => Response.json({ keys: [{ ...jwk, kid }] });
const schedule = () => () => {};
const resolveHost = async () => ["8.8.8.8"];

async function refusal(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

test("grant-named OIDC posts as issuer and subject and checks every named claim", async () => {
  const reads: string[] = [];
  const app = makeApp({
    schedule,
    resolveHost,
    fetch: async ({ url, redirect }) => {
      reads.push(url);
      expect(redirect).toBe("error");
      return url === DISCOVERY ? discovery() : jwks();
    },
  });
  try {
    expect((await grant(app, ISSUER)).status).toBe(200);
    await refusal(await post(app, await token({ iss: "https://other.example" })), 401, "unauthorized");
    expect(reads).toEqual([]);
    process.stdout.write("Issuer absent from board grants -> 401 unauthorized, 0 fetches\n");
    const accepted = await post(app, await token());
    expect(accepted.status).toBe(201);
    const id = `oidc:${ISSUER}:${SUBJECT}`;
    expect(await accepted.json()).toMatchObject({ message: { by: { actor: id, principal: id } } });
    process.stdout.write(`Matching issuer, sub and project_id -> 201 ${id}\n`);
    await refusal(await post(app, await token({ sub: "project_path:acme/other:main" })), 403, "forbidden");
    await refusal(await post(app, await token({ project_id: 43 })), 403, "forbidden");
    process.stdout.write("Wrong subject and wrong project_id -> 403 forbidden each\n");
    const profiled = await post(app, await token(), "deploy");
    const other = await post(app, await token({ sub: `${SUBJECT}+deploy` }));
    expect(await profiled.json()).toMatchObject({ message: { by: { actor: `${id}+deploy` } } });
    expect(await other.json()).toMatchObject({ message: { by: { actor: `${id}%2Bdeploy` } } });
    expect(reads).toEqual([DISCOVERY, JWKS]);
  } finally {
    await app.close();
  }
});

test("OIDC rejects unsafe issuer URLs on create and update and caps distinct issuers", async () => {
  const app = makeApp();
  try {
    const created = await grant(app, ISSUER);
    expect(created.status).toBe(200);
    const {
      grant: { id },
    } = (await created.json()) as { grant: { id: string } };
    for (const issuer of [
      "http://issuer.example",
      "https://issuer.example:444",
      "https://a:b@issuer.example",
      "https://issuer.local",
      "https://localhost",
      "https://127.0.0.1",
      "https://[::1]",
    ]) {
      await refusal(await grant(app, issuer), 400, "invalid_grant");
      await refusal(await call(app, "PATCH", `/grants/${id}`, { add: [named(issuer)] }), 400, "invalid_grant");
    }
    const seven = Array.from({ length: 7 }, (_, i) => `https://issuer${i}.example`);
    expect((await grant(app, ...seven)).status).toBe(200);
    expect((await grant(app, ISSUER)).status).toBe(200);
    await refusal(await grant(app, "https://ninth.example"), 400, "invalid_grant");
    await refusal(
      await call(app, "PATCH", `/grants/${id}`, { add: [named("https://ninth.example")] }),
      400,
      "invalid_grant",
    );
  } finally {
    await app.close();
  }
});

test("OIDC rejects nonpublic DNS answers before either fetch", async () => {
  let now = NOW;
  let answers: string[] = [];
  let fetches = 0;
  const app = makeApp({
    schedule,
    now: () => now,
    resolveHost: async () => answers,
    fetch: async () => {
      fetches++;
      answers = ["127.0.0.1"];
      return discovery();
    },
  });
  try {
    expect((await grant(app, ISSUER)).status).toBe(200);
    const jwt = await token();
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "127.0.0.1",
      "169.254.1.2",
      "100.64.1.2",
      "224.0.0.1",
      "240.0.0.1",
      "192.0.2.1",
      "::",
      "::1",
      "fc00::1",
      "fe80::1",
      "ff00::1",
      "2001:db8::1",
      "3ffe::1",
      "::ffff:192.168.0.1",
    ]) {
      answers = ["8.8.8.8", address];
      await refusal(await post(app, jwt), 401, "unauthorized");
      now += 30_000;
    }
    expect(fetches).toBe(0);
    answers = ["2606:4700::1111"];
    await refusal(await post(app, jwt), 401, "unauthorized");
    expect(fetches).toBe(1);
  } finally {
    await app.close();
  }
});

test("OIDC bounds both responses and shares the issuer reload cooldown", async () => {
  let now = NOW;
  let fetches = 0;
  const padding = " ".repeat(65_536);
  const app = makeApp({
    schedule,
    resolveHost,
    now: () => now,
    fetch: async ({ url }) => {
      fetches++;
      if (fetches === 1) {
        now += 4_000;
        return new Response(JSON.stringify({ issuer: ISSUER, jwks_uri: JWKS, padding }));
      }
      return url === DISCOVERY
        ? discovery()
        : new Response(JSON.stringify({ keys: [{ ...jwk, kid: "first" }], padding }));
    },
  });
  try {
    expect((await grant(app, ISSUER)).status).toBe(200);
    const jwt = await token();
    await refusal(await post(app, jwt), 401, "unauthorized");
    await refusal(await post(app, jwt), 401, "unauthorized");
    expect(fetches).toBe(1);
    now = NOW + 30_000;
    await refusal(await post(app, jwt), 401, "unauthorized");
    expect(fetches).toBe(1);
    now += 4_000;
    await refusal(await post(app, jwt), 401, "unauthorized");
    expect(fetches).toBe(3);
  } finally {
    await app.close();
  }
});
