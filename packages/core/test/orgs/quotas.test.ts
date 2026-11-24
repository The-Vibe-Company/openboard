import { expect, test } from "bun:test";
import { countQuotas } from "@openboard/core";

test("count quotas default to 10 boards, 50 members, and 100 connections per board", () => {
  expect(countQuotas()).toEqual({ boards: 10, members: 50, connections: 100 });
});

test("organization overrides replace only the limits they name, including zero", () => {
  expect(countQuotas({ boards: 12 })).toEqual({ boards: 12, members: 50, connections: 100 });
  expect(countQuotas({ members: 0, connections: 2 })).toEqual({ boards: 10, members: 0, connections: 2 });
  expect(countQuotas()).toEqual({ boards: 10, members: 50, connections: 100 });
});
