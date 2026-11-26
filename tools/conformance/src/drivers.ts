import process from "node:process";
import { createTestDatabases, postgresDriver } from "@openboard/driver-postgres";
import { postgresPurgeFixture } from "@openboard/driver-postgres/catalog";
import { sqlitePurgeFixture } from "@openboard/driver-sqlite/catalog";
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

type Backend = { owner: ReturnType<typeof mintLocalOwnerToken> } | { databaseUrl: string };

async function openConformanceStore(backend: Backend, now: () => number) {
  if ("databaseUrl" in backend) {
    const url = backend.databaseUrl;
    const store = await postgresDriver({ url }, now);
    return { store, tenantRows: postgresPurgeFixture(async () => url).tenantRows };
  }
  const store = sqlitePurgeFixture(now);
  return { store, tenantRows: store.tenantRows };
}

async function bootApp(publicUrl: string, backend: Backend) {
  const now = () => Date.now();
  const log = {
    /** Request lines stay quiet here: the bench measures requests and conformance prints its own report. */
    info: () => {},
    error: (message: string, fields: object) => process.stderr.write(`${JSON.stringify({ message, ...fields })}\n`),
  };
  const hosted = "databaseUrl" in backend;
  const { store, tenantRows } = await openConformanceStore(backend, now);
  const app = createApp(
    {
      mode: hosted ? "hosted" : "local",
      publicUrl,
      // The kit recognizes a board-local owner by its principal namespace.
      localOwner: "board:local-tools",
      ...(hosted
        ? { signup: "open", signIn: { github: { clientId: "example-client", clientSecret: "example-client-secret" } } }
        : { localOwnerTokenHash: backend.owner.hash }),
    },
    // The fixture still needs the store for offline replay after draining the app.
    { store: { ...store, close: async () => {} }, blobs: store.blobs, jobs: store.jobs },
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
  return { app, store, platform: store.platform(), tenantRows };
}

const foldTables = new Set([
  "actors",
  "attachments",
  "channels",
  "connection_agents",
  "connections",
  "grant_principals",
  "grants",
  "inbound_endpoints",
  "messages",
  "schedules",
  "schemas",
  "task_batches",
  "task_needs",
  "tasks",
  "terms",
  "watcher_registrations",
  "webhooks",
]);

function bytes(rows: readonly unknown[]) {
  return rows
    .map((row) => JSON.stringify(row, (_, value: unknown) => (typeof value === "bigint" ? String(value) : value)))
    .sort()
    .join("\n");
}

async function verifyReprojection(first: Awaited<ReturnType<typeof bootApp>>, org: string) {
  const keys = await first.platform.findBoard(org, "main");
  if (!keys) throw new Error("Reprojection fixture has no conformance board");
  const before = (await first.tenantRows(keys)).rows;
  const replayed = await first.platform.reprojectBoard(keys);
  const after = (await first.tenantRows(keys)).rows;
  for (const table of foldTables) {
    if (!before[table] || !after[table] || bytes(before[table]) !== bytes(after[table]))
      throw new Error(`Conformance replay changed fold table ${table}`);
  }
  if (!replayed?.events) throw new Error("No conformance events were replayed");
  console.log(`Reprojection: ${replayed.events} events; ${foldTables.size} fold tables match byte for byte`);
}

function allowLongPoll(request: Request, server: Bun.Server<undefined>, path: string) {
  if (
    (request.method === "GET" && /\/events\/*$/.test(path)) ||
    (request.method === "POST" && /\/tasks\/claim\/*$/.test(path))
  )
    server.timeout(request, 0);
}

function alternatingProxy(hostname: string, first: Bun.Server<undefined>, second: Bun.Server<undefined>) {
  let next = first;
  return Bun.serve({
    hostname,
    port: 0,
    fetch(request, proxyServer) {
      const incoming = new URL(request.url);
      allowLongPoll(request, proxyServer, incoming.pathname);
      const target = new URL(next.url);
      target.pathname = incoming.pathname;
      target.search = incoming.search;
      next = next === first ? second : first;
      return fetch(new Request(target.href, request), { redirect: "manual" });
    },
  });
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
      await Promise.all(
        apps.map(async ({ app, store }) => {
          try {
            await app.close();
          } finally {
            await store.close();
          }
        }),
      );
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
        allowLongPoll(request, server, new URL(request.url).pathname);
        return apps[at]?.app.fetch(request) ?? new Response(null, { status: 503 });
      };
      servers.push(Bun.serve({ hostname, port: 0, fetch }));
    }

    const [first, second] = servers;
    if (!first) throw new Error("Conformance requires at least one server");
    if (second) proxy = alternatingProxy(hostname, first, second);
    const origin = (proxy ?? first).url.origin;
    const backend = database
      ? { databaseUrl: database.url }
      : { owner: mintLocalOwnerToken(crypto.getRandomValues(new Uint8Array(42))) };
    for (let at = 0; at < instances; at++) apps.push(await bootApp(origin, backend));

    const path = database ? "/api/conformance-ci/main" : "/api/local/main";
    return {
      url: new URL(path, origin),
      ownerToken: backend.owner?.token,
      async verifyReprojection() {
        await Promise.all(apps.map(({ app }) => app.drain()));
        const primary = apps[0];
        if (!primary) throw new Error("Reprojection fixture has no conformance instance");
        await verifyReprojection(primary, database ? "conformance-ci" : "local");
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
