import { expect, test } from "bun:test";
import type { createSchedule, OutputOf, postMessage, readBoardAudit, readEvents, upload } from "@openboard/contract";
import { BOARD_URL, call, makeApp, OWNER } from "../support/app.ts";

const post = { channel: "dev", text: "a scheduled note", in: "1d" };

test("creates schedules in order as the resolved creator and exposes only their IDs in audit", async () => {
  const app = makeApp();
  try {
    const rootResponse = await call(app, "POST", "/messages", { channel: "dev", text: "root" });
    const { message } = (await rootResponse.json()) as OutputOf<typeof postMessage>;
    const { cursor } = (await (await call(app, "GET", "/events")).json()) as OutputOf<typeof readEvents>;
    const first = await call(app, "POST", "/schedules", {
      re: message.id,
      text: "@local-test friendly ping",
      in: "1d",
      noSync: true,
    });
    expect(first.status).toBe(201);
    const { schedule, mentions } = (await first.json()) as OutputOf<typeof createSchedule>;
    expect(schedule).toMatchObject({
      id: "s1",
      re: message.id,
      channel: "dev",
      state: "pending",
      sent: 0,
      noSync: true,
      first: "2023-11-15T22:13:20.000Z",
      next: "2023-11-15T22:13:20.000Z",
      by: message.by,
      author: message.author,
    });
    expect(mentions?.[0]?.actor?.id).toBe(message.by.actor);
    const second = await call(app, "POST", "/schedules", {
      channel: "dev",
      text: "standup?",
      at: "2023-11-15T09:00:00+02:00",
    });
    expect(second.status).toBe(201);
    expect(await second.json()).toMatchObject({ schedule: { id: "s2", re: null, next: "2023-11-15T07:00:00.000Z" } });
    const audit = (await (await call(app, "GET", "/x/audit")).json()) as OutputOf<typeof readBoardAudit>;
    expect(audit.events.map(({ type, payload }) => [type, payload])).toEqual([
      ["ob.schedule.created", { id: "s1" }],
      ["ob.schedule.created", { id: "s2" }],
    ]);
    expect(await (await call(app, "GET", `/events?after=${cursor}&all=1`)).json()).toMatchObject({ events: [] });
    expect((await call(app, "GET", "/schedules")).status).toBe(501);
    for (const id of ["12", "s12"]) {
      const canceled = await call(app, "POST", `/schedules/${id}/cancel`);
      expect(canceled.status).toBe(501);
      expect(await canceled.json()).toMatchObject({ error: { code: "no_scheduler" } });
    }
  } finally {
    await app.close();
  }
});

test("invalid schedule requests leave the audit and sequence untouched", async () => {
  const app = makeApp();
  try {
    const register = await call(app, "POST", "/schemas", {
      name: "note",
      version: 1,
      schema: { type: "object", required: ["title"], properties: { title: { type: "string" } } },
    });
    expect(register.status).toBe(201);
    const cases = [
      { at: "2023-11-15T00:00:00Z" },
      { in: undefined },
      { in: "367d" },
      { re: "2" },
      { text: "~~~json#note@1\n{}\n~~~" },
      { every: "30s" },
      { until: "2023-11-15T00:00:00Z" },
      { for: "1d" },
      { times: 2 },
    ];
    for (const [index, input] of cases.entries()) {
      const response = await call(app, "POST", "/schedules", { ...post, ...input });
      expect(response.status).toBe(400);
      const code = index === 4 ? "invalid_block" : "invalid_request";
      const message = index >= 6 ? expect.stringContaining("require every") : expect.any(String);
      expect(await response.json()).toMatchObject({ error: { code, message } });
    }
    const audit = (await (await call(app, "GET", "/x/audit")).json()) as OutputOf<typeof readBoardAudit>;
    expect(audit.events.map(({ type }) => type)).toEqual(["ob.schema.registered"]);
    expect(await (await call(app, "POST", "/schedules", post)).json()).toMatchObject({ schedule: { id: "s1" } });
  } finally {
    await app.close();
  }
});

test("scheduling enforces post, reply read and label grants and accepts a file by ID", async () => {
  const app = makeApp();
  try {
    const root = await call(app, "POST", "/messages", { channel: "dev", text: "root" });
    const { message } = (await root.json()) as OutputOf<typeof postMessage>;
    const send = (can: string, body: unknown) =>
      app.fetch(
        new Request(`${BOARD_URL}/schedules`, {
          method: "POST",
          headers: { authorization: `Bearer ${OWNER.token}`, "x-board-can": can, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const conflict = await send("dev=post", { ...post, re: "999999" });
    expect(conflict.status).toBe(400);
    expect(await conflict.json()).toMatchObject({ error: { code: "invalid_request" } });
    const repeat = await send("dev=post", { text: post.text, re: "999999", every: "1d", for: "1d", times: 2 });
    expect(repeat.status).toBe(400);
    expect(await repeat.json()).toMatchObject({
      error: { code: "invalid_request", message: expect.stringContaining("pick one stop") },
    });
    expect((await send("dev=read", post)).status).toBe(403);
    expect((await send("dev=post", { ...post, channel: undefined, re: message.id })).status).toBe(404);
    expect((await send("dev=read,post", { ...post, labels: { kind: "note" } })).status).toBe(403);
    expect((await send("dev=post", post)).status).toBe(201);
    const uploaded = await app.fetch(
      new Request(`${BOARD_URL}/attachments`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${OWNER.token}`,
          "content-type": "text/plain",
          "x-board-filename": "note.txt",
        },
        body: "notes",
      }),
    );
    expect(uploaded.status).toBe(201);
    const { attachment } = (await uploaded.json()) as OutputOf<typeof upload>;
    const scheduled = await call(app, "POST", "/schedules", { ...post, text: "", attachments: [attachment.id] });
    expect(scheduled.status).toBe(201);
    expect(await scheduled.json()).toMatchObject({ schedule: { id: "s2", attachments: [attachment], text: "" } });
  } finally {
    await app.close();
  }
});
