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
