import { expect, test } from "bun:test";
import { CAN_HEADER, type claimConnection, type createConnection, type OutputOf } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

function watcherClient(app: ReturnType<typeof makeApp>, token: string, headers: Record<string, string> = {}) {
  return (method: string, path: string, body?: object) =>
    app.fetch(
      new Request(`${BOARD_URL}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );
}

async function expectDenied(send: ReturnType<typeof watcherClient>) {
  const responses = [
    await send("POST", "/watchers", { watch: { replacement: { tail: "dev" } } }),
    await send("GET", "/watchers/matches?wait=5"),
    await send("POST", "/watchers/matches/unknown/ack", { lease: "unknown" }),
  ];
  for (const response of responses) {
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  }
}

test("request narrowing and claimed pins forbid watcher registration, pull, and ack but allow listing", async () => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/x/connections", { name: "runner", direct: true, can: { "*": "all" } });
    expect(created.status).toBe(201);
    const { secret } = (await created.json()) as OutputOf<typeof createConnection>;
    const direct = watcherClient(app, secret);
    const registered = await direct("POST", "/watchers", { watch: { original: { tail: "dev" } } });
    expect(registered.status).toBe(200);
    const registration = await registered.json();

    for (const can of ["dev=all", "*=all"]) {
      const narrowed = watcherClient(app, secret, { [CAN_HEADER]: can });
      await expectDenied(narrowed);
      const listed = await narrowed("GET", "/watchers");
      expect(listed.status).toBe(200);
      expect(await listed.json()).toEqual({ watchers: [registration] });
    }

    const claimed = await direct("POST", "/x/connections/claim", { profile: "runner", can: { dev: "all" } });
    expect(claimed.status).toBe(200);
    const { token } = (await claimed.json()) as OutputOf<typeof claimConnection>;
    const agent = watcherClient(app, token);
    await expectDenied(agent);
    const listed = await agent("GET", "/watchers");
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ watchers: [] });

    const current = await direct("GET", "/watchers");
    expect(current.status).toBe(200);
    expect(await current.json()).toEqual({ watchers: [registration] });
  } finally {
    await app.close();
  }
});
