import { expect, test } from "bun:test";
import type { claimTask, OutputOf, readEvents, renewTask } from "@openboard/contract";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, NOW } from "../support/app.ts";

test("renewal replaces the expiry from the renewal time and appears in the all-events feed", async () => {
  let now = NOW;
  const app = makeApp({ now: () => now });
  try {
    await call(app, "POST", "/tasks", { channel: "dev", text: "fix the build" });
    const claimed = await call(app, "POST", "/tasks/2/claim", { lease: 300 });
    expect(claimed.status).toBe(200);
    const { claim } = (await claimed.json()) as OutputOf<typeof claimTask>;
    expect(claim.until).toBe("2023-11-14T22:18:20.000Z");
    const { epoch, token } = claim;
    now += 280_000;
    const response = await call(app, "POST", "/tasks/2/renew", { epoch, token, lease: 60 });
    expect(response.status).toBe(200);
    const answer = (await response.json()) as OutputOf<typeof renewTask>;
    const until = "2023-11-14T22:19:00.000Z";
    expect(answer).toEqual({
      task: expect.objectContaining({
        id: "2",
        task: expect.objectContaining({ epoch, claim: { actor: LOCAL_OWNER, until } }),
      }),
      until,
    });
    expect(await (await call(app, "GET", "/messages/2")).json()).toMatchObject({ message: answer.task });
    for (const query of ["after=0", "last=10", "last=10&channel=dev"]) {
      for (const all of [false, true]) {
        const feed = await call(app, "GET", `/events?${query}&all=${all}`);
        expect(feed.status).toBe(200);
        const { events } = (await feed.json()) as OutputOf<typeof readEvents>;
        const renewals = events.filter((event) => event.type === "task.renewed");
        expect(renewals).toHaveLength(all ? 1 : 0);
        if (all)
          expect(renewals[0]?.payload).toEqual({
            id: "2",
            thread: "2",
            epoch,
            until,
            by: { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null },
          });
      }
    }
    now = NOW + 310_000;
    const renewed = await call(app, "POST", "/tasks/2/renew", { epoch, token });
    expect(renewed.status).toBe(200);
    expect(await renewed.json()).toMatchObject({ until: "2023-11-14T22:33:30.000Z" });
  } finally {
    await app.close();
  }
});

test("channel readers can opt into renewals without seeing board bookkeeping or other channels", async () => {
  const app = makeApp();
  try {
    for (const channel of ["dev", "private"]) {
      const created = await call(app, "POST", "/tasks", { channel, text: "fix the build" });
      const { task } = (await created.json()) as OutputOf<typeof claimTask>;
      const claimed = await call(app, "POST", `/tasks/${task.id}/claim`);
      const {
        claim: { epoch, token },
      } = (await claimed.json()) as OutputOf<typeof claimTask>;
      expect((await call(app, "POST", `/tasks/${task.id}/renew`, { epoch, token })).status).toBe(200);
    }
    const connection = await call(app, "POST", "/x/connections", {
      name: "dev-only",
      direct: true,
      can: { dev: ["read"] },
    });
    const { secret } = (await connection.json()) as { secret: string };
    for (const query of ["after=0&channel=dev", "last=10&channel=dev"]) {
      const response = await app.fetch(
        new Request(`${BOARD_URL}/events?all=true&${query}`, {
          headers: { authorization: `Bearer ${secret}` },
        }),
      );
      expect(response.status).toBe(200);
      const { events } = (await response.json()) as OutputOf<typeof readEvents>;
      expect(events.map(({ type }) => type)).toEqual([
        "message.posted",
        "task.created",
        "task.claimed",
        "task.renewed",
      ]);
      expect(events.at(-1)?.payload).toMatchObject({ id: "2", thread: "2" });
    }
  } finally {
    await app.close();
  }
});
