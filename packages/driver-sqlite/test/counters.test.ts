import { expect, test } from "bun:test";
import { testScope } from "@openboard/ports/testkit";
import { sqliteDriver, statementCounter } from "../src/index.ts";

const scope = testScope({ orgId: 1, boardId: 1 });

test("counts one statement per read and nothing for opening the store", async () => {
  const counter = statementCounter();
  const store = sqliteDriver({ memory: true }, () => 100, counter);
  try {
    expect(counter.statements).toBe(0);
    await store.board(scope).channelMessages({ channel: "dev", limit: 50 });
    expect(counter.statements).toBe(1);
  } finally {
    await store.close();
  }
});

test("counts a write's transaction control with the statements inside it, rolled back or committed", async () => {
  const counter = statementCounter();
  const store = sqliteDriver({ memory: true }, () => 100, counter);
  try {
    // BEGIN IMMEDIATE, the head read under the lock, COMMIT.
    await store.board(scope).write(async () => {});
    expect(counter.statements).toBe(3);
    // BEGIN IMMEDIATE, the head read, ROLLBACK.
    await expect(
      store.board(scope).write(async () => {
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    expect(counter.statements).toBe(6);
  } finally {
    await store.close();
  }
});
