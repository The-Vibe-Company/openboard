import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { type App, createApp, type ServerConfig } from "@openboard/server";

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
    return Response.json({ id, login, name: login });
  }
  if (pathname === "/user/emails") {
    return Response.json([{ email: `${login}@example.com`, primary: true, verified: true }]);
  }
  return new Response(null, { status: 404 });
}

interface ServeOptions {
  signup?: NonNullable<ServerConfig["signup"]>;
  dataDir?: string;
  port?: number;
}

export async function serve({ signup = "open", dataDir, port = 0 }: ServeOptions = {}) {
  const temporary = dataDir === undefined;
  const directory = dataDir ?? (await mkdtemp(join(tmpdir(), "openboard-browser-")));
  const clean = () => (temporary ? rm(directory, { recursive: true, force: true }) : Promise.resolve());
  let app: App | undefined;
  let server: Bun.Server<undefined>;
  try {
    server = Bun.serve({
      hostname: "localhost",
      port,
      fetch: (request) => app?.fetch(request) ?? new Response(null, { status: 503 }),
    });
  } catch (error) {
    await clean();
    throw error;
  }
  const url = `http://localhost:${server.port}`;
  try {
    const store = sqliteDriver({ dir: directory });
    try {
      app = createApp(
        {
          mode: "local",
          publicUrl: url,
          localOwner: "ob:user:local-browser-test",
          signup,
          webDir: join(import.meta.dir, "../../dist"),
          signIn: { github: { clientId: "example-client", clientSecret: "example-client-secret" } },
        },
        { store, jobs: store.jobs },
        {
          now: Date.now,
          requestId: () => crypto.randomUUID(),
          schedule(delay, run) {
            const timer = setTimeout(run, delay);
            return () => clearTimeout(timer);
          },
          log: { info() {}, error() {} },
          randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
          fetch: fakeProvider,
        },
      );
    } catch (error) {
      await store.close();
      throw error;
    }
  } catch (error) {
    await server.stop(true);
    await clean();
    throw error;
  }
  const running = app;
  return {
    url,
    drain: () => running.drain(),
    async stop() {
      await server.stop(true);
      try {
        await running.close();
      } finally {
        await clean();
      }
    },
  };
}
