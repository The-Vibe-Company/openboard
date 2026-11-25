import { expect, test } from "bun:test";
import type {
  cancelSchedule,
  createSchedule,
  listSchedules,
  OutputOf,
  postMessage,
  readThread,
} from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

async function json<T>(response: Response, status = 200): Promise<T> {
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

test("keeps the schedule's noSync value on create, list, thread read, and cancellation", async () => {
  const app = makeApp();
  try {
    const { message } = await json<OutputOf<typeof postMessage>>(
      await call(app, "POST", "/messages", { channel: "work", text: "root" }),
      201,
    );
    const expected = [];
    for (const noSync of [true, false, undefined]) {
      const { schedule } = await json<OutputOf<typeof createSchedule>>(
        await call(app, "POST", "/schedules", { re: message.id, text: "check prod", in: "1h", noSync }),
        201,
      );
      const expectedFlag = noSync ?? false;
      expect(schedule.noSync).toBe(expectedFlag);
      expected.push({ id: schedule.id, noSync: expectedFlag });
    }

    const listPath = `/schedules?re=${message.id}`;
    const listed = await json<OutputOf<typeof listSchedules>>(await call(app, "GET", listPath));
    expect(listed.schedules).toMatchObject(expected);
    const thread = await json<OutputOf<typeof readThread>>(await call(app, "GET", `/messages/${message.id}`));
    expect(thread.schedules).toMatchObject(expected);

    for (const { id, noSync } of expected) {
      const canceled = await json<OutputOf<typeof cancelSchedule>>(await call(app, "POST", `/schedules/${id}/cancel`));
      expect(canceled).toMatchObject({ canceled: true, schedule: { id, noSync, state: "canceled" } });
    }
    const all = await json<OutputOf<typeof listSchedules>>(await call(app, "GET", `${listPath}&all=true`));
    expect(all.schedules).toMatchObject(expected.map((schedule) => ({ ...schedule, state: "canceled" })));
  } finally {
    await app.close();
  }
});
