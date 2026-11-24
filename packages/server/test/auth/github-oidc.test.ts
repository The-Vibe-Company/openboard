import { expect, test } from "bun:test";
import { BOARD_URL, call, makeApp, NOW } from "../support/app.ts";

const ISSUER = "https://token.actions.githubusercontent.com";
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const JWKS = `${ISSUER}/.well-known/jwks`;
const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
const keys = await crypto.subtle.generateKey(
  { ...algorithm, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
  true,
  ["sign", "verify"],
);
const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
const resolveHost = async () => ["8.8.8.8"];
const schedule = () => () => {};
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function token(overrides: Record<string, unknown> = {}, kid = "first") {
  const header = encode({ alg: "RS256", kid });
  const claims = encode({
    iss: ISSUER,
    aud: BOARD_URL,
    exp: NOW / 1000 + 60,
    repository: "acme/web",
    repository_id: "123456",
    workflow_ref: "acme/web/.github/workflows/ci.yml@refs/heads/main",
    ref: "refs/heads/main",
    event_name: "push",
    ...overrides,
  });
  const content = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(algorithm, keys.privateKey, Buffer.from(content));
  return `${content}.${Buffer.from(signature).toString("base64url")}`;
}

type App = ReturnType<typeof makeApp>;
type Http = Pick<App, "fetch">;

function firstInstance(app: App): Http {
  const [instance] = app.instances;
  if (!instance) throw new Error("missing test app");
  return instance;
}

function request(credential: string, path: string, method = "GET", body?: object) {
  return new Request(`${BOARD_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
}

function post(app: Http, credential: string, channel = "ci/nightly") {
  return app.fetch(request(credential, "/messages", "POST", { channel, text: "nightly passed" }));
}

function issuerResponse(url: string, kid = "first") {
  if (url === DISCOVERY) return Response.json({ issuer: ISSUER, jwks_uri: JWKS });
  if (url === JWKS) return Response.json({ keys: [{ ...jwk, kid }] });
  throw new Error("unexpected outbound request");
}

async function grant(app: Http, repository: string, can: string[], filters = {}) {
  const response = await call(app, "POST", "/grants", {
    principals: [{ kind: "github", repository, ...filters }],
    can: { "ci/": can },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { grant: { id: string } }).grant.id;
}

async function expectError(label: string, response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const { error } = (await response.json()) as { error: { code: string } };
  expect(error.code).toBe(code);
  process.stdout.write(`${label} -> ${response.status} ${error.code}\n`);
}

async function checkIdentity(instance: Http, valid: string) {
  const me = await instance.fetch(request(valid, "/me"));
  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({
    principal: "github:repo:123456",
    kind: "workflow",
    expiresAt: NOW + 60_000,
    can: { "ci/": ["post"] },
    openboard: {
      org: { slug: "local", name: "Local" },
      board: { slug: "main", name: "main" },
      role: null,
      credential: "oidc",
    },
  });
}

async function checkRejectedTokens(instance: Http, valid: string) {
  await expectError("outside granted channels", await post(instance, valid, "ops/nightly"), 403, "forbidden");
  const nonmatching = {
    "another repository": {
      repository: "acme/other",
      workflow_ref: "acme/other/.github/workflows/ci.yml@refs/heads/main",
    },
    "another branch": {
      ref: "refs/heads/dev",
      workflow_ref: "acme/web/.github/workflows/ci.yml@refs/heads/dev",
    },
    "another workflow": { workflow_ref: "acme/web/.github/workflows/deploy.yml@refs/heads/main" },
    "workflow ref mismatch": { workflow_ref: "acme/web/.github/workflows/ci.yml@refs/heads/dev" },
    "pull request": {
      ref: "refs/pull/7/merge",
      workflow_ref: "acme/web/.github/workflows/ci.yml@refs/pull/7/merge",
      event_name: "pull_request",
    },
  };
  for (const [label, claims] of Object.entries(nonmatching)) {
    await expectError(label, await post(instance, await token(claims)), 403, "forbidden");
  }
  const ungranted = await token(nonmatching["another repository"]);
  await expectError("ungranted schema read", await instance.fetch(request(ungranted, "/schemas")), 403, "forbidden");
  const otherBoard = BOARD_URL.replace("/local/main", "/acme/main");
  await expectError("another audience", await post(instance, await token({ aud: otherBoard })), 401, "unauthorized");
  await expectError("expired", await post(instance, await token({ exp: NOW / 1000 })), 401, "unauthorized");
  const [header, payload, signature = ""] = valid.split(".");
  const tampered = `${header}.${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
  await expectError("bad signature", await post(instance, tampered), 401, "unauthorized");
}

test("OIDC posts as the repository only within a matching board grant", async () => {
  const reads: string[] = [];
  let kid = "first";
  let now = NOW;
  const app = makeApp({
    resolveHost,
    now: () => now,
    schedule,
    fetch: async (request) => {
      reads.push(request.url);
      expect(request.redirect).toBe("error");
      return issuerResponse(request.url, kid);
    },
  });
  try {
    await grant(app, "acme/web", ["post"], { workflow: "ci.yml", branch: "main" });
    const valid = await token();
    const instance = firstInstance(app);
    const accepted = await post(instance, valid);
    expect(accepted.status).toBe(201);
    const body = (await accepted.json()) as { message: { by: { actor: string } } };
    expect(body).toMatchObject({
      message: {
        by: { actor: "github:repo:123456", principal: "github:repo:123456", profile: null },
        author: { kind: "workflow", handle: "acme/web" },
      },
    });
    process.stdout.write(
      `acme/web ci.yml refs/heads/main posts to ci/nightly -> ${accepted.status} ${body.message.by.actor}\n`,
    );
    await checkIdentity(instance, valid);
    await checkRejectedTokens(instance, valid);
    expect(
      (
        await call(instance, "POST", "/grants", {
          principals: [{ kind: "oidc", issuer: ISSUER, claims: { sub: "another" } }],
          can: { "ci/": ["post"] },
        })
      ).status,
    ).toBe(200);
    expect((await post(instance, await token({ repository: "acme/other", sub: "another" }))).status).toBe(201);
    expect(reads).toEqual([DISCOVERY, JWKS]);
    await expectError("unknown key", await post(instance, await token({}, "unknown")), 401, "unauthorized");
    kid = "rotated";
    await expectError("reload cooldown", await post(instance, await token({}, kid)), 401, "unauthorized");
    now += 30_000;
    expect((await post(instance, await token({}, kid))).status).toBe(201);
    expect(reads).toEqual([DISCOVERY, JWKS, DISCOVERY, JWKS]);
    process.stdout.write("known key cached; rotated key after reload cooldown -> 201\n");
    if (app.instances[1]) expect((await post(app.instances[1], await token({}, kid))).status).toBe(201);
  } finally {
    await app.close();
  }
});

test("OIDC rejects redirects and JWKS URLs outside the trusted HTTPS origin", async () => {
  const reads: string[] = [];
  let now = NOW;
  let discovery = Response.redirect("https://127.0.0.1/keys");
  const app = makeApp({
    resolveHost,
    schedule,
    now: () => now,
    fetch: async (request) => {
      reads.push(request.url);
      expect(request.redirect).toBe("error");
      return discovery;
    },
  });
  try {
    const credential = await token({ exp: NOW / 1000 + 300 });
    const instance = firstInstance(app);
    await expectError("redirected discovery", await post(instance, credential), 401, "unauthorized");
    for (const [label, jwks_uri] of [
      ["HTTP JWKS", JWKS.replace("https:", "http:")],
      ["private JWKS", "https://127.0.0.1/keys"],
      ["other-host JWKS", "https://example.com/keys"],
    ] as const) {
      now += 30_000;
      discovery = Response.json({ issuer: ISSUER, jwks_uri });
      await expectError(label, await post(instance, credential), 401, "unauthorized");
    }
    expect(reads).toEqual([DISCOVERY, DISCOVERY, DISCOVERY, DISCOVERY]);
    process.stdout.write("Egress -> HTTPS issuer discovery only, redirect mode error\n");
  } finally {
    await app.close();
  }
});

test("OIDC grant mutations check current workload authority under the write lock", async () => {
  const app = makeApp({
    resolveHost,
    schedule,
    fetch: async ({ url }) => issuerResponse(url),
  });
  const started = Promise.withResolvers<void>();
  const body = Promise.withResolvers<string>();
  let pending: Promise<Response> | undefined;
  try {
    const managerId = await grant(app, "acme/web", ["manage"]);
    const targetId = await grant(app, "acme/other", ["post"]);
    const inFlight = request(await token(), `/grants/${targetId}`, "PATCH");
    Object.defineProperty(inFlight, "text", {
      value: () => {
        started.resolve();
        return body.promise;
      },
    });
    pending = app.fetch(inFlight);
    expect(await Promise.race([started.promise.then(() => true), pending.then(() => false)])).toBe(true);
    expect(await (await call(app, "POST", `/grants/${managerId}/revoke`)).json()).toEqual({ revoked: true });
    body.resolve(JSON.stringify({ add: [{ kind: "github", repository: "acme/web" }], can: { "ci/": ["manage"] } }));
    await expectError("workload management revoked before write lock", await pending, 403, "forbidden");
  } finally {
    body.resolve("");
    await pending;
    await app.close();
  }
});

test("OIDC times out a stalled discovery body and reopens key refresh", async () => {
  const armed = Promise.withResolvers<() => void>();
  const reading = Promise.withResolvers<void>();
  const stalled = Promise.withResolvers<void>();
  let firstFetch = true;
  let now = NOW;
  let cancelled = 0;
  const app = makeApp({
    resolveHost,
    now: () => now,
    schedule: (ms, expire) => {
      expect(ms).toBe(5000);
      armed.resolve(expire);
      return () => void cancelled++;
    },
    fetch: async (request) => {
      if (firstFetch) {
        firstFetch = false;
        return new Response(
          new ReadableStream({
            pull: () => {
              reading.resolve();
              return stalled.promise;
            },
          }),
        );
      }
      return issuerResponse(request.url);
    },
  });
  try {
    const credential = await token();
    const instance = firstInstance(app);
    const request = post(instance, credential);
    await reading.promise;
    (await armed.promise)();
    await expectError("stalled discovery deadline", await request, 401, "unauthorized");
    now += 30_000;
    await expectError("key refresh recovers", await post(instance, credential), 403, "forbidden");
    expect(cancelled).toBe(3);
  } finally {
    stalled.resolve();
    await app.close();
  }
});
