import { expect, test } from "bun:test";
import { testScope } from "@openboard/ports/testkit";
import { call, makeApp, NOW } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

test("repeat creation stores its interval, stop and first slot", async () => {
  const store = openStore(() => NOW);
  const app = makeApp({ store });
  try {
    const cases = [
      [{ every: "30m", for: "1d" }, 1_800_000, "2023-11-15T22:43:20.000Z", null, "2023-11-14T22:43:20.000Z", 1_800_000],
      [{ every: "30m", times: 3 }, 1_800_000, null, 3, "2023-11-14T22:43:20.000Z", 1_800_000],
      [{ every: "1d", at: "2023-11-15T10:00:00Z" }, 86_400_000, null, null, "2023-11-15T10:00:00.000Z", 42_400_000],
      [{ every: "1h", in: "30s" }, 3_600_000, null, null, "2023-11-14T22:13:50.000Z", 30_000],
      [
        { every: "1h", until: "2023-11-15T06:00:00Z" },
        3_600_000,
        "2023-11-15T06:00:00.000Z",
        null,
        "2023-11-14T23:13:20.000Z",
        3_600_000,
      ],
    ] as const;
    const expected = [];
    for (const [index, [input, every, until, times, next, delay]] of cases.entries()) {
      const response = await call(app, "POST", "/schedules", { channel: "dev", text: "check prod", ...input });
      expect(response.status).toBe(201);
      const schedule = { id: `s${index + 1}`, every, until, times, first: next, next, sent: 0 };
      expect(await response.json()).toMatchObject({ schedule });
      expected.push({ type: "ob.schedule.created", payload: { schedule, firstAt: NOW + delay } });
    }
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("missing local board");
    const { events } = await store.board(testScope(keys)).auditEvents(0, 20);
    expect(events).toMatchObject(expected);
  } finally {
    await app.close();
  }
});

test("invalid repeat timing refuses the schedule", async () => {
  const app = makeApp();
  try {
    const cases = [
      { every: "30s" },
      { every: "59999.9ms" },
      { every: "30m", times: 3, for: "1d" },
      { in: "30m", times: 3 },
      { every: "30m", times: 0 },
      { every: "30m", in: "1m", at: "2023-11-15T10:00:00Z" },
    ];
    for (const input of cases) {
      const response = await call(app, "POST", "/schedules", { channel: "dev", text: "check prod", ...input });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
  } finally {
    await app.close();
  }
});
