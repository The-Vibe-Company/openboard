import { expect, test } from "bun:test";
import { operations } from "@openboard/contract";
import type { Deps } from "../src/index.ts";
import type { Headers, Seeded } from "./isolation/seed.ts";
import { NOW, PUBLIC_URL } from "./support/app.ts";
import { browserSession, makeBrowserApp } from "./support/browser-session.ts";
import { openStore } from "./support/drivers.ts";

const boards = "/api/x/orgs/acme/boards";
const ops = "/api/acme/ops";
const main = "/api/acme/main";
const audit = "/api/x/orgs/acme/audit";
const endpoint = `${boards}/ops/delete`;
const board = { slug: "ops", name: "Ops" };
const defaultBoard = { slug: "main", name: "main" };
const deletion = { board, deletedAt: "2023-11-14T22:13:20.000Z" };

async function fixture(
  run: (send: Seeded["send"], owner: Headers, app: ReturnType<typeof makeBrowserApp>) => Promise<void>,
  schedule?: Deps["schedule"],
) {
  const store = openStore(() => NOW);
  const app = makeBrowserApp(undefined, store, undefined, schedule);
  const send: Seeded["send"] = (method, path, headers, body) =>
    app.fetch(new Request(`${PUBLIC_URL}${path}`, { method, headers, body: JSON.stringify(body) }));
  try {
    const { headers: owner } = await browserSession(app.fetch, "ada");
    expect((await send("POST", "/api/x/orgs", owner, { slug: "acme", name: "Acme" })).status).toBe(201);
    expect((await send("POST", boards, owner, board)).status).toBe(201);
    await run(send, owner, app);
  } finally {
    await app.close();
    await store.close();
  }
}

async function invite(send: Seeded["send"], owner: Headers, person: Headers, role: "admin" | "member") {
  const invited = await send("POST", "/api/x/orgs/acme/invitations", owner, { role });
  expect(invited.status).toBe(201);
  const { url } = (await invited.json()) as { url: string };
  const token = new URL(url).pathname.slice("/invite/".length);
  expect((await send("POST", "/api/x/invitations/accept", person, { token })).status).toBe(200);
}

const bearer = (value: string) => ({ authorization: `Bearer ${value}` });

async function boardCredentials(send: Seeded["send"], admin: Headers) {
  const can = { "*": "all" };
  const direct = await send("POST", `${ops}/x/connections`, admin, { name: "direct", direct: true, can });
  const fleet = await send("POST", `${ops}/x/connections`, admin, { name: "fleet", can });
  expect(direct.status).toBe(201);
  expect(fleet.status).toBe(201);
  const { secret } = (await direct.json()) as { secret: string };
  const fleetBody = (await fleet.json()) as { secret: string };
  const claimed = await send("POST", `${ops}/x/connections/claim`, bearer(fleetBody.secret), { profile: "worker" });
  expect(claimed.status).toBe(200);
  const agent = (await claimed.json()) as { token: string };
  return [bearer(secret), bearer(agent.token)] as const;
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(body).toMatchObject({ error: { code } });
  return body;
}

test("an admin deletes a board, records one audit event and shuts off its authenticated routes", async () => {
  await fixture(async (send, owner, app) => {
    const { headers: admin, principal } = await browserSession(app.fetch, "lin");
    const { headers: member } = await browserSession(app.fetch, "mei");
    await invite(send, owner, admin, "admin");
    await invite(send, owner, member, "member");
    const [connection, agent] = await boardCredentials(send, admin);
    for (const headers of [connection, agent, member]) {
      expect((await send("GET", `${ops}/me`, headers)).status).toBe(200);
    }
    await expectError(await send("POST", endpoint, {}), 401, "unauthorized");
    await expectError(await send("POST", endpoint, member), 403, "forbidden");
    const gone = await send("POST", endpoint, admin);
    expect(gone.status).toBe(200);
    expect(await gone.json()).toEqual(deletion);
    await expectError(await send("POST", endpoint, admin), 404, "not_found");
    expect(await (await send("GET", boards, member)).json()).toEqual({ boards: [defaultBoard] });

    const logged = await send("GET", audit, admin);
    expect(logged.status).toBe(200);
    const { events } = (await logged.json()) as { events: { type: string }[] };
    expect(events.filter(({ type }) => type === "ob.board.deleted")).toEqual([
      expect.objectContaining({ actor: principal, createdAt: deletion.deletedAt, payload: deletion }),
    ]);

    for (const { auth, scope, route } of operations) {
      if (scope !== "board" || route.mount) continue;
      const path = ops + route.path.replace(/:\w+/g, "sample");
      for (const headers of [connection, agent]) {
        const response = await send(route.method, path, headers);
        if (auth === "signature") await expectError(response, 404, "not_found");
        else await expectError(response, 401, "unauthorized");
      }
      await expectError(await send(route.method, path, member), 404, "not_found");
    }
    const forged = bearer("obc_invalid");
    expect(await expectError(await send("GET", `${ops}/me`, forged), 404, "not_found")).toEqual(
      await expectError(await send("GET", "/api/acme/unknown/me", forged), 404, "not_found"),
    );
    for (const suffix of ["", "/openapi.json"]) {
      expect((await send("GET", ops + suffix, {})).status).toBe(200);
    }
    expect((await send("GET", `${main}/me`, member)).status).toBe(200);
    await expectError(await send("POST", boards, admin, board), 409, "slug_taken");
  });
});

test("refusing to delete main leaves the board list, audit log and main intact", async () => {
  await fixture(async (send, owner) => {
    const before = await (await send("GET", audit, owner)).json();
    const refused = await expectError(await send("POST", `${boards}/main/delete`, owner), 400, "invalid_request");
    expect(refused).toMatchObject({ error: { hint: "Delete the organization instead." } });
    expect(await (await send("GET", audit, owner)).json()).toEqual(before);
    expect(await (await send("GET", boards, owner)).json()).toEqual({ boards: [defaultBoard, board] });
    expect((await send("GET", `${main}/me`, owner)).status).toBe(200);
  });
});

test("deleting a board wakes a parked event stream without waiting for any new events", async () => {
  await fixture(
    async (_send, owner, app) => {
      const [first, second = first] = app.instances;
      if (!first || !second) throw new Error("expected a test instance");
      const stream = await first.fetch(
        new Request(`${PUBLIC_URL}${ops}/events`, {
          headers: { ...owner, accept: "text/event-stream" },
        }),
      );
      expect(stream.status).toBe(200);
      const reader = stream.body?.getReader();
      if (!reader) throw new Error("expected an event stream");
      try {
        expect((await reader.read()).done).toBe(false);
        expect((await reader.read()).done).toBe(false);
        const closed = reader.read().catch((error: unknown) => error);
        const deleted = await second.fetch(new Request(`${PUBLIC_URL}${endpoint}`, { method: "POST", headers: owner }));
        expect(deleted.status).toBe(200);
        expect(await closed).toMatchObject({ code: "not_found" });
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    },
    () => () => {},
  );
}, 1000);
