import { afterEach, describe, expect, test } from "bun:test";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, OWNER } from "./support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

interface Thread {
  readonly message: Readonly<Record<string, unknown>>;
  readonly replies: readonly unknown[];
}

describe("reading a thread by its ID", () => {
  test("answers 200 with the message and no replies", async () => {
    app = makeApp();
    const posted = await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const { message } = (await posted.json()) as Thread;
    await call(app, "POST", "/messages", { channel: "dev", text: "another thread" });
    const read = await call(app, "GET", `/messages/${message.id}`);
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toStartWith("application/json");
    expect(await read.json()).toEqual({ message, replies: [] });
  });
});

describe("reading a message that does not exist", () => {
  test("answers 404 message_not_found for an ID past the last message", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const read = await call(app, "GET", "/messages/9999");
    expect(read.status).toBe(404);
    expect(await read.json()).toMatchObject({
      error: { code: "message_not_found", message: "Couldn't find message #9999." },
    });
  });

  test("answers 404 message_not_found, not 400, for an ID that is not a number", async () => {
    app = makeApp();
    const read = await call(app, "GET", "/messages/no-such-message");
    expect(read.status).toBe(404);
    expect(await read.json()).toMatchObject({ error: { code: "message_not_found" } });
  });
});

test("GET /threads answers an empty channel with the board cursor", async () => {
  app = makeApp();
  await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
  const read = await call(app, "GET", "/threads?channel=ops");
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual({ threads: [], cursor: "2", older: null });
});

test("GET /threads combines repeated label filters with labels from the root and a reply", async () => {
  app = makeApp();
  const posted = await call(app, "POST", "/messages", { channel: "dev", text: "root", labels: { area: "api" } });
  const { message } = (await posted.json()) as Thread;
  await call(app, "POST", "/messages", { re: message.id, text: "matching reply", labels: { status: "open" } });
  const latest = await call(app, "POST", "/messages", { re: message.id, text: "latest reply" });
  await call(app, "POST", "/messages", { channel: "dev", text: "different area", labels: { status: "open" } });

  const read = await call(app, "GET", "/threads?channel=dev&label=area&label=status%3Ddraft%7Copen%7C%00");
  expect(read.status).toBe(200);
  expect(await read.json()).toMatchObject({
    threads: [{ message, replies: 2, last: ((await latest.json()) as Thread).message }],
  });
});

test("GET /messages/:id rejects a cursor outside the requested thread", async () => {
  app = makeApp();
  const posted = await call(app, "POST", "/messages", { channel: "dev", text: "root" });
  const outside = await call(app, "POST", "/messages", { channel: "dev", text: "different thread" });
  const { message } = (await posted.json()) as Thread;
  const { message: foreign } = (await outside.json()) as Thread;
  const read = await call(app, "GET", `/messages/${message.id}?after=${foreign.id}`);

  expect(read.status).toBe(400);
  expect(await read.json()).toMatchObject({ error: { code: "invalid_request" } });
});

describe("paging back through a channel's threads", () => {
  test("GET /threads?limit=2 then before=<older> lists every thread once and ends with older null", async () => {
    app = makeApp();
    const ids: string[] = [];
    for (const text of ["one", "two", "three", "four", "five"]) {
      const posted = await call(app, "POST", "/messages", { channel: "dev", text });
      ids.push(((await posted.json()) as Thread).message.id as string);
    }
    const seen: string[] = [];
    let page = (await (await call(app, "GET", "/threads?channel=dev&limit=2")).json()) as {
      threads: Thread[];
      older: string | null;
    };
    expect(page.older).toBe(`${ids[3]}.${ids[3]}`);
    seen.unshift(...page.threads.map(({ message }) => message.id as string));
    while (page.older !== null) {
      const read = await call(app, "GET", `/threads?channel=dev&limit=2&before=${page.older}`);
      expect(read.status).toBe(200);
      page = (await read.json()) as typeof page;
      seen.unshift(...page.threads.map(({ message }) => message.id as string));
    }
    expect(seen).toEqual(ids);
  });

  test("GET /threads without before answers older null when every thread fits", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "only" });
    expect(await (await call(app, "GET", "/threads?channel=dev")).json()).toMatchObject({ older: null });
  });

  test.each([["790"], ["a.b"], ["3.4"], ["1.2.3"], ["99.2"]])(
    "GET /threads answers 400 invalid_cursor for before=%s, which no page gave as its older",
    async (before) => {
      app = makeApp();
      await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
      const read = await call(app, "GET", `/threads?channel=dev&before=${before}`);
      expect(read.status).toBe(400);
      expect(await read.json()).toMatchObject({ error: { code: "invalid_cursor" } });
    },
  );
});

describe("paging threads one way at a time", () => {
  test.each([
    ["older", "4.4"],
    ["unreadable", "x"],
  ])("GET /threads answers 400 invalid_request for an %s before with after", async (_, before) => {
    app = makeApp();
    for (const text of ["one", "two", "three"]) await call(app, "POST", "/messages", { channel: "dev", text });
    const read = await call(app, "GET", `/threads?channel=dev&before=${before}&after=1`);
    expect(read.status).toBe(400);
    expect(await read.json()).toMatchObject({ error: { code: "invalid_request" } });
  });

  test("GET /threads?after= lists the threads active after the cursor, oldest first, without older", async () => {
    app = makeApp();
    const ids: string[] = [];
    for (const text of ["one", "two", "three"]) {
      const posted = await call(app, "POST", "/messages", { channel: "dev", text });
      ids.push(((await posted.json()) as Thread).message.id as string);
    }
    const read = await call(app, "GET", `/threads?channel=dev&after=${ids[0]}&limit=1`);
    expect(read.status).toBe(200);
    const page = (await read.json()) as { threads: Thread[]; cursor: string };
    expect(page.threads.map(({ message }) => message.id)).toEqual([ids[1]]);
    expect(page).toEqual({ threads: page.threads, cursor: ids[2] as string });
  });

  test.each([["x"], ["99"]])("GET /threads answers 400 invalid_cursor for after=%s", async (after) => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const read = await call(app, "GET", `/threads?channel=dev&after=${after}`);
    expect(read.status).toBe(400);
    expect(await read.json()).toMatchObject({ error: { code: "invalid_cursor" } });
  });
});

describe("searching a channel's threads by text", () => {
  async function found(text: string): Promise<unknown[]> {
    const read = await call(app, "GET", `/threads?channel=dev&text=${encodeURIComponent(text)}`);
    expect(read.status).toBe(200);
    return ((await read.json()) as { threads: Thread[] }).threads.map(({ message }) => message.id);
  }

  test("GET /threads?text= finds a thread by a root or a reply as it reads now, in any case", async () => {
    app = makeApp();
    const literal = (
      (await (await call(app, "POST", "/messages", { channel: "dev", text: "Deploy FAILED 100%" })).json()) as Thread
    ).message.id;
    const posted = await call(app, "POST", "/messages", { channel: "dev", text: "deploy failed at 1000" });
    const lookalike = ((await posted.json()) as Thread).message.id;
    await call(app, "POST", "/messages", { re: lookalike, text: "the reply says Crème" });
    expect(await found("DEPLOY failed")).toEqual([literal, lookalike]);
    expect(await found("100%")).toEqual([literal]);
    expect(await found("CRÈME")).toEqual([lookalike]);
    await call(app, "POST", `/messages/${lookalike}/edit`, { text: "deploy fixed" });
    expect(await found("1000")).toEqual([]);
    expect(await found("deploy fixed")).toEqual([lookalike]);
  });

  test.each([[""], ["x".repeat(201)], ["a%00b"]])(
    "GET /threads answers 400 invalid_request for text=%s",
    async (text) => {
      app = makeApp();
      const read = await call(app, "GET", `/threads?channel=dev&text=${text}`);
      expect(read.status).toBe(400);
      expect(await read.json()).toMatchObject({ error: { code: "invalid_request" } });
    },
  );
});

describe("listing the threads of every channel under a pattern", () => {
  async function post(channel: string, text: string): Promise<unknown> {
    return ((await (await call(app, "POST", "/messages", { channel, text })).json()) as Thread).message.id;
  }

  test("GET /threads?channel=dev/ lists dev's threads and those under it, not a sibling's", async () => {
    app = makeApp();
    const own = await post("dev", "in dev");
    const nested = await post("dev/web", "in dev/web");
    await post("devops", "a sibling");
    const read = await call(app, "GET", "/threads?channel=dev/");
    expect(read.status).toBe(200);
    expect(((await read.json()) as { threads: Thread[] }).threads.map(({ message }) => message.id)).toEqual([
      own,
      nested,
    ]);
  });

  test.each([["dev//"], ["/"], ["dev/*"]])(
    "GET /threads answers 400 invalid_request for channel=%s",
    async (channel) => {
      app = makeApp();
      const read = await call(app, "GET", `/threads?channel=${encodeURIComponent(channel)}`);
      expect(read.status).toBe(400);
      expect(await read.json()).toMatchObject({ error: { code: "invalid_request" } });
    },
  );

  test("refuses 403 a subtree a caller cannot read throughout, and lists one it can", async () => {
    app = makeApp();
    await post("dev/secret", "hidden");
    const connection = await call(app, "POST", "/x/connections", {
      name: "reader",
      direct: true,
      can: { "dev/": ["read"], "dev/secret": ["post"] },
    });
    const { secret } = (await connection.json()) as { secret: string };
    const read = (channel: string) =>
      app.fetch(
        new Request(`${BOARD_URL}/threads?channel=${channel}`, { headers: { authorization: `Bearer ${secret}` } }),
      );
    const refused = await read("dev/");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "forbidden" } });
    expect((await read("dev/web/")).status).toBe(200);
  });
});

test("GET /threads filters roots and replies by author before paging", async () => {
  app = makeApp();
  const post = async (body: object, profile?: string) => {
    const response = profile
      ? await app.fetch(
          new Request(`${BOARD_URL}/messages`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${OWNER.token}`,
              "content-type": "application/json",
              "x-board-profile": profile,
            },
            body: JSON.stringify(body),
          }),
        )
      : await call(app, "POST", "/messages", body);
    expect(response.status).toBe(201);
    return ((await response.json()) as Thread).message.id;
  };
  const found = async (by: string, query = "") => {
    const read = await call(app, "GET", `/threads?channel=dev&by=${encodeURIComponent(by)}${query}`);
    expect(read.status).toBe(200);
    return ((await read.json()) as { threads: Thread[] }).threads.map(({ message }) => message.id);
  };

  const authored = await post({ channel: "dev", text: "fix" }, "bot");
  const replied = await post({ channel: "dev", text: "fix by the owner" });
  const reply = await post({ re: replied, text: "review" }, "bot");
  const unrelated = await post({ channel: "dev", text: "other" });
  expect(await found("LOCAL-TEST/BOT")).toEqual([authored, replied]);
  expect(await found(`${LOCAL_OWNER}+bot`, "&limit=1")).toEqual([replied]);
  expect(await found("local-test")).toEqual([authored, replied, unrelated]);
  expect(await found("me")).toEqual([replied, unrelated]);
  expect(await found("local-test/bot", "&text=fix")).toEqual([authored]);
  expect(await found("someone-else")).toEqual([]);
  expect((await call(app, "POST", `/messages/${reply}/delete`, {})).status).toBe(200);
  expect(await found("local-test/bot")).toEqual([authored, replied]);
  expect(await found("local-test/bot", "&text=review")).toEqual([]);
});

test("GET /threads finds threads that mention someone, by handle, ID or me, a person covering their agents", async () => {
  app = makeApp();
  const post = async (body: object, headers: Record<string, string> = {}) => {
    const response = await app.fetch(
      new Request(`${BOARD_URL}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${OWNER.token}`, "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(201);
    return ((await response.json()) as Thread).message.id;
  };
  const found = async (mentions: string, token = OWNER.token) => {
    const read = await app.fetch(
      new Request(`${BOARD_URL}/threads?channel=dev&mentions=${encodeURIComponent(mentions)}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(read.status).toBe(200);
    return ((await read.json()) as { threads: Thread[] }).threads.map(({ message }) => message.id);
  };

  // The owner has not written yet, so this handle names no one and stays text.
  const early = await post({ channel: "dev", text: "hi @local-test" }, { "x-board-profile": "bot" });
  const replied = await post({ channel: "dev", text: "root" });
  await post({ channel: "dev", text: "bot here" }, { "x-board-profile": "bot" });
  const me = await post({ channel: "dev", text: "over to @local-test" }, { "x-board-profile": "bot" });
  const agent = await post({ channel: "dev", text: "cc @local-test/bot" });
  await post({ re: replied, text: `ping @[${LOCAL_OWNER}]` });
  await post({ channel: "dev", text: "`@local-test` in code" });
  const nobody = await post({ channel: "dev", text: "is @nobody there?" });
  await post({ channel: "ops", text: "elsewhere @local-test" });

  expect(await found("me")).toEqual([early, me, agent, replied]);
  expect(await found("@LOCAL-TEST")).toEqual([early, me, agent, replied]);
  expect(await found(LOCAL_OWNER)).toEqual([early, me, agent, replied]);
  expect(await found(`@[${LOCAL_OWNER}+bot]`)).toEqual([agent]);
  expect(await found("local-test/bot")).toEqual([agent]);
  expect(await found("@Nobody")).toEqual([nobody]);
  expect(await found("someone")).toEqual([]);

  const connection = await call(app, "POST", "/x/connections", {
    name: "reader",
    direct: true,
    can: { dev: ["read"] },
  });
  const { secret } = (await connection.json()) as { secret: string };
  expect(await found("nobody", secret)).toEqual([nobody]);
  expect(await found(LOCAL_OWNER, secret)).toEqual([me, agent, replied]);
  expect(await found("local-test", secret)).toEqual([early]);

  const notifier = await call(app, "POST", "/x/connections", {
    name: "notifier",
    direct: true,
    can: { dev: ["post"] },
  });
  const { secret: postOnly } = (await notifier.json()) as { secret: string };
  const alert = await app.fetch(
    new Request(`${BOARD_URL}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${postOnly}`, "content-type": "application/json" },
      body: JSON.stringify({ channel: "dev", text: "deploy failed @local-test" }),
    }),
  );
  expect(alert.status).toBe(201);
  const alerted = ((await alert.json()) as Thread).message.id;
  expect(await found("me")).toEqual([early, me, agent, replied, alerted]);

  const refused = await call(app, "GET", "/threads?channel=dev&mentions=%40");
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ error: { code: "invalid_request" } });
});
