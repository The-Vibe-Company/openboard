import { expect, test } from "bun:test";
import type {
  CanInput,
  CreatedConnection,
  cancelSchedule,
  listSchedules,
  OutputOf,
  ScheduleView,
} from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

async function json<T>(response: Response, status = 200): Promise<T> {
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

async function connect(app: ReturnType<typeof makeApp>, name: string, can: CanInput) {
  const { secret } = await json<CreatedConnection>(
    await call(app, "POST", "/x/connections", { name, direct: true, can }),
    201,
  );
  return (profile?: string, can?: string) => {
    const send = (method: string, path: string, body?: object) => {
      const headers = new Headers({ authorization: `Bearer ${secret}`, "content-type": "application/json" });
      if (profile) headers.set("x-board-profile", profile);
      if (can) headers.set("x-board-can", can);
      return app.fetch(new Request(BOARD_URL + path, { method, headers, body: body && JSON.stringify(body) }));
    };
    return {
      create: async () =>
        (
          await json<{ schedule: ScheduleView }>(
            await send("POST", "/schedules", { channel: "work", text: "reminder @[foreign-actor]", in: "1d" }),
            201,
          )
        ).schedule,
      cancel: (id: string) => send("POST", `/schedules/${id}/cancel`),
      list: async (query = "") =>
        (await json<OutputOf<typeof listSchedules>>(await send("GET", `/schedules${query}`))).schedules,
    };
  };
}

test("the creating profile, its unprofiled principal and a channel manager can cancel", async () => {
  const app = makeApp();
  try {
    const shared = await connect(app, "shared", { work: ["read", "post"] });
    const manage = await connect(app, "manager", { work: ["manage"] });
    const fixer = shared("fixer");
    const { id } = await fixer.create();

    expect(await json(await shared("reviewer").cancel(id), 403)).toMatchObject({ error: { code: "forbidden" } });
    expect(await fixer.list()).toMatchObject([{ id, state: "pending" }]);

    for (const [caller, scheduleId] of [
      [fixer, id],
      [shared(), (await fixer.create()).id],
      [manage("manager"), (await fixer.create()).id],
    ] as const) {
      const result = await json<OutputOf<typeof cancelSchedule>>(await caller.cancel(scheduleId));
      expect(result).toMatchObject({ canceled: true, schedule: { id: scheduleId, state: "canceled" } });
    }
  } finally {
    await app.close();
  }
});

test("a post-only creator lists and cancels only its own schedules with text hidden", async () => {
  const app = makeApp();
  try {
    const shared = await connect(app, "shared", { work: ["read", "post"], dev: ["read"] });
    const fixer = shared("fixer");
    const blindFixer = shared("fixer", "work=post");
    const elsewhere = shared("fixer", "dev=read");
    const { id } = await fixer.create();
    const blindId = (await blindFixer.create()).id;
    const peerId = (await shared("reviewer").create()).id;

    expect(await elsewhere.list()).toEqual([]);
    for (const response of [await elsewhere.cancel(id), await blindFixer.cancel(peerId)]) {
      expect(await json(response, 404)).toMatchObject({ error: { code: "schedule_not_found" } });
    }
    expect((await fixer.list()).find((schedule) => schedule.id === id)?.text).toContain("reminder");
    expect((await blindFixer.list()).map(({ id, text }) => ({ id, text }))).toEqual([
      { id, text: "" },
      { id: blindId, text: "" },
    ]);

    for (const scheduleId of [id, blindId]) {
      expect(await json(await blindFixer.cancel(scheduleId))).toMatchObject({
        canceled: true,
        schedule: { id: scheduleId, text: "", state: "canceled" },
      });
      expect(await json(await blindFixer.cancel(scheduleId))).toMatchObject({
        canceled: false,
        schedule: { id: scheduleId, text: "", state: "canceled" },
      });
    }
    expect(await blindFixer.list()).toEqual([]);
    expect(await fixer.list()).toMatchObject([{ id: peerId, state: "pending" }]);
  } finally {
    await app.close();
  }
});
