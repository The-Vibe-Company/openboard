import { expect, test } from "bun:test";
import { call, makeApp } from "./support/app.ts";

test("one concurrent conditional label write wins and only that write advances the version", async () => {
  const app = makeApp();
  try {
    const posted = await call(app, "POST", "/messages", { channel: "dev", text: "claim me", labels: { state: "" } });
    expect(posted.status).toBe(201);
    const { message } = (await posted.json()) as { message: { id: string; version: number } };
    const path = `/messages/${message.id}`;
    const write = (owner: string) =>
      call(app, "POST", `${path}/labels`, { set: { owner }, if: { owner: null, state: "" } });
    const owners = ["one", "two", "three"];
    const writes = await Promise.all(owners.map(write));
    expect(writes.map((result) => result.status).sort()).toEqual([200, 409, 409]);
    for (const result of writes.filter((result) => result.status === 409)) {
      expect(await result.json()).toMatchObject({ error: { code: "label_conflict", message: "owner is set" } });
    }
    const read = await call(app, "GET", path);
    expect(await read.json()).toMatchObject({
      message: {
        labels: { owner: owners[writes.findIndex((result) => result.status === 200)], state: "" },
        version: message.version + 1,
      },
    });
  } finally {
    await app.close();
  }
});
