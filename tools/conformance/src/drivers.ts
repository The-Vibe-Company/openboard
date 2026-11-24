import process from "node:process";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, mintLocalOwnerToken } from "@openboard/server";

/**
 * One app on its own store. Hosted mode runs on SQLite too until the Postgres driver exists (M5): its counters and
 * conformance score are the local ones until then.
 */
function bootApp(mode: "local" | "hosted", publicUrl: string, localOwnerTokenHash: string) {
  const now = () => Date.now();
  const log = {
    /** Request lines stay quiet here: the bench measures requests and conformance prints its own report. */
    info: () => {},
    error: (message: string, fields: object) => process.stderr.write(`${JSON.stringify({ message, ...fields })}\n`),
  };
  return createApp(
    { mode, publicUrl, localOwner: "ob:user:local-tools", localOwnerTokenHash },
    { store: sqliteDriver({ memory: true }, now) },
    {
      now,
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
  const mode = driver === "sqlite" ? "local" : "hosted";
  const owner = mintLocalOwnerToken(crypto.getRandomValues(new Uint8Array(42)));
  const apps: ReturnType<typeof bootApp>[] = [];
  const servers: Bun.Server<undefined>[] = [];
  const hostname = "127.0.0.1";
  let proxy: Bun.Server<undefined> | undefined;

  async function close() {
    await proxy?.stop(true);
    await Promise.all(servers.map((server) => server.stop(true)));
    await Promise.all(apps.map((app) => app.close()));
  }

  try {
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
    for (let at = 0; at < instances; at++) apps.push(bootApp(mode, origin, owner.hash));

    const path = mode === "local" ? "/api/local/main" : "/api/conformance-ci/main";
    return { url: new URL(path, (proxy ?? first).url), token: owner.token, close };
  } catch (error) {
    await close();
    throw error;
  }
}
