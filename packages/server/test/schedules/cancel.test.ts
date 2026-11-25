import { expect, test } from "bun:test";
import type { AuditEvent, CreatedConnection, cancelSchedule, OutputOf, ScheduleView } from "@openboard/contract";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, OWNER, PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";

async function json<T>(response: Response, status = 200): Promise<T> {
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

const input = { channel: "work", text: "reminder", in: "1d" };
const cancelPath = "/schedules/s1/cancel";

test("concurrent creator cancellations change the schedule and audit exactly once", async () => {
  const app = makeApp();
  try {
    const { schedule } = await json<{ schedule: ScheduleView }>(await call(app, "POST", "/schedules", input), 201);
    const cancel = (id: string) =>
      app.fetch(
        new Request(`${BOARD_URL}/schedules/${id}/cancel`, {
          method: "POST",
          headers: { authorization: `Bearer ${OWNER.token}`, "x-board-can": "work=read,post" },
        }),
      );
    const answers = await Promise.all(
      ["s1", "1"].map(async (id) => json<OutputOf<typeof cancelSchedule>>(await cancel(id))),
    );
    expect(answers.map(({ canceled }) => canceled).sort()).toEqual([false, true]);
    const canceled: ScheduleView = {
      ...schedule,
      state: "canceled",
      next: null,
      canceled: { by: schedule.by, reason: "canceled" },
    };
    for (const answer of answers) expect(answer.schedule).toEqual(canceled);
    expect(await json(await call(app, "GET", "/schedules?all=true"))).toEqual({ schedules: [canceled] });
    expect(await json(await call(app, "GET", "/schedules"))).toEqual({ schedules: [] });
    const { events } = await json<{ events: AuditEvent[] }>(await call(app, "GET", "/x/audit"));
    const cancellations = events.filter(({ type }) => type === "ob.schedule.canceled");
    expect(cancellations).toHaveLength(1);
    expect(cancellations[0]).toMatchObject({ actor: LOCAL_OWNER, payload: { id: "s1" } });
  } finally {
    await app.close();
  }
});

test("withholds unreadable schedules, forbids other posters, and lets a channel manager cancel", async () => {
  const app = makeApp();
  try {
    await json(await call(app, "POST", "/schedules", input), 201);
    const { secret } = await json<CreatedConnection>(
      await call(app, "POST", "/x/connections", { name: "manager", direct: true, can: { work: ["manage"] } }),
      201,
    );
    const cancel = (token: string, can: string, path = cancelPath) =>
      app.fetch(
        new Request(BOARD_URL + path, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "x-board-can": can },
        }),
      );
    for (const response of [
      await cancel(secret, "work=post"),
      await cancel(OWNER.token, "work=read", "/schedules/s9/cancel"),
    ]) {
      expect(await json(response, 404)).toMatchObject({ error: { code: "schedule_not_found" } });
    }
    for (const response of [await cancel(OWNER.token, "work=read"), await cancel(secret, "work=read,post")]) {
      expect(await json(response, 403)).toMatchObject({ error: { code: "forbidden" } });
    }
    const result = await json<OutputOf<typeof cancelSchedule>>(await cancel(secret, "work=manage"));
    expect(result.canceled).toBe(true);
    expect(result.schedule.canceled?.by.actor).not.toBe(LOCAL_OWNER);
  } finally {
    await app.close();
  }
});

test("a schedule ID from another organization answers schedule_not_found on the caller's board", async () => {
  const app = makeBrowserApp();
  const send = (path: string, headers: Record<string, string>, body?: object, method = "POST") =>
    app.fetch(
      new Request(PUBLIC_URL + path, {
        method,
        headers: { ...headers, "content-type": "application/json" },
        body: body && JSON.stringify(body),
      }),
    );
  try {
    const a = await browserSession(app.fetch, "ada");
    const b = await browserSession(app.fetch, "lin");
    await json(await send("/api/x/orgs", a.headers, { slug: "alpha", name: "Alpha" }), 201);
    await json(await send("/api/x/orgs", b.headers, { slug: "bravo", name: "Bravo" }), 201);
    const { schedule } = await json<{ schedule: ScheduleView }>(
      await send("/api/bravo/main/schedules", b.headers, input),
      201,
    );
    const route = `/schedules/${schedule.id}/cancel`;
    expect(await json(await send(`/api/alpha/main${route}`, a.headers), 404)).toMatchObject({
      error: { code: "schedule_not_found" },
    });
    expect(await json(await send(`/api/bravo/main${route}`, a.headers), 404)).toMatchObject({
      error: { code: "not_found" },
    });
    expect(await json(await send("/api/bravo/main/schedules", b.headers, undefined, "GET"))).toEqual({
      schedules: [schedule],
    });
  } finally {
    await app.close();
  }
});
