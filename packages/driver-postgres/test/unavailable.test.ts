import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { BoardError } from "@openboard/contract";
import { messages } from "@openboard/core";
import { createViews, postgresText } from "@openboard/driver-sql";
import type { BoardView, BoardWriter, Store } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { SQL } from "bun";
import { postgresBroadcaster } from "../src/broadcaster.ts";
import { createTestDatabases, postgresDriver } from "../src/index.ts";
import { connection, isUnavailable, openPool } from "../src/pool.ts";
import { postgresTestUrl } from "./support/env.ts";

const at = 1_700_000_000_000;
const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };

async function appendPost(writer: BoardWriter, text: string) {
  const { events, message } = messages.decidePost({ head: writer.head }, { channel: "dev", text }, { by, now: at });
  await writer.append(events);
  return message;
}

async function mainBoard(store: Store): Promise<BoardView> {
  const keys = await store.platform().findBoard("local", "main");
  if (!keys) throw new Error("missing local/main fixture board");
  return store.board(testScope(keys));
}

/** A loopback URL whose port was free a moment ago: connecting to it is refused. */
function deadUrl(url: string): string {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = listener.port;
  listener.stop(true);
  const parsed = new URL(url);
  parsed.hostname = "127.0.0.1";
  parsed.port = String(port);
  return parsed.href;
}

async function expectUnavailable(work: Promise<unknown>) {
  const error = await work.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BoardError);
  expect(error).toMatchObject({ code: "unavailable", status: 503 });
}

/** Ends every backend of `url`'s database that sits inside an open transaction, waiting until each is gone. */
async function terminateOpenTransactions(url: string): Promise<number> {
  const admin = new SQL(url);
  try {
    const rows = await admin`
      SELECT pg_terminate_backend(pid, 2000) AS ended FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND state = 'idle in transaction'
    `;
    return rows.filter((row: { ended: boolean }) => row.ended).length;
  } finally {
    await admin.close();
  }
}

function postgresError(code: string, errno?: string): Error {
  return Object.assign(new Error("postgres"), { code, errno });
}

test("the three timeouts and lost connections are unavailable; a constraint violation stays a bug", () => {
  for (const errno of ["57014", "55P03", "25P03", "57P01", "53300", "08006"]) {
    expect(isUnavailable(postgresError("ERR_POSTGRES_SERVER_ERROR", errno))).toBe(true);
  }
  expect(isUnavailable(postgresError("ERR_POSTGRES_CONNECTION_REFUSED"))).toBe(true);
  expect(isUnavailable(postgresError("ERR_POSTGRES_SERVER_ERROR", "23505"))).toBe(false);
  expect(isUnavailable(postgresError("ERR_POSTGRES_SYNTAX_ERROR"))).toBe(false);
  expect(isUnavailable(new BoardError("not_found", "missing"))).toBe(false);
});

const url = postgresTestUrl();
if (url) {
  let databases: Awaited<ReturnType<typeof createTestDatabases>>;
  let database: Awaited<ReturnType<typeof databases.create>> | undefined;
  const stores: Store[] = [];

  beforeAll(async () => {
    databases = await createTestDatabases(url, () => at);
  });
  beforeEach(async () => {
    database = await databases.create();
  });
  afterEach(async () => {
    try {
      await Promise.all(stores.splice(0).map((store) => store.close()));
    } finally {
      await database?.drop();
      database = undefined;
    }
  });
  afterAll(() => databases?.close());

  test("a store on a URL nothing listens on answers a read and a write with unavailable, within the connect timeout", async () => {
    const sql = openPool(deadUrl(url));
    const store: Store = {
      ...createViews(connection(sql), postgresText, postgresBroadcaster()),
      close: () => sql.close(),
    };
    stores.push(store);
    const board = store.board(testScope({ orgId: 1, boardId: 1 }));

    await expectUnavailable(store.platform().findBoard("local", "main"));
    await expectUnavailable(board.readEvents(0));
    await expectUnavailable(board.write((writer) => appendPost(writer, "never stored")));
  }, 3_000);

  test("every pooled connection carries the request timeouts from its startup parameters", async () => {
    if (!database) throw new Error("missing Postgres test database");
    const sql = openPool(database.url);
    try {
      const [settings] = await sql`
        SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock,
          current_setting('idle_in_transaction_session_timeout') AS idle
      `;
      expect(settings).toEqual({ statement: "5s", lock: "3s", idle: "10s" });
    } finally {
      await sql.close();
    }
  });

  test("a write whose backend is terminated mid-transaction answers unavailable, commits nothing, and the store recovers", async () => {
    if (!database) throw new Error("missing Postgres test database");
    const dbUrl = database.url;
    const store = await postgresDriver({ url: dbUrl }, () => at);
    stores.push(store);
    const board = await mainBoard(store);
    await board.write((writer) => appendPost(writer, "before"));
    const before = await board.readEvents(0);
    // Bun rejects the write as soon as its connection closes, possibly before the callback resumes.
    let terminated: Promise<number> | undefined;

    await expectUnavailable(
      board.write(async (writer) => {
        await appendPost(writer, "lost");
        terminated = terminateOpenTransactions(dbUrl);
        await terminated;
      }),
    );

    expect(await terminated).toBe(1);
    expect(await board.readEvents(0)).toEqual(before);
    expect((await board.write((writer) => appendPost(writer, "after"))).id).toBe("2");
    expect((await board.readEvents(0)).head).toBe(2);
  });
}
