import { expect, test } from "bun:test";
import { call, makeApp } from "./app.ts";
import { postgresTestUrl } from "./env.ts";

const postgres = postgresTestUrl() !== undefined;

test.if(postgres)("on Postgres, request 1 is served by instance 1 and request 2 by instance 2", async () => {
  const app = makeApp();
  try {
    expect(app.instances).toHaveLength(2);
    const posted = await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    expect(posted.status).toBe(201);
    const { message } = (await posted.json()) as { message: { id: string } };
    // The second instance reads what the first wrote: one database, and one request ID sequence.
    const read = await call(app, "GET", `/messages/${message.id}`);
    expect(read.status).toBe(200);
    expect([posted.headers.get("x-request-id"), read.headers.get("x-request-id")]).toEqual(["req-1", "req-2"]);
    expect(app.served).toEqual([1, 2]);
    expect((await call(app, "GET", "/channels")).status).toBe(200);
    expect(app.served).toEqual([1, 2, 1]);
  } finally {
    await app.close();
  }
});

test.if(postgres)("on Postgres, each instance has its own driver: closing one leaves the other serving", async () => {
  const app = makeApp();
  try {
    const [first, second] = app.instances;
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "hello" })).status).toBe(201);
    await first?.close();
    // The second instance still reads the board through its own pool once the first one's is closed.
    const listed = await call(second ?? app, "GET", "/channels");
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ channels: [{ path: "dev", messages: 1 }] });
  } finally {
    await app.close();
  }
});

test.if(!postgres)("on SQLite, one app serves every request", async () => {
  const app = makeApp();
  try {
    expect(app.instances).toHaveLength(1);
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "hello" })).status).toBe(201);
    expect((await call(app, "GET", "/messages/2")).status).toBe(200);
    expect(app.served).toEqual([1, 1]);
  } finally {
    await app.close();
  }
});
