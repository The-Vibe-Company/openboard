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
        { path: "dev", lastIndex: 1, messages: 1, threads: 1 },
        { path: "dev/web", lastIndex: 2, messages: 1, threads: 1 },
      ],
      cursor: "2",
      next: null,
    });
  } finally {
    await app.close();
  }
});
