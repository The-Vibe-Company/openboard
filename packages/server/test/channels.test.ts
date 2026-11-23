import { expect, test } from "bun:test";
import { call, makeApp } from "./support/app.ts";

test("GET /channels lists posted channels and counts on the board", async () => {
  const app = makeApp();
  try {
    for (const channel of ["dev", "dev/web"]) {
      const posted = await call(app, "POST", "/messages", { channel, text: "hello" });
      expect(posted.status).toBe(201);
    }
    const listed = await call(app, "GET", "/channels");
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      channels: [
        { path: "dev", lastIndex: 2, messages: 1, threads: 1 },
        { path: "dev/web", lastIndex: 3, messages: 1, threads: 1 },
      ],
      cursor: "3",
      next: null,
    });
  } finally {
    await app.close();
  }
});

async function postTo(app: ReturnType<typeof makeApp>, channels: readonly string[]): Promise<void> {
  for (const channel of channels) {
    const posted = await call(app, "POST", "/messages", { channel, text: "hello" });
    expect(posted.status).toBe(201);
  }
}

test("GET /channels pages through the channels under a prefix, each once", async () => {
  const app = makeApp();
  try {
    await postTo(app, ["dev/web", "ops", "dev"]);
    const seen: string[] = [];
    let after: string | null = null;
    do {
      const query: string = `/channels?prefix=dev&limit=1${after === null ? "" : `&after=${encodeURIComponent(after)}`}`;
      const page = await call(app, "GET", query);
      expect(page.status).toBe(200);
      const body = (await page.json()) as { channels: { path: string }[]; cursor: string; next: string | null };
      expect(body.channels.length).toBeLessThanOrEqual(1);
      expect(body.cursor).toBe("4");
      seen.push(...body.channels.map((channel) => channel.path));
      after = body.next;
    } while (after !== null && seen.length < 5);
    expect(seen).toEqual(["dev", "dev/web"]);
  } finally {
    await app.close();
  }
});

test("GET /channels answers the last page with next null, and none under an unknown prefix", async () => {
  const app = makeApp();
  try {
    await postTo(app, ["dev", "dev/web"]);
    const first = await (await call(app, "GET", "/channels?limit=1")).json();
    expect(first).toMatchObject({ channels: [{ path: "dev" }], next: "dev" });
    const last = await (await call(app, "GET", "/channels?limit=1&after=dev")).json();
    expect(last).toMatchObject({ channels: [{ path: "dev/web" }], next: null });
    const under = await (await call(app, "GET", "/channels?prefix=dev/")).json();
    expect(under).toMatchObject({ channels: [{ path: "dev/web" }], next: null });
    expect(await (await call(app, "GET", "/channels?prefix=zz")).json()).toEqual({
      channels: [],
      cursor: "3",
      next: null,
    });
  } finally {
    await app.close();
  }
});

test.each([
  ["a limit of 0", "/channels?limit=0", "limit"],
  ["a limit over 500", "/channels?limit=501", "limit"],
  ["an empty prefix", "/channels?prefix=", "prefix"],
  ["an unknown parameter", "/channels?page=2", "page"],
])("GET /channels answers 400 invalid_request for %s", async (_, path, field) => {
  const app = makeApp();
  try {
    const refused = await call(app, "GET", path);
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toStartWith(field);
  } finally {
    await app.close();
  }
});

test("creates and lists an empty channel, with one log position for concurrent creates", async () => {
  const app = makeApp();
  const path = "dev/alerts";
  const channel = { path, lastIndex: 0, messages: 0, threads: 0 };
  try {
    const results = await Promise.all([
      call(app, "POST", "/channels", { path }),
      call(app, "POST", "/channels", { path }),
    ]);
    const [existing, created] = results.sort((a, b) => a.status - b.status);
    expect(existing?.status).toBe(200);
    expect(await existing?.json()).toEqual({ channel, created: false });
    expect(created?.status).toBe(201);
    expect(await created?.json()).toEqual({ channel, created: true });

    expect(await (await call(app, "GET", "/channels")).json()).toEqual({
      channels: [channel],
      cursor: "1",
      next: null,
    });
    expect(await (await call(app, "GET", "/events?after=0")).json()).toEqual({ cursor: "1", events: [] });

    await postTo(app, [path]);
    expect(await (await call(app, "GET", "/channels")).json()).toEqual({
      channels: [{ path, lastIndex: 3, messages: 1, threads: 1 }],
      cursor: "3",
      next: null,
    });
  } finally {
    await app.close();
  }
});

test("creating a channel opened by a post returns its counts without advancing the cursor", async () => {
  const app = makeApp();
  try {
    const path = "dev";
    await postTo(app, [path]);
    const channel = { path, lastIndex: 2, messages: 1, threads: 1 };

    const response = await call(app, "POST", "/channels", { path });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ channel, created: false });
    expect(await (await call(app, "GET", "/channels")).json()).toEqual({
      channels: [channel],
      cursor: "2",
      next: null,
    });
  } finally {
    await app.close();
  }
});

test.each([{ path: "Not A Channel" }, { path: "dev/alerts", private: true }])(
  "rejects an invalid channel creation body %j",
  async (body) => {
    const app = makeApp();
    try {
      const response = await call(app, "POST", "/channels", body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
      expect(await (await call(app, "GET", "/channels")).json()).toEqual({ channels: [], cursor: "0", next: null });
    } finally {
      await app.close();
    }
  },
);
