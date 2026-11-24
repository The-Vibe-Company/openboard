import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabases, postgresDriver } from "@openboard/driver-postgres";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { type App, createApp, type ServerConfig } from "@openboard/server";
import { test } from "@playwright/test";
import { hostedDatabaseUrl } from "../../playwright.config.ts";

async function fakeProvider(request: Request): Promise<Response> {
  const { origin, pathname } = new URL(request.url);
  if (origin === "https://github.com" && pathname === "/login/oauth/access_token") {
    return Response.json({ access_token: new URLSearchParams(await request.text()).get("code") });
  }
  const login = request.headers.get("authorization")?.slice("Bearer ".length);
  if (origin !== "https://api.github.com" || !login || !/^[a-z][a-z0-9-]{0,38}$/.test(login)) {
    return new Response(null, { status: 404 });
  }
  if (pathname === "/user") {
    const id = Number.parseInt(new Bun.CryptoHasher("sha256").update(login).digest("hex").slice(0, 12), 16) + 1;
    return Response.json({
      id,
      login,
      name: login,
      avatar_url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    });
  }
  if (pathname === "/user/emails") {
    return Response.json([{ email: `${login}@example.com`, primary: true, verified: true }]);
  }
  return new Response(null, { status: 404 });
}

export async function temporaryDataDir() {
  if (test.info().project.name === "hosted") {
    const url = hostedDatabaseUrl();
    if (!url) throw new Error("Hosted Playwright requires OPENBOARD_TEST_DATABASE_URL");
    const databases = await createTestDatabases(url);
    try {
      const database = await databases.create();
      return {
        path: database.url,
        async remove() {
          try {
            await database.drop();
          } finally {
            await databases.close();
          }
        },
      };
    } catch (error) {
      await databases.close();
      throw error;
    }
  }
  const path = await mkdtemp(join(tmpdir(), "openboard-browser-"));
  return { path, remove: () => rm(path, { recursive: true, force: true }) };
}

interface ServeOptions {
  receiveWebhook?: (request: Request) => Promise<Response>;
  signup?: NonNullable<ServerConfig["signup"]>;
  dataDir?: string;
  port?: number;
  withProvider?: boolean;
  now?: () => number;
  onResponse?: (request: Request, response: Response) => Response | Promise<Response>;
}

async function bootApp(url: string, path: string, mode: ServerConfig["mode"], options: ServeOptions) {
  const { signup = "open", withProvider = true, now = Date.now, receiveWebhook } = options;
  const store = mode === "hosted" ? await postgresDriver({ url: path }, now) : sqliteDriver({ dir: path }, now);
  try {
    return createApp(
      {
        mode,
        publicUrl: url,
        localOwner: "ob:user:local-browser-test",
        signup,
        ...(receiveWebhook && { secretKey: crypto.getRandomValues(new Uint8Array(32)) }),
        webDir: join(import.meta.dir, "../../dist"),
        ...(withProvider && {
          signIn: { github: { clientId: "example-client", clientSecret: "example-client-secret" } },
        }),
      },
      { store, blobs: store.blobs, jobs: store.jobs },
      {
        now,
        requestId: () => crypto.randomUUID(),
        schedule(delay, run) {
          const timer = setTimeout(run, delay);
          return () => clearTimeout(timer);
        },
        log: { info() {}, error() {} },
        randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
        fetch: fakeProvider,
        ...(receiveWebhook && { webhookFetch: fetch }),
      },
    );
  } catch (error) {
    await store.close();
    throw error;
  }
}

export async function serve(options: ServeOptions = {}) {
  const { dataDir, port = 0, onResponse, receiveWebhook } = options;
  const mode = test.info().project.name === "hosted" ? "hosted" : "local";
  const instances = mode === "hosted" ? 2 : 1;
  const storage = dataDir === undefined ? await temporaryDataDir() : { path: dataDir, remove: async () => {} };
  const apps: App[] = [];
  let next = 0;
  let server: Bun.Server<undefined> | undefined;
  let receiver: Bun.Server<undefined> | undefined;

  async function stop() {
    try {
      await Promise.all([server?.stop(true), receiver?.stop(true)]);
      const results = await Promise.allSettled(apps.map((app) => app.close()));
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
      }
    } finally {
      await storage.remove();
    }
  }

  try {
    server = Bun.serve({
      hostname: "localhost",
      port,
      async fetch(request, listener) {
        const instance = next;
        next = (next + 1) % instances;
        const pathname = new URL(request.url).pathname;
        if (request.method === "GET" && pathname.endsWith("/events")) listener.timeout(request, 0);
        const app = apps[instance];
        const response = app ? await app.fetch(request) : new Response(null, { status: 503 });
        if (
          mode === "hosted" &&
          response.ok &&
          (pathname === "/healthz" || pathname.endsWith("/events") || pathname.endsWith("/messages"))
        ) {
          response.headers.set("x-openboard-test-instance", String(instance));
        }
        return onResponse ? onResponse(request, response) : response;
      },
    });
    const url = `http://localhost:${server.port}`;
    if (receiveWebhook) receiver = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: receiveWebhook });
    for (let i = 0; i < instances; i++) apps.push(await bootApp(url, storage.path, mode, options));
    return {
      url,
      webhookReceiverUrl: receiver?.url.href,
      drain: async () => {
        await Promise.all(apps.map((app) => app.drain()));
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
