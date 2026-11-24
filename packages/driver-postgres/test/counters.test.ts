import { afterAll, beforeAll, expect, test } from "bun:test";
import { SQL } from "bun";
import { testScope } from "@openboard/ports/testkit";
import { createTestDatabases, postgresDriver, type StatementCounter, statementCounter } from "../src/index.ts";
import { connection } from "../src/pool.ts";
import { postgresTestUrl } from "./support/env.ts";

const scope = testScope({ orgId: 1, boardId: 1 });
const url = postgresTestUrl();

if (url) {
  let databases: Awaited<ReturnType<typeof createTestDatabases>>;
  beforeAll(async () => {
    databases = await createTestDatabases(url);
  });
  afterAll(() => databases?.close());

  /** A store counted by `counter` on a fresh database, closed and dropped after `run`. */
  async function withCountedStore(
    counter: StatementCounter,
    run: (store: Awaited<ReturnType<typeof postgresDriver>>) => Promise<void>,
  ) {
    const database = await databases.create();
    try {
      const store = await postgresDriver({ url: database.url }, () => 100, counter);
      try {
        expect([counter.statements, counter.roundTrips]).toEqual([0, 0]);
        await run(store);
      } finally {
        await store.close();
      }
    } finally {
      await database.drop();
    }
  }

  test("counts one statement and round trip per read and nothing for opening and migrating the store", async () => {
    const counter = statementCounter();
    await withCountedStore(counter, async (store) => {
      await store.board(scope).channelMessages({ channel: "dev", limit: 50 });
    });
    expect([counter.statements, counter.roundTrips]).toEqual([1, 1]);
  });

  test("counts a write's BEGIN and COMMIT or ROLLBACK with the statements inside it", async () => {
    const counts: number[][] = [];
    const counter = statementCounter();
    await withCountedStore(counter, async (store) => {
      await store.board(scope).write(async () => {});
      counts.push([counter.statements, counter.roundTrips]);
      await expect(
        store.board(scope).write(async () => {
          throw new Error("refused");
        }),
      ).rejects.toThrow("refused");
    });
    // BEGIN, the head read under the board lock, COMMIT; then BEGIN, the head read, ROLLBACK.
    expect([counts[0], [counter.statements, counter.roundTrips]]).toEqual([
      [3, 3],
      [6, 6],
    ]);
  });

  test("pipelined prepared queries share a trip, while simple and sequential queries count separately", async () => {
    const sql = new SQL(url, { max: 1 });
    const counter = statementCounter();
    const select = "SELECT $1::int";
    try {
      await sql.unsafe(select, [0]); // Prepare the statement on the sole connection, outside the counter.
      await connection(sql, counter).transaction(async (tx) => {
        await Promise.all([tx.query(select, [1]), tx.query(select, [2])]);
        await tx.query(select, [3]);
        await Promise.all([tx.query("SELECT 4", []), tx.query("SELECT 5", [])]);
      });
    } finally {
      await sql.close();
    }
    // BEGIN, prepared pipeline, sequential query, two simple queries, COMMIT.
    expect([counter.statements, counter.roundTrips]).toEqual([7, 6]);
  });
}
