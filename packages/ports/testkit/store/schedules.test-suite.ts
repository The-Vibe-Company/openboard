import { expect } from "bun:test";
import { decideSchedule, resolveScheduleTiming } from "@openboard/core";
import { at, type StoreTenant } from "../isolation-seed.ts";

export async function checkScheduleIsolation(a: StoreTenant, b: StoreTenant) {
  await a.board.write(async (writer) => {
    const by = { actor: "creator", principal: "creator", profile: null };
    const author = { kind: "person", handle: "creator", name: "Creator", avatar: null } as const;
    const nextSchedule = await writer.nextSchedule();
    const event = decideSchedule(
      { head: writer.head, nextSchedule, target: null },
      { channel: a.channel, text: "later" },
      {
        now: at,
        by,
        author,
        timing: resolveScheduleTiming({ in: "1s" }, at),
        blind: false,
        creator: { kind: "local" },
      },
    );
    await writer.append([event]);
    expect(await writer.nextSchedule()).toBe(nextSchedule + 1);
  });
  expect(await b.board.write((writer) => writer.nextSchedule())).toBe(1);
}
