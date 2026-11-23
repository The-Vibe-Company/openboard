import { createApp } from "@openboard/server";

export async function boot(driver: "sqlite" | "postgres", instances: number) {
  const mode = driver === "sqlite" ? "local" : "hosted";
  const apps = Array.from({ length: instances }, () => createApp({ mode }, {}, {}));
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
    return { url: new URL(path, (proxy ?? first).url), close };
  } catch (error) {
    await close();
    throw error;
  }
}
