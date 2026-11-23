import process from "node:process";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, mintLocalOwnerToken } from "@openboard/server";

/**
 * One app on its own store. Hosted mode runs on SQLite too until the Postgres driver exists (M5): its counters and
 * conformance score are the local ones until then.
 */
function bootApp(mode: "local" | "hosted", localOwnerTokenHash: string) {
  const now = () => Date.now();
  const log = {
    /** Request lines stay quiet here: the bench measures requests and conformance prints its own report. */
    info: () => {},
    error: (message: string, fields: object) => process.stderr.write(`${JSON.stringify({ message, ...fields })}\n`),
  };
  return createApp(
    { mode, localOwner: "ob:user:local-tools", localOwnerTokenHash },
    { store: sqliteDriver({ memory: true }, now) },
    { now, log },
  );
}

export async function boot(driver: "sqlite" | "postgres", instances: number) {
  const mode = driver === "sqlite" ? "local" : "hosted";
  const owner = mintLocalOwnerToken(crypto.getRandomValues(new Uint8Array(42)));
  const apps = Array.from({ length: instances }, () => bootApp(mode, owner.hash));
  const servers: Bun.Server<undefined>[] = [];
  const hostname = "127.0.0.1";
  let proxy: Bun.Server<undefined> | undefined;

  async function close() {
    await proxy?.stop(true);
    await Promise.all(servers.map((server) => server.stop(true)));
    await Promise.all(apps.map((app) => app.close()));
  }

  try {
    for (const app of apps) {
      servers.push(Bun.serve({ hostname, port: 0, fetch: app.fetch }));
    }

    const [first, second] = servers;
    if (!first) throw new Error("Conformance requires at least one server");
    if (second) {
      let next = first;
      proxy = Bun.serve({
        hostname,
        port: 0,
        fetch(request) {
          const incoming = new URL(request.url);
          const target = new URL(next.url);
          target.pathname = incoming.pathname;
          target.search = incoming.search;
          next = next === first ? second : first;
          return fetch(new Request(target.href, request), { redirect: "manual" });
        },
      });
    }

    const path = mode === "local" ? "/api/local/main" : "/api/conformance-ci/main";
    // The kit runs as the local owner until connections exist (docs/codebase.md 6.3 step 2).
    return { url: new URL(path, (proxy ?? first).url), token: owner.token, close };
  } catch (error) {
    await close();
    throw error;
  }
}
