import process from "node:process";
import { createTestDatabases, postgresDriver } from "@openboard/driver-postgres";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, mintLocalOwnerToken } from "@openboard/server";

/** Fake only the provider's HTTP responses. The app still verifies OAuth state and issues a real session. */
async function fakeGitHub(request: Request): Promise<Response> {
  const { origin, pathname } = new URL(request.url);
  if (origin === "https://github.com" && pathname === "/login/oauth/access_token") {
    return Response.json({ access_token: "example-access" });
  }
  if (origin === "https://api.github.com" && request.headers.get("authorization") === "Bearer example-access") {
    if (pathname === "/user") return Response.json({ id: 1, login: "conformance", name: "Conformance" });
    if (pathname === "/user/emails") {
      return Response.json([{ email: "conformance@example.test", primary: true, verified: true }]);
    }
  }
  return new Response(null, { status: 404 });
}

async function bootApp(
  publicUrl: string,
  backend: { owner: ReturnType<typeof mintLocalOwnerToken> } | { databaseUrl: string },
) {
  const now = () => Date.now();
  const log = {
    /** Request lines stay quiet here: the bench measures requests and conformance prints its own report. */
    info: () => {},
    error: (message: string, fields: object) => process.stderr.write(`${JSON.stringify({ message, ...fields })}\n`),
  };
  const hosted = "databaseUrl" in backend;
  const store = hosted ? await postgresDriver({ url: backend.databaseUrl }, now) : sqliteDriver({ memory: true }, now);
  return createApp(
    {
      mode: hosted ? "hosted" : "local",
      publicUrl,
      localOwner: "ob:user:local-tools",
      ...(hosted
        ? { signup: "open", signIn: { github: { clientId: "example-client", clientSecret: "example-client-secret" } } }
        : { localOwnerTokenHash: backend.owner.hash }),
    },
    { store },
    {
      now,
      ...(hosted && { fetch: fakeGitHub }),
      log,
      requestId: () => crypto.randomUUID(),
      schedule: (delayMs, run) => {
        const timer = setTimeout(run, delayMs);
        return () => clearTimeout(timer);
      },
      randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    },
  );
}

export async function boot(driver: "sqlite" | "postgres", instances: number) {
  const apps: Awaited<ReturnType<typeof bootApp>>[] = [];
  const servers: Bun.Server<undefined>[] = [];
  const hostname = "127.0.0.1";
  let proxy: Bun.Server<undefined> | undefined;

  let databases: Awaited<ReturnType<typeof createTestDatabases>> | undefined;
  let database: Awaited<ReturnType<NonNullable<typeof databases>["create"]>> | undefined;

  async function close() {
    try {
      await proxy?.stop(true);
      await Promise.all(servers.map((server) => server.stop(true)));
      await Promise.all(apps.map((app) => app.close()));
    } finally {
      try {
        await database?.drop();
      } finally {
        await databases?.close();
      }
    }
  }

  try {
    if (driver === "postgres") {
      const url = process.env.OPENBOARD_TEST_DATABASE_URL;
      if (!url) throw new Error("Postgres conformance requires OPENBOARD_TEST_DATABASE_URL");
      databases = await createTestDatabases(url);
      database = await databases.create();
    }
    // Ports first: each app is told the public URL the kit will use, which exists only once something listens.
    for (let at = 0; at < instances; at++) {
      const fetch = (request: Request, server: Bun.Server<undefined>) => {
        if (request.method === "GET" && /\/events\/*$/.test(new URL(request.url).pathname)) server.timeout(request, 0);
        return apps[at]?.fetch(request) ?? new Response(null, { status: 503 });
      };
      servers.push(Bun.serve({ hostname, port: 0, fetch }));
    }

    const [first, second] = servers;
    if (!first) throw new Error("Conformance requires at least one server");
    if (second) {
      let next = first;
      proxy = Bun.serve({
        hostname,
        port: 0,
        fetch(request, proxyServer) {
          const incoming = new URL(request.url);
          if (request.method === "GET" && /\/events\/*$/.test(incoming.pathname)) proxyServer.timeout(request, 0);
          const target = new URL(next.url);
          target.pathname = incoming.pathname;
          target.search = incoming.search;
          next = next === first ? second : first;
          return fetch(new Request(target.href, request), { redirect: "manual" });
        },
      });
    }
    const origin = (proxy ?? first).url.origin;
    const backend = database
      ? { databaseUrl: database.url }
      : { owner: mintLocalOwnerToken(crypto.getRandomValues(new Uint8Array(42))) };
    for (let at = 0; at < instances; at++) apps.push(await bootApp(origin, backend));

    const path = database ? "/api/conformance-ci/main" : "/api/local/main";
    return { url: new URL(path, origin), ownerToken: backend.owner?.token, close };
  } catch (error) {
    await close();
    throw error;
  }
}
