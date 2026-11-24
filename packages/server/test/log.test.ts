import { afterEach, describe, expect, test } from "bun:test";
import { type createApp, jsonLogger, mintLocalOwnerToken } from "../src/index.ts";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, NOW, OWNER } from "./support/app.ts";

let app: ReturnType<typeof createApp>;

/** An app whose clock moves 7 ms per reading and whose logger keeps every line it prints, parsed. */
function loggedApp() {
  const lines: Record<string, unknown>[] = [];
  let clock = NOW;
  const now = () => {
    clock += 7;
    return clock;
  };
  app = makeApp({ now, log: jsonLogger({ now, write: (line) => lines.push(JSON.parse(line)) }) });
  return lines;
}

const requestLines = (lines: readonly Record<string, unknown>[]) => lines.filter((line) => line.msg === "request");

describe("one JSON log line per request", () => {
  afterEach(() => app.close());

  test("prints the operation, organization, actor, status and duration of a post", async () => {
    const lines = loggedApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      t: expect.any(Number),
      level: "info",
      msg: "request",
      request_id: "req-1",
      req: "POST /api/local/main/messages",
      op: "postMessage",
      org: "local",
      actor: LOCAL_OWNER,
      status: 201,
      ms: expect.any(Number),
    });
    expect(lines[0]?.ms).toBeGreaterThan(0);
    expect(lines[0]?.ms).toBeLessThan(1_000);
  });

  test("prints a line with what is known for a request that matches no route", async () => {
    const lines = loggedApp();
    await app.fetch(new Request("http://127.0.0.1:8787/elsewhere?token=x"));
    await call(app, "GET", "/nowhere");
    expect(requestLines(lines).map(({ req, op, org, actor, status }) => ({ req, op, org, actor, status }))).toEqual([
      { req: "GET /elsewhere", op: null, org: null, actor: null, status: 404 },
      { req: "GET /api/local/main/nowhere", op: null, org: "local", actor: null, status: 404 },
    ]);
  });

  test("prints the request line after the error line when the store fails", async () => {
    const lines = loggedApp();
    await app.close();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    expect(lines.map((line) => [line.level, line.msg])).toEqual([
      ["error", "request failed"],
      ["info", "request"],
    ]);
    expect(lines[1]).toMatchObject({ op: "postMessage", status: 500 });
    expect(lines[1]?.ms).toBeGreaterThan(0);
    expect(lines[1]?.ms).toBeLessThan(1_000);
  });

  test("never prints the body of a request", async () => {
    const lines = loggedApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "a private plan" });
    expect(JSON.stringify(lines)).not.toContain("a private plan");
  });

  test("prints a refused credential's request without the credential", async () => {
    /** Fixed bytes, so no token-shaped string is written in this file (docs/codebase.md 6.1). */
    const stranger = mintLocalOwnerToken(new Uint8Array(42).fill(9));
    const lines = loggedApp();
    for (const token of [stranger.token, OWNER.token]) {
      await app.fetch(
        new Request(`${BOARD_URL}/messages`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ channel: "dev", text: "hi" }),
        }),
      );
    }
    expect(lines.map(({ op, org, actor, status }) => ({ op, org, actor, status }))).toEqual([
      { op: "postMessage", org: "local", actor: null, status: 401 },
      { op: "postMessage", org: "local", actor: LOCAL_OWNER, status: 201 },
    ]);
    const printed = JSON.stringify(lines);
    for (const secret of [stranger.token, OWNER.token, "Bearer"]) expect(printed).not.toContain(secret);
  });
});

test("drops sensitive keys at every depth and preserves operational fields", () => {
  const lines: string[] = [];
  const log = jsonLogger({ now: () => NOW, write: (line) => lines.push(line) });
  const fields = {
    ownerToken: "credential",
    client_secret: "credential",
    requestBody: { text: "private message" },
    context: "retrying",
    attempts: [
      {
        Authorization: "credential",
        "Set-Cookie": "credential",
        PASSWORD: "credential",
        webhookSignature: "credential",
        signing_key: "credential",
        messageText: "private message",
        text: "private message",
        status: 403,
      },
    ],
  };

  log.info("attempt", fields);
  log.error("failed", fields);

  expect(lines.map((line) => JSON.parse(line))).toEqual([
    { t: NOW, level: "info", msg: "attempt", context: "retrying", attempts: [{ status: 403 }] },
    { t: NOW, level: "error", msg: "failed", context: "retrying", attempts: [{ status: 403 }] },
  ]);
});
