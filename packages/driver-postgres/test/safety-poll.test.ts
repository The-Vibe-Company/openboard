import { expect, test } from "bun:test";
import { messages } from "@openboard/core";
import { createViews, postgresText } from "@openboard/driver-sql";
import { testScope } from "@openboard/ports/testkit";
import { SQL } from "bun";
import { postgresBroadcaster } from "../src/broadcaster.ts";
import { statementCounter } from "../src/counters.ts";
import { createTestDatabases, terminateTestConnection } from "../src/database.ts";
import { postgresDriver } from "../src/index.ts";
import { connection, openPool } from "../src/pool.ts";
import { postgresTestUrl } from "./support/env.ts";

const url = postgresTestUrl();

async function checkSafetyPoll(url: string) {
  const name = "safety-poll-listener";
  await using listener = new SQL(url, { connection: { application_name: name } });
  await using pool = openPool(url);
  const counter = statementCounter();
  const db = connection(pool, counter);
  let tick: (() => Promise<void>) | undefined;
  let stopped = false;
  const broadcaster = await postgresBroadcaster(listener, db, (run, milliseconds) => {
    expect(milliseconds).toBe(2_000);
    tick = run;
    return () => {
      stopped = true;
    };
  });
  try {
    const writer = await postgresDriver({ url });
    try {
      const keys = await writer.platform().findBoard("local", "main");
      if (!keys) throw new Error("missing local/main fixture");
      const scope = testScope(keys);
      const board = createViews(db, postgresText, broadcaster).board(scope);
      const { head } = await board.readEvents();
      const beforeSubscribe = counter.statements;
      expect(tick).toBeUndefined();
      let wakes = 0;
      let statementsAtWake = 0;
      let delivered: ReturnType<typeof board.readEvents> | undefined;
      const unsubscribe = board.subscribeEvents(head, () => {
        wakes += 1;
        statementsAtWake = counter.statements;
        delivered = board.readEvents(head, { all: true });
      });
      if (!tick) throw new Error("the safety poll was not scheduled");

      await terminateTestConnection(url, name);
      // Keep the dedicated listener offline through the commit, even if its reconnect backoff expires.
      await listener.close();
      const positions = await writer.board(scope).write(async (tx) => {
        const actor = "ob:user:local-test";
        const { events } = messages.decidePost(
          { head: tx.head },
          { channel: "dev", text: "hello" },
          { by: { actor, principal: actor, profile: null }, now: 0 },
        );
        await tx.append(events);
        return events.map(({ id }) => id);
      });
      expect(wakes).toBe(0);
      expect(counter.statements).toBe(beforeSubscribe);
      await tick();
      expect(statementsAtWake).toBe(beforeSubscribe + 1);
      expect(wakes).toBe(1);
      const result = await delivered;
      expect(result?.events.map(({ id }) => id)).toEqual(positions);

      await tick();
      expect(wakes).toBe(1);
      unsubscribe();
      expect(stopped).toBe(true);
      const idleStatements = counter.statements;
      await tick();
      expect(counter.statements).toBe(idleStatements);
    } finally {
      await writer.close();
    }
  } finally {
    await broadcaster.close();
  }
}

if (url) {
  test("a tail catches a lost notification on the next safety tick and idle ticks send no queries", async () => {
    const databases = await createTestDatabases(url);
    try {
      const database = await databases.create();
      try {
        await checkSafetyPoll(database.url);
      } finally {
        await database.drop();
      }
    } finally {
      await databases.close();
    }
  }, 850);
}
