import { expect, test } from "bun:test";
import { join } from "node:path";
import { makeApp, PUBLIC_URL } from "./support/app.ts";

function fixture() {
  const app = makeApp({ webDir: join(import.meta.dir, "fixtures/web"), schedule: () => () => {} });
  return {
    fetch: (path: string, init?: RequestInit) => app.fetch(new Request(PUBLIC_URL + path, init)),
    [Symbol.asyncDispose]: app.close,
  };
}

test("the shell is revalidated on browser routes and stays off reserved paths", async () => {
  await using app = fixture();
  for (const path of ["/", "/acme/main", "/apiary"]) {
    const response = await app.fetch(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith("text/html");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toContain("/assets/app-hash.txt");
  }
  for (const path of ["/api/nope", "/auth/x", "/mcp/x", "/assets/missing.js", "/healthz", "/readyz"]) {
    const response = await app.fetch(path);
    expect(response.headers.get("content-type")).toStartWith("application/json");
    if (!path.endsWith("z")) expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  }
});

test("hashed files serve the negotiated representation with immutable caching", async () => {
  await using app = fixture();
  const path = "/assets/app-hash.txt";
  for (const [accept, encoding] of [
    ["gzip, br", "br"],
    ["br;q=0, gzip", "gzip"],
    ["gzip;q=1, br;q=0.5", "gzip"],
    ["br;q=0, gzip;q=0", null],
  ] as const) {
    const response = await app.fetch(path, { headers: { "accept-encoding": accept } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith("text/plain");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(response.headers.get("content-encoding")).toBe(encoding);
  }
  const head = await app.fetch(path, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe("22");
  expect(await head.text()).toBe("");
  expect((await app.fetch(`${path}.br`)).status).toBe(404);
  expect((await app.fetch("/assets/%2findex.html")).status).toBe(404);
});

test("a source server without a front answers with a plain-text development hint", async () => {
  const app = makeApp();
  try {
    const response = await app.fetch(new Request(PUBLIC_URL));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toStartWith("text/plain");
    expect(await response.text()).toContain("bun run dev");
  } finally {
    await app.close();
  }
});
