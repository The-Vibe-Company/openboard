import { afterEach, describe, expect, test } from "bun:test";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

let app: ReturnType<typeof makeApp> | undefined;
afterEach(() => app?.close());

const post = (headers: Record<string, string>) =>
  new Request(`${BOARD_URL}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ channel: "dev", text: "x" }),
  });

describe("a request that carries no credential", () => {
  test.each([
    ["no authorization header", {}],
    ["a bearer of no kind the board accepts", { authorization: "Bearer not-a-board-token" }],
    ["a scheme other than Bearer", { authorization: "Basic b2I6b2I=" }],
  ])("with %s answers 401 JSON unauthorized naming BOARD_TOKEN", async (_, headers) => {
    app = makeApp();
    const response = await app.fetch(post(headers));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toStartWith("application/json");
    const { error } = (await response.json()) as { error: { code: string; hint: string } };
    expect(error.code).toBe("unauthorized");
    expect(error.hint).toContain("BOARD_TOKEN");
  });

  test("writes nothing", async () => {
    app = makeApp();
    await app.fetch(post({}));
    const read = await call(app, "GET", "/messages?channel=dev");
    expect(read.status).toBe(200);
    expect(((await read.json()) as { messages: unknown[] }).messages).toEqual([]);
  });

  test("is refused on a read too", async () => {
    app = makeApp();
    const response = await app.fetch(new Request(`${BOARD_URL}/messages?channel=dev`));
    expect(response.status).toBe(401);
  });
});
