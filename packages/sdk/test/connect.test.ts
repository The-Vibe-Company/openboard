import { expect, test } from "bun:test";
import { BoardError, openboard } from "../src/index.ts";

const url = "https://board.example/api/acme/main";
const secret = "obc_fixture";
const first = "obt_first";
const second = "obt_second";
const start = 1_700_000_000_000;

function issued(token: string, expiresAt: number, hardExpiresAt = start + 120_000) {
  return Response.json({
    token,
    agent: { expiresAt: new Date(expiresAt).toISOString(), hardExpiresAt: new Date(hardExpiresAt).toISOString() },
    // The server's suggested environment does not control where the SDK sends requests.
    env: { BOARD_URL: "https://elsewhere.example/api/local/main" },
  });
}

function unauthorized() {
  return Response.json({ error: { code: "unauthorized", message: "agent token expired" } }, { status: 401 });
}

function fakeClock() {
  let now = start;
  let timer: { readonly at: number; readonly callback: () => Promise<void> } | undefined;
  return {
    now: () => now,
    schedule(callback: () => Promise<void>, delayMs: number) {
      const scheduled = { at: now + delayMs, callback };
      timer = scheduled;
      return () => {
        if (timer === scheduled) timer = undefined;
      };
    },
    async advanceTo(time: number) {
      now = time;
      if (timer && timer.at <= time) {
        const { callback } = timer;
        timer = undefined;
        await callback();
      }
    },
  };
}

test("claims once with claim options, then refreshes before expiry even while idle", async () => {
  const clock = fakeClock();
  let boardCalls = 0;
  let claimCalls = 0;
  let refreshCalls = 0;
  const can = { work: ["read", "post"] } as const;
  const board = await openboard({
    url: `${url}/`,
    secret,
    as: "run-812",
    can: { work: [...can.work] },
    ttl: "20s",
    idempotencyKey: "run-812-launch",
    ...clock,
    async fetch(request) {
      if (request.url === `${url}/x/connections/claim`) {
        claimCalls++;
        expect(request.method).toBe("POST");
        expect(request.redirect).toBe("error");
        expect(request.headers.get("authorization") === `Bearer ${secret}`).toBe(true);
        expect(await request.json()).toEqual({
          profile: "run-812",
          can,
          ttl: "20s",
          idempotencyKey: "run-812-launch",
        });
        return issued(first, start + 20_000);
      }
      if (request.url === `${url}/x/connections/refresh`) {
        refreshCalls++;
        expect(request.method).toBe("POST");
        expect(request.headers.get("authorization") === `Bearer ${first}`).toBe(true);
        expect(clock.now()).toBeLessThan(start + 20_000);
        return issued(second, start + 120_000);
      }
      expect(request.url).toBe(`${url}/me`);
      const token = boardCalls++ === 0 ? first : second;
      expect(request.headers.get("authorization") === `Bearer ${token}`).toBe(true);
      return Response.json({});
    },
  });
  expect(JSON.stringify(board).includes(secret)).toBe(false);
  expect(Object.keys(board).some((key) => key.includes(secret) || key === "secret")).toBe(false);

  await board.getMe({});
  await clock.advanceTo(start + 19_000);
  expect(refreshCalls).toBe(1);
  await board.getMe({});
  expect([claimCalls, refreshCalls, boardCalls]).toEqual([1, 1, 2]);
});

test("shares one refresh across facade and flat calls after concurrent 401s and retries with the original request body", async () => {
  const trace: string[] = [];
  const board = await openboard({
    url,
    secret,
    as: "run-812",
    ...fakeClock(),
    async fetch(request) {
      if (request.url.endsWith("/claim")) {
        expect(await request.json()).toEqual({ profile: "run-812" });
        return issued(first, start + 20_000);
      }
      if (request.url.endsWith("/refresh")) {
        trace.push("refresh");
        expect(request.headers.get("authorization") === `Bearer ${first}`).toBe(true);
        return issued(second, start + 120_000);
      }
      expect(request.url).toBe(`${url}/messages`);
      expect(await request.json()).toEqual({ channel: "work", text: "hello" });
      if (request.headers.get("authorization") === `Bearer ${first}`) {
        trace.push("expired");
        return unauthorized();
      }
      expect(request.headers.get("authorization") === `Bearer ${second}`).toBe(true);
      trace.push("retried");
      return Response.json({});
    },
  });

  const input = { channel: "work", text: "hello" };
  await Promise.all([board.messages.post(input), board.postMessage(input)]);
  expect(trace.sort()).toEqual(["expired", "expired", "refresh", "retried", "retried"]);
});

test.each([true, false])("gives up with unauthorized after one refresh attempt (refresh works: %s)", async (works) => {
  const paths: string[] = [];
  const board = await openboard({
    url,
    secret,
    as: "run-812",
    ...fakeClock(),
    async fetch(request) {
      paths.push(request.url.slice(url.length));
      if (request.url.endsWith("/claim")) return issued(first, start + 20_000);
      if (request.url.endsWith("/refresh")) {
        return works ? issued(second, start + 120_000) : new Response(null, { status: 401 });
      }
      return unauthorized();
    },
  });

  const failure: unknown = await board.getMe({}).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(BoardError);
  expect(failure).toMatchObject({ code: "unauthorized" });
  expect(paths).toEqual(["/x/connections/claim", "/me", "/x/connections/refresh", ...(works ? ["/me"] : [])]);
});

test("uses a supplied token as given without claiming, refreshing, or retrying a 401", async () => {
  let calls = 0;
  const board = await openboard({
    url,
    token: "existing",
    async fetch(request) {
      calls++;
      expect(request.url).toBe(`${url}/me`);
      expect(request.headers.get("authorization") === "Bearer existing").toBe(true);
      return unauthorized();
    },
  });
  await expect(board.getMe({})).rejects.toMatchObject({ code: "unauthorized" });
  expect(calls).toBe(1);
});

test.each(["invalid secret", "obc_", "obc_line\nbreak"])(
  "refuses an invalid secret before fetching (%s)",
  async (bad) => {
    const attempt = openboard({
      url,
      secret: bad,
      as: "run-812",
      fetch: async () => {
        throw new Error("unexpected fetch");
      },
    });
    await expect(attempt).rejects.toMatchObject({ code: "invalid_request" });
  },
);

test.each(["server", "transport"])("keeps the secret out of %s claim errors", async (source) => {
  const attempt = openboard({
    url,
    secret,
    as: "run-812",
    async fetch(request) {
      expect(request.url).toBe(`${url}/x/connections/claim`);
      if (source === "transport") throw new TypeError(`rejected ${secret}`);
      return Response.json(
        { error: { code: "forbidden", message: secret, hint: secret, next: [{ kind: "read", url: secret }] } },
        { status: 403 },
      );
    },
  });

  await expect(attempt).rejects.toMatchObject({
    code: source === "server" ? "forbidden" : "unreachable",
    message: "the board refused the claim",
  });
  const error: unknown = await attempt.catch((failure: unknown) => failure);
  expect(JSON.stringify(error).includes(secret)).toBe(false);
});

test("retries a transient proactive refresh failure before the token expires", async () => {
  const clock = fakeClock();
  let refreshes = 0;
  const board = await openboard({
    url,
    secret,
    as: "run-812",
    ...clock,
    async fetch(request) {
      if (request.url.endsWith("/claim")) return issued(first, start + 20_000);
      if (request.url.endsWith("/refresh")) {
        expect(clock.now()).toBeLessThan(start + 20_000);
        if (++refreshes === 1) throw new TypeError("temporary connection failure");
        if (refreshes === 2) return new Response(null, { status: 503 });
        return issued(second, start + 120_000);
      }
      expect(request.headers.get("authorization") === `Bearer ${second}`).toBe(true);
      return Response.json({});
    },
  });

  await clock.advanceTo(start + 18_000);
  expect(refreshes).toBe(1);
  await clock.advanceTo(start + 19_000);
  expect(refreshes).toBe(2);
  await clock.advanceTo(start + 19_500);
  expect(refreshes).toBe(3);
  await board.getMe({});
});

test("shares a failed rotation with late 401s from the same burst", async () => {
  const delayed = Promise.withResolvers<Response>();
  let boardCalls = 0;
  let refreshes = 0;
  const board = await openboard({
    url,
    secret,
    as: "run-812",
    ...fakeClock(),
    async fetch(request) {
      if (request.url.endsWith("/claim")) return issued(first, start + 20_000);
      if (request.url.endsWith("/refresh")) {
        refreshes++;
        return unauthorized();
      }
      return ++boardCalls === 1 ? delayed.promise : unauthorized();
    },
  });

  const firstCall = board.getMe({});
  await expect(board.getMe({})).rejects.toMatchObject({ code: "unauthorized" });
  delayed.resolve(unauthorized());
  await expect(firstCall).rejects.toMatchObject({ code: "unauthorized" });
  expect(refreshes).toBe(1);
});

test("canceling a manual refresh preserves the rotation for another call", async () => {
  const rotation = Promise.withResolvers<Response>();
  let refreshes = 0;
  const board = await openboard({
    url,
    secret,
    as: "run-812",
    ...fakeClock(),
    async fetch(request) {
      if (request.url.endsWith("/claim")) return issued(first, start + 20_000);
      if (request.url.endsWith("/refresh")) {
        refreshes++;
        const response = await rotation.promise;
        request.signal.throwIfAborted();
        return response;
      }
      return request.headers.get("authorization") === `Bearer ${second}` ? Response.json({}) : unauthorized();
    },
  });

  const controller = new AbortController();
  const manualRefresh = board.refreshAgentToken({}, { signal: controller.signal });
  const getMe = board.getMe({});
  controller.abort();
  await expect(manualRefresh).rejects.toMatchObject({ name: "AbortError" });
  rotation.resolve(issued(second, start + 120_000));
  await getMe;
  expect(refreshes).toBe(1);
});
