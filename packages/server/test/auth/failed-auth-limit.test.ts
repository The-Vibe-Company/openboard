import { expect, test } from "bun:test";
import type { createConnection, OutputOf } from "@openboard/contract";
import { reissueSecret, SECRET_PART_BYTES } from "../../src/auth/connections.ts";
import { BOARD_URL, call, makeApp, NOW, OWNER } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const FIRST_IP = "192.0.2.1";
const SECOND_IP = "192.0.2.2";

test("failed bearer checks exhaust only the calling IP's instance bucket", async () => {
  let now = NOW;
  const store = openStore(() => now);
  const openBoard = store.board.bind(store);
  let lookups = 0;
  const app = makeApp({
    now: () => now,
    store: {
      ...store,
      board(scope) {
        const view = openBoard(scope);
        return new Proxy(view, {
          get(target, method, receiver) {
            if (method !== "connection") return Reflect.get(target, method, receiver);
            return (id: string) => {
              lookups++;
              return view.connection(id);
            };
          },
        });
      },
    },
  });
  try {
    const [instance, sibling] = app.instances;
    if (!instance) throw new Error("expected a server instance");
    const response = await call(instance, "POST", "/x/connections", {
      name: "reader",
      direct: true,
      can: { "*": ["read"] },
    });
    expect(response.status).toBe(201);
    const { connection, secret } = (await response.json()) as OutputOf<typeof createConnection>;
    const wrong = reissueSecret(connection.id, new Uint8Array(SECRET_PART_BYTES).fill(255)).token;
    const send = (ip: string, token = wrong, server = instance) =>
      server.fetch(new Request(`${BOARD_URL}/events`, { headers: { authorization: `Bearer ${token}` } }), { ip });

    const before = lookups;
    for (let attempt = 0; attempt < 20; attempt++) {
      const failed = await send(FIRST_IP);
      expect(failed.status).toBe(401);
      expect(await failed.json()).toMatchObject({ error: { code: "unauthorized" } });
    }
    expect(lookups - before).toBe(20);

    const limited = await send(FIRST_IP);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3");
    expect(await limited.json()).toEqual({
      error: {
        code: "rate_limited",
        message: "too many failed authentication attempts",
        next: [{ kind: "wait", seconds: 3 }],
      },
    });
    expect(lookups - before).toBe(20);
    const missing = await instance.fetch(new Request(BOARD_URL.replace("/local/main", "/unknown/main") + "/events"), {
      ip: FIRST_IP,
    });
    expect(missing.status).toBe(429);
    expect((await send(SECOND_IP, secret)).status).toBe(200);
    if (sibling) expect((await send(FIRST_IP, secret, sibling)).status).toBe(200);

    now += 60_000;
    expect((await send(FIRST_IP, secret)).status).toBe(200);

    const beforeBurst = lookups;
    const burst = await Promise.all(Array.from({ length: 25 }, () => send(FIRST_IP)));
    expect(burst.filter((result) => result.status === 401)).toHaveLength(20);
    expect(burst.filter((result) => result.status === 429)).toHaveLength(5);
    expect(lookups - beforeBurst).toBe(20);
  } finally {
    await app.close();
  }
});

test("successful requests never debit failed authentication", async () => {
  const app = makeApp();
  try {
    const [instance] = app.instances;
    if (!instance) throw new Error("expected a server instance");
    for (let attempt = 0; attempt < 21; attempt++) {
      const response = await instance.fetch(
        new Request(`${BOARD_URL}/events`, { headers: { authorization: `Bearer ${OWNER.token}` } }),
        { ip: FIRST_IP },
      );
      expect(response.status).toBe(200);
    }
  } finally {
    await app.close();
  }
});
