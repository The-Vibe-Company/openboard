/**
 * What Postgres row-level security would cost hosted mode (ticket 175, docs/decisions.md D56). Seeds a scratch
 * database cloned from a migrated template with the bench workload, adds RLS policies
 * (`org_id = current_setting('app.org_id')::bigint`) to every table that carries `org_id` on that scratch database
 * only, then times a channel read of 50 and a post, interleaved, through two stores on the same database:
 *
 * - `plain`: the driver as it ships, connected as the URL's user (a superuser, so no policy is ever evaluated);
 * - `rls`: the same views on a connection whose role is subject to the policies, every statement run in a
 *   transaction that first sets the tenant with `set_config('app.org_id', $1, true)`.
 *
 * Measurement only: nothing here ships, no migration changes. Usage, with a Postgres the bench may create a database
 * and a role on: `OPENBOARD_TEST_DATABASE_URL=postgres://… bun packages/driver-postgres/bench/rls.ts`.
 */
import { messages } from "@openboard/core";
import { createViews, type Db, postgresText } from "@openboard/driver-sql";
import type { BoardScope, BoardView } from "@openboard/ports";
import { SQL } from "bun";
import { postgresBroadcaster } from "../src/broadcaster.ts";
import { type StatementCounter, statementCounter } from "../src/counters.ts";
import { createTestDatabases } from "../src/database.ts";
import { connection, openPool } from "../src/pool.ts";
import { postgresBenchUrl } from "../test/support/env.ts";

/** The bench workload of docs/codebase.md 6.6 on the measured board, and a smaller board in each other organization. */
const WORKLOAD = { posts: 2_000, replies: 2_000, otherOrgs: 9, otherPosts: 400 } as const;
/** Operations timed per variant and per operation, after the warm-up ones. */
const SAMPLES = 1_000;
const WARMUP = 100;
const CHANNEL = "general";
const READ_LIMIT = 50;
const by = { actor: "ob:user:bench", principal: "ob:user:bench", profile: null };

/** The bench mints its scopes as the driver tests do (`@openboard/ports/testkit`); only the tenant resolver does so in the server. */
const scope = (orgId: number, boardId: number) => ({ orgId, boardId }) as BoardScope;

function post(board: BoardView, channel: string, text: string): Promise<number> {
  return board.write(async (writer) => {
    const { events, message } = messages.decidePost({ head: writer.head }, { channel, text }, { by, now: 0 });
    await writer.append(events);
    return Number(message.id);
  });
}

function reply(board: BoardView, re: number, text: string): Promise<number> {
  return board.write(async (writer) => {
    const target = await writer.replyTarget(re);
    const decided = messages.decidePost({ head: writer.head, target }, { re: String(re), text }, { by, now: 0 });
    await writer.append(decided.events);
    return Number(decided.message.id);
  });
}

/** Runs `run` for each index below `count`, one after the other: a board's writes serialize on its lock anyway. */
async function times(count: number, run: (index: number) => Promise<unknown>) {
  for (let n = 0; n < count; n++) await run(n);
}

/**
 * The measured board (local/main, organization 1) gets the bench's posts and replies; each other organization gets a
 * board with fewer posts, so the policies have other tenants' rows to filter. Seeded before any policy exists.
 */
async function seed(admin: SQL, board: (scope: BoardScope) => BoardView): Promise<BoardScope[]> {
  const others: BoardScope[] = [];
  for (let at = 1; at <= WORKLOAD.otherOrgs; at++) {
    const [org] = await admin`INSERT INTO orgs (slug, name, created_by, created_at)
      VALUES (${`bench-${at}`}, ${`Bench ${at}`}, 0, 0) RETURNING id`;
    const [row] = await admin`INSERT INTO boards (org_id, slug, name, created_at)
      VALUES (${org.id}, 'main', 'main', 0) RETURNING id`;
    others.push(scope(Number(org.id), Number(row.id)));
  }
  const measured = board(scope(1, 1));
  const roots: number[] = [];
  await times(WORKLOAD.posts, async (n) => roots.push(await post(measured, CHANNEL, `post ${n}`)));
  await times(WORKLOAD.replies, (n) => reply(measured, roots[n % roots.length] ?? 0, `reply ${n}`));
  // Other boards seed in parallel: they take different board locks.
  await Promise.all(
    others.map((other) => times(WORKLOAD.otherPosts, (n) => post(board(other), CHANNEL, `other ${other.orgId} ${n}`))),
  );
  return others;
}

/** A role the policies apply to: not a superuser, not the tables' owner, with the rights the store needs. */
async function createTenantRole(admin: SQL, role: string): Promise<void> {
  await admin.unsafe(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  await admin.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await admin.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
  await admin.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
}

/** Enables RLS with the tenant policy on every table that has an `org_id` column; returns their names. */
async function createPolicies(admin: SQL): Promise<string[]> {
  const rows = await admin`SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'org_id' ORDER BY table_name`;
  const tables = rows.map((row: { table_name: string }) => row.table_name);
  for (const table of tables) {
    await admin.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await admin.unsafe(`CREATE POLICY tenant ON ${table} USING (org_id = current_setting('app.org_id')::bigint)`);
  }
  return tables;
}

/** Wraps `db` so every statement runs in a transaction that first sets the tenant to `orgId`. */
function tenantDb(db: Db, orgId: number): Db {
  const tenant = (tx: Db) => tx.query("SELECT set_config('app.org_id', $1, true)", [String(orgId)]);
  return {
    query: (text, values) =>
      db.transaction(async (tx) => {
        await tenant(tx);
        return tx.query(text, values);
      }),
    transaction: (fn) =>
      db.transaction(async (tx) => {
        await tenant(tx);
        return fn(tx);
      }),
  };
}

interface Variant {
  readonly name: "plain" | "rls";
  readonly sql: SQL;
  readonly counter: StatementCounter;
  readonly board: (scope: BoardScope) => BoardView;
}

/** The driver's own views on a pool of `url`; with `role`, connected as that role with the tenant set per transaction. */
function openVariant(name: Variant["name"], url: string, role?: string): Variant {
  const counter = statementCounter();
  const sql = role ? new SQL(url, { connectionTimeout: 3, connection: { role } }) : openPool(url);
  const db = connection(sql, counter);
  const views = createViews(role ? tenantDb(db, 1) : db, postgresText, postgresBroadcaster());
  return { name, sql, counter, board: (s) => views.board(s) };
}

type Operation = "read" | "post";
const OPERATIONS: readonly Operation[] = ["read", "post"];

function run(variant: Variant, operation: Operation, n: number): Promise<unknown> {
  const board = variant.board(scope(1, 1));
  if (operation === "read") return board.channelMessages({ channel: CHANNEL, limit: READ_LIMIT });
  return post(board, CHANNEL, `measured ${variant.name} ${n}`);
}

/** Times `SAMPLES` of each operation per variant, alternating variants op by op so drift hits both alike. */
async function measure(variants: readonly Variant[]) {
  const samples = new Map<string, number[]>();
  const trips = new Map<string, number>();
  for (const operation of OPERATIONS) {
    for (let n = 0; n < WARMUP + SAMPLES; n++) {
      for (const variant of variants) {
        const before = variant.counter.statements;
        const started = performance.now();
        await run(variant, operation, n);
        const elapsed = performance.now() - started;
        if (n < WARMUP) continue;
        const key = `${variant.name} ${operation}`;
        samples.set(key, [...(samples.get(key) ?? []), elapsed]);
        trips.set(key, variant.counter.statements - before);
      }
    }
  }
  return { samples, trips };
}

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
}

/** Proves the policies bite: the RLS store, tenant 1, reads nothing of another organization's board. */
async function checkPolicies(plain: Variant, rls: Variant, other: BoardScope): Promise<string> {
  const query = { channel: CHANNEL, limit: READ_LIMIT };
  const seen = (await plain.board(other).channelMessages(query))?.length ?? 0;
  const leaked = (await rls.board(other).channelMessages(query))?.length ?? 0;
  if (seen === 0 || leaked !== 0) throw new Error(`policy check failed: plain saw ${seen}, rls saw ${leaked}`);
  return `rls store as organization 1 read 0 of ${seen} messages on organization ${other.orgId}'s board`;
}

async function machine(admin: SQL): Promise<string[]> {
  const cpuinfo = await Bun.file("/proc/cpuinfo")
    .text()
    .catch(() => "");
  const cpu = /model name\s*:\s*(.+)/.exec(cpuinfo)?.[1] ?? "unknown CPU";
  const meminfo = await Bun.file("/proc/meminfo")
    .text()
    .catch(() => "");
  const kb = Number(/MemTotal:\s*(\d+)/.exec(meminfo)?.[1] ?? 0);
  const [row] = await admin`SELECT version() AS version`;
  return [
    `machine: ${cpu}, ${navigator.hardwareConcurrency} threads, ${(kb / 1024 / 1024).toFixed(1)} GiB, ${process.platform}-${process.arch}`,
    `database: ${row.version}`,
    `client: Bun ${Bun.version}, one pool per variant, one operation in flight`,
  ];
}

function report(result: Awaited<ReturnType<typeof measure>>): string[] {
  const lines = ["operation  variant  p50 ms  p99 ms  round trips"];
  for (const operation of OPERATIONS) {
    for (const name of ["plain", "rls"]) {
      const key = `${name} ${operation}`;
      const sorted = [...(result.samples.get(key) ?? [])].sort((a, b) => a - b);
      const cells = [percentile(sorted, 50).toFixed(2), percentile(sorted, 99).toFixed(2)];
      lines.push(
        `${operation.padEnd(9)}  ${name.padEnd(7)}  ${cells[0]?.padStart(6)}  ${cells[1]?.padStart(6)}  ${String(result.trips.get(key)).padStart(11)}`,
      );
    }
  }
  return lines;
}

const write = (lines: readonly string[]) => process.stdout.write(`${lines.join("\n")}\n`);

/** Seeds, adds the policies, measures and prints; every step's resources are released in reverse, whatever fails. */
async function main(): Promise<void> {
  const url = postgresBenchUrl();
  const cleanup: (() => Promise<unknown>)[] = [];
  const role = `openboard_rls_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  try {
    // The role is cluster-wide: dropped last, once the database holding its grants is gone.
    const cluster = new SQL(url);
    cleanup.push(() => cluster.close());
    cleanup.push(() => cluster.unsafe(`DROP ROLE IF EXISTS ${role}`));
    const databases = await createTestDatabases(url);
    cleanup.push(() => databases.close());
    const database = await databases.create();
    cleanup.push(() => database.drop());
    const admin = new SQL(database.url);
    cleanup.push(() => admin.close());
    write(await machine(admin));

    const plain = openVariant("plain", database.url);
    cleanup.push(() => plain.sql.close());
    const seeding = performance.now();
    const others = await seed(admin, plain.board);
    const total = WORKLOAD.posts + WORKLOAD.replies + WORKLOAD.otherOrgs * WORKLOAD.otherPosts;
    write([
      `seeded: ${total} messages on ${others.length + 1} boards in ${Math.round(performance.now() - seeding)} ms`,
    ]);

    await createTenantRole(admin, role);
    const tables = await createPolicies(admin);
    write([`policies: ${tables.length} tables (${tables.join(", ")})`]);
    const rls = openVariant("rls", database.url, role);
    cleanup.push(() => rls.sql.close());
    write([`policy check: ${await checkPolicies(plain, rls, others[0] ?? scope(1, 1))}`]);

    write([`samples: ${SAMPLES} per operation and variant after ${WARMUP} warm-up, read = ${READ_LIMIT} latest`]);
    write(report(await measure([plain, rls])));
  } finally {
    for (const step of cleanup.reverse()) await step().catch((error: unknown) => process.stderr.write(`${error}\n`));
  }
}

await main();
