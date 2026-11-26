import { afterEach, describe, expect, test } from "bun:test";
import { jsonLogger } from "../src/index.ts";
import { BOARD_URL, call, failingBoardLookup, makeApp, NOW } from "./support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

/** An app whose logger keeps every line it prints, parsed. */
function loggedApp(failLookup = false) {
  const lines: Record<string, unknown>[] = [];
  const now = () => NOW;
  app = makeApp({
    now,
    ...(failLookup && { store: failingBoardLookup(now) }),
    log: jsonLogger({ now, write: (line) => lines.push(JSON.parse(line)) }),
  });
  return lines;
}

function get(headers: Record<string, string> = {}) {
  return app.fetch(new Request(BOARD_URL, { headers }));
}

describe("x-request-id", () => {
  test("is minted for a request that sent none, and the request line carries it", async () => {
    const lines = loggedApp();
    const first = await get();
    const second = await call(app, "GET", "/channels");
    expect([first.headers.get("x-request-id"), second.headers.get("x-request-id")]).toEqual(["req-1", "req-2"]);
    expect(lines.map((line) => [line.msg, line.request_id, line.status])).toEqual([
      ["request", "req-1", 200],
      ["request", "req-2", 200],
    ]);
  });

  test("echoes the client's ID and logs it", async () => {
    const lines = loggedApp();
    const response = await get({ "x-request-id": "abc" });
    expect(response.headers.get("x-request-id")).toBe("abc");
    expect(lines[0]).toMatchObject({ msg: "request", request_id: "abc" });
  });

  test("replaces an ID that is empty, too long, or holds spaces or non-ASCII characters", async () => {
    const lines = loggedApp();
    const sent = ["", "a".repeat(129), "a b", "é"];
    const answered = [];
    for (const id of sent) answered.push((await get({ "x-request-id": id })).headers.get("x-request-id"));
    expect(answered).toEqual(["req-1", "req-2", "req-3", "req-4"]);
    expect(lines.map((line) => line.request_id)).toEqual(["req-1", "req-2", "req-3", "req-4"]);
    expect((await get({ "x-request-id": "a".repeat(128) })).headers.get("x-request-id")).toBe("a".repeat(128));
  });

  test("is on an error answer and on the error line logged for it", async () => {
    const lines = loggedApp(true);
    const response = await app.fetch(new Request(`${BOARD_URL}/channels`, { headers: { "x-request-id": "trace-me" } }));
    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("trace-me");
    expect(lines.map((line) => [line.level, line.request_id])).toEqual([
      ["error", "trace-me"],
      ["info", "trace-me"],
    ]);
  });
});
