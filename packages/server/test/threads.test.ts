import { afterEach, describe, expect, test } from "bun:test";
import { call, makeApp } from "./support/app.ts";

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
    const read = await call(app, "GET", "/messages/1");
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

  test.each(["no-such-message", "01", "1.0", "-1", "99999999999999999999"])(
    "answers 404 message_not_found, not 400, for the ID %p that is not a log position",
    async (id) => {
      app = makeApp();
      await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
      const read = await call(app, "GET", `/messages/${id}`);
      expect(read.status).toBe(404);
      expect(await read.json()).toMatchObject({ error: { code: "message_not_found" } });
    },
  );
});
