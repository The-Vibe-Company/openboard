import { expect, test } from "bun:test";
import type {
  createSchedule,
  listSchedules,
  OutputOf,
  postMessage,
  readEvents,
  readThread,
  upload,
} from "@openboard/contract";
import { BLOB_GC_JOB } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { BOARD_URL, call, makeApp, NOW, OWNER, PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";
import { openSnapshotStore } from "../support/drivers.ts";

async function json<T>(response: Response, status = 200): Promise<T> {
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

async function uploadFile(app: ReturnType<typeof makeApp>, name: string) {
  const response = await app.fetch(
    new Request(`${BOARD_URL}/attachments`, {
      method: "POST",
      headers: { authorization: `Bearer ${OWNER.token}`, "content-type": "text/plain", "x-board-filename": name },
      body: name,
    }),
  );
  return (await json<OutputOf<typeof upload>>(response, 201)).attachment;
}

test("lists schedules in creation order and filters by thread, channel, author, and state", async () => {
  let now = NOW;
  const store = openSnapshotStore(() => now);
  const app = makeApp({ store, now: () => now });
  const send = (method: string, path: string, body?: unknown) => call(app, method, path, body);
  const list = async (query = "") =>
    (await json<OutputOf<typeof listSchedules>>(await send("GET", `/schedules${query}`))).schedules;
  try {
    const { message: root } = await json<OutputOf<typeof postMessage>>(
      await send("POST", "/messages", { channel: "work", text: "root" }),
      201,
    );
    const { message: reply } = await json<OutputOf<typeof postMessage>>(
      await send("POST", "/messages", { re: root.id, text: "reply" }),
      201,
    );
    const attachments = [await uploadFile(app, "first.txt"), await uploadFile(app, "second.txt")].reverse();
    const created = [];
    for (const [index, target] of [
      { re: root.id },
      { re: reply.id },
      { channel: "dev" },
      { re: root.id },
      { re: root.id },
    ].entries()) {
      const { schedule } = await json<OutputOf<typeof createSchedule>>(
        await send("POST", "/schedules", {
          ...target,
          text: `schedule ${index}`,
          in: `${5 - index}d`,
          noSync: true,
          ...(index === 0 && { attachments: attachments.map(({ id }) => id), every: "1h", times: 2 }),
        }),
        201,
      );
      created.push(schedule);
    }
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("missing local board");
    await store.seedScheduleState(keys, 4, "done", Number(reply.id));
    await store.seedScheduleState(keys, 5, "canceled", null);

    expect(created[0]).toMatchObject({ attachments, every: 3_600_000, times: 2 });
    now += 86_400_000;
    const board = store.board(testScope(keys));
    const lease = { instanceId: "schedule-test", claimedAt: now };
    for (const { id } of attachments) {
      const { job } = await store.jobs.claim([BLOB_GC_JOB], lease);
      if (!job) throw new Error(`missing GC job for ${id}`);
      expect(await board.collectAttachment(job.id, lease)).toBe(true);
    }
    expect(await board.attachments(attachments.map(({ id }) => id))).toEqual([]);
    expect(await list()).toEqual(created.slice(0, 3));
    expect(await list(`?re=${reply.id}`)).toEqual(created.slice(0, 2));
    expect(await json(await send("GET", "/schedules?re=999999"), 404)).toMatchObject({
      error: { code: "message_not_found" },
    });
    expect(await list("?channel=dev")).toEqual(created.slice(2, 3));
    expect(await list(`?channel=dev&re=${reply.id}`)).toEqual([]);
    expect(await list(`?by=${encodeURIComponent(root.by.actor)}`)).toEqual(created.slice(0, 3));
    expect(await list(`?by=@${root.author?.handle.toUpperCase()}`)).toEqual(created.slice(0, 3));
    expect(await list("?by=unmatched")).toEqual([]);
    expect((await list("?all=true")).slice(3)).toMatchObject([
      { id: "s4", state: "done", last: reply.id, next: null, sent: 1 },
      { id: "s5", state: "canceled", next: null },
    ]);
    const { cursor } = await json<OutputOf<typeof readEvents>>(await send("GET", "/events?last=1"));
    expect(Number(cursor)).toBeGreaterThan(Number(reply.id));
    expect(await json<OutputOf<typeof readThread>>(await send("GET", `/messages/${reply.id}`))).toMatchObject({
      message: { id: root.id },
      replies: [{ id: reply.id }],
      cursor,
      schedules: created.slice(0, 2),
    });
  } finally {
    await app.close();
  }
});

test("a post-only caller lists its blind schedules and sees normal schedules in readable channels", async () => {
  const app = makeApp();
  const restricted = (path: string, body?: unknown, can = "private=post;dev=read") =>
    app.fetch(
      new Request(`${BOARD_URL}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${OWNER.token}`,
          "x-board-can": can,
          "x-board-profile": "fixer",
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  try {
    const schedule = { text: "later", in: "1d" };
    await json(await call(app, "POST", "/schedules", { ...schedule, channel: "private" }), 201);
    await json(
      await restricted("/schedules", { ...schedule, channel: "private", text: "later @[foreign-actor]" }),
      201,
    );
    await json(await call(app, "POST", "/schedules", { ...schedule, channel: "dev" }), 201);
    const { schedules } = await json<OutputOf<typeof listSchedules>>(await restricted("/schedules"));
    expect(schedules.map(({ id, text }) => ({ id, text }))).toEqual([
      { id: "s2", text: "" },
      { id: "s3", text: "later" },
    ]);
    const readOnly = await json<OutputOf<typeof listSchedules>>(await restricted("/schedules", undefined, "dev=read"));
    expect(readOnly.schedules.map(({ id }) => id)).toEqual(["s3"]);
    const { message } = await json<OutputOf<typeof postMessage>>(
      await call(app, "POST", "/messages", { channel: "private", text: "private root" }),
      201,
    );
    expect(await json(await restricted(`/schedules?re=${message.id}`), 404)).toMatchObject({
      error: { code: "message_not_found" },
    });
  } finally {
    await app.close();
  }
});

test("schedule lists and thread reads keep schedules on their own organization's board", async () => {
  const app = makeBrowserApp();
  async function seed(person: "ada" | "lin", slug: string) {
    const { headers } = await browserSession(app.fetch, person);
    const send = (path: string, body?: unknown) =>
      app.fetch(
        new Request(`${PUBLIC_URL}${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    await json(await send("/api/x/orgs", { slug, name: slug }), 201);
    const base = `/api/${slug}/main`;
    const { message } = await json<OutputOf<typeof postMessage>>(
      await send(`${base}/messages`, { channel: "dev", text: slug }),
      201,
    );
    const { schedule } = await json<OutputOf<typeof createSchedule>>(
      await send(`${base}/schedules`, { re: message.id, text: `${slug} only`, in: "1d" }),
      201,
    );
    return { id: message.id, schedule, read: (path: string) => send(`${base}${path}`) };
  }
  try {
    const a = await seed("ada", "alpha");
    const b = await seed("lin", "bravo");
    expect(a.id).toBe(b.id);
    expect(a.schedule.id).toBe(b.schedule.id);
    for (const { id, read, schedule } of [a, b]) {
      expect(await json(await read("/schedules"))).toEqual({ schedules: [schedule] });
      expect(await json(await read(`/schedules?re=${id}`))).toEqual({ schedules: [schedule] });
      expect(await json(await read(`/messages/${id}`))).toMatchObject({ schedules: [schedule] });
    }
  } finally {
    await app.close();
  }
});
